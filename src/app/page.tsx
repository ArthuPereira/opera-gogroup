"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, Loader2 } from "lucide-react";
import { detectSystemicAnomalies } from "@/lib/anomalies";
import { enrichOrderRecord, round2 } from "@/lib/business-rules";
import { serializeEnrichedOrdersCsv } from "@/lib/csv-io";
import {
  activateSystemicContainment,
  db,
  ensureDatabaseSeeded,
  executePortfolioResolution,
  ingestNewOrders,
  revertAutoTriagedOrderToHumanQueue,
  toggleContainmentActive,
} from "@/lib/db";
import { formatBRL } from "@/lib/format";
import {
  buildCustomerPortfolios,
  compareAiFirstVsFifo,
  DAILY_HUMAN_CAPACITY,
} from "@/lib/priority-engine";
import {
  CarrierRoute,
  Customer,
  CustomerPortfolio,
  ExceptionType,
  PortfolioResolutionPlan,
  RawOrder,
  RecommendedActionType,
  SystemicContainmentPlan,
} from "@/lib/types";
import { AutoTriageAuditTab } from "@/components/AutoTriageAuditTab";
import { IngestModal } from "@/components/IngestModal";
import { KpiHeader } from "@/components/KpiHeader";
import { OverviewTab } from "@/components/OverviewTab";
import { DashboardSection, Sidebar } from "@/components/Sidebar";
import {
  QueueFiltersState,
  SmartQueueTab,
} from "@/components/SmartQueueTab";
import { SystemicRadarTab } from "@/components/SystemicRadarTab";

const DEFAULT_FILTERS: QueueFiltersState = {
  search: "",
  scope: "top150",
  viewMode: "portfolio",
  marca: "all",
  tipoExcecao: "all",
  cd: "all",
  transportadora: "all",
  onlyVip: false,
  onlyMultiOrder: false,
};

export default function OperaDashboardPage() {
  const [activeSection, setActiveSection] =
    useState<DashboardSection>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );
  const [cachedPlans, setCachedPlans] = useState<
    Record<string, PortfolioResolutionPlan>
  >({});

  const [filters, setFilters] = useState<QueueFiltersState>(DEFAULT_FILTERS);

  useEffect(() => {
    let mounted = true;
    ensureDatabaseSeeded(false)
      .catch((err) => {
        if (mounted) {
          setBootError(
            err instanceof Error ? err.message : "Erro ao carregar dados."
          );
        }
      })
      .finally(() => {
        if (mounted) setIsBootstrapping(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const rawOrders = useLiveQuery(() => db.orders.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const carriers = useLiveQuery(() => db.carriers.toArray(), []);
  const containments = useLiveQuery(() => db.containments.toArray(), []);
  const claims = useLiveQuery(
    () => db.claims.orderBy("claim_id").reverse().toArray(),
    []
  );
  const auditLogs = useLiveQuery(
    () => db.auditLogs.orderBy("id").reverse().limit(60).toArray(),
    []
  );

  const computed = useMemo(() => {
    if (!rawOrders || !customers || !carriers || !containments) {
      return null;
    }

    const customersMap = new Map<string, Customer>();
    for (const c of customers) {
      customersMap.set(c.customer_id, c);
    }

    const carriersByUf = new Map<string, CarrierRoute[]>();
    for (const c of carriers) {
      const list = carriersByUf.get(c.uf_atendida) ?? [];
      list.push(c);
      carriersByUf.set(c.uf_atendida, list);
    }

    const enrichedOrders = rawOrders.map((rec) =>
      enrichOrderRecord(
        rec,
        customersMap.get(rec.customer_id),
        carriersByUf,
        containments
      )
    );

    const activeEnriched = enrichedOrders.filter(
      (o) => o.workflowStatus === "active_queue"
    );
    const autoTriagedOrders = enrichedOrders.filter(
      (o) => o.workflowStatus === "auto_triaged"
    );
    const resolvedOrders = enrichedOrders.filter(
      (o) => o.workflowStatus === "resolved"
    );

    const allPortfolios = buildCustomerPortfolios(activeEnriched, customersMap);
    const simulation = compareAiFirstVsFifo(
      enrichedOrders,
      allPortfolios,
      DAILY_HUMAN_CAPACITY
    );
    const anomalies = detectSystemicAnomalies(enrichedOrders, containments);

    const totalActiveExposureBRL = round2(
      allPortfolios.reduce((acc, p) => acc + p.riskTotalBRL, 0)
    );
    const resolvedSavings = resolvedOrders.reduce(
      (acc, o) => acc + (o.resolvedSavingsBRL ?? 0),
      0
    );
    const totalProtectedSavingsBRL = round2(
      autoTriagedOrders.length * 9.0 + resolvedSavings
    );
    const resolvedTreatmentsCount = new Set(
      resolvedOrders.map((o) => o.customer_id)
    ).size;
    const potentialClaimPoolBRL = round2(
      activeEnriched.reduce(
        (acc, o) => acc + o.economics.eligibleCarrierClaimBRL,
        0
      )
    );

    const allBrands = Array.from(
      new Set(enrichedOrders.map((o) => o.marca))
    ).sort();
    const allCarriers = Array.from(
      new Set(enrichedOrders.map((o) => o.transportadora))
    ).sort();

    return {
      customersMap,
      carriersByUf,
      enrichedOrders,
      activeEnriched,
      autoTriagedOrders,
      resolvedOrders,
      allPortfolios,
      simulation,
      anomalies,
      totalActiveExposureBRL,
      totalProtectedSavingsBRL,
      resolvedTreatmentsCount,
      potentialClaimPoolBRL,
      allBrands,
      allCarriers,
    };
  }, [rawOrders, customers, carriers, containments]);

  const filteredData = useMemo(() => {
    if (!computed) {
      return { portfolios: [], orders: [] };
    }

    const q = filters.search.trim().toLowerCase();
    const multiOrderCustomerIds = new Set(
      computed.allPortfolios
        .filter((p) => p.orderCount >= 2)
        .map((p) => p.customer_id)
    );

    const matchesOrder = (o: (typeof computed.enrichedOrders)[number]) => {
      if (filters.marca !== "all" && o.marca !== filters.marca) return false;
      if (
        filters.tipoExcecao !== "all" &&
        o.tipo_excecao !== filters.tipoExcecao
      )
        return false;
      if (filters.cd !== "all" && o.cd !== filters.cd) return false;
      if (
        filters.transportadora !== "all" &&
        o.transportadora !== filters.transportadora
      )
        return false;
      if (filters.onlyVip && !o.isVipCustomer) return false;
      if (filters.onlyMultiOrder && !multiOrderCustomerIds.has(o.customer_id))
        return false;
      if (!q) return true;
      return (
        o.order_id.toLowerCase().includes(q) ||
        o.customer_id.toLowerCase().includes(q) ||
        o.sku.toLowerCase().includes(q) ||
        o.descricao_produto.toLowerCase().includes(q) ||
        o.cidade.toLowerCase().includes(q) ||
        o.lote_produto.toLowerCase().includes(q) ||
        (o.maquina ?? "").toLowerCase().includes(q)
      );
    };

    if (filters.scope === "resolved") {
      const orders = computed.resolvedOrders.filter(matchesOrder);
      const byCust = new Map<string, typeof orders>();
      for (const o of orders) {
        const list = byCust.get(o.customer_id) ?? [];
        list.push(o);
        byCust.set(o.customer_id, list);
      }
      const portfolios: CustomerPortfolio[] = Array.from(byCust.entries()).map(
        ([cid, list]) => ({
          customer_id: cid,
          customer: computed.customersMap.get(cid) ?? {
            customer_id: cid,
            n_pedidos: list[0].customerOrderCount,
            receita_acumulada: list[0].customerAccumulatedRevenue,
            data_primeiro_pedido: list[0].data_pedido,
            n_contatos_atendimento: 1,
          },
          isVip: list[0].isVipCustomer,
          orders: list,
          orderCount: list.length,
          totalOrderValueBRL: round2(list.reduce((a, x) => a + x.valor, 0)),
          directOrderRiskBRL: 0,
          marginalCliffBRL: 0,
          customerLtvRiskBRL: list[0].customerLtvAtRiskSingleBRL,
          avoidedSacContactsBRL: Math.max(0, list.length - 1) * 9,
          freightConsolidationSavingsBRL: 0,
          riskTotalBRL: round2(
            list.reduce((a, x) => a + (x.resolvedSavingsBRL ?? 0), 0)
          ),
          canConsolidatePhysicalBox: false,
          earliestExceptionDate: list[0].data_abertura_excecao,
          brands: Array.from(new Set(list.map((x) => x.marca))),
          exceptionTypes: Array.from(new Set(list.map((x) => x.tipo_excecao))),
          anomalyBadges: [],
          topPriorityReason: "",
        })
      );
      return { portfolios, orders };
    }

    const remainingSlotsToday = Math.max(
      1,
      DAILY_HUMAN_CAPACITY - computed.resolvedTreatmentsCount
    );
    const basePool =
      filters.scope === "top150" && !q
        ? computed.allPortfolios.slice(0, remainingSlotsToday)
        : computed.allPortfolios;

    const portfolios = basePool
      .map((p) => {
        const matchedOrders = p.orders.filter(matchesOrder);
        if (matchedOrders.length === 0) return null;
        if (filters.onlyMultiOrder && p.orderCount < 2) return null;
        if (filters.onlyVip && !p.isVip) return null;
        return p;
      })
      .filter((p): p is CustomerPortfolio => p !== null);

    const allowedCustomerIds = new Set(portfolios.map((p) => p.customer_id));
    const orders = computed.activeEnriched
      .filter((o) => allowedCustomerIds.has(o.customer_id) && matchesOrder(o))
      .sort(
        (a, b) =>
          b.directOrderRiskBRL +
          b.marginalCliffBRL -
          (a.directOrderRiskBRL + a.marginalCliffBRL)
      );

    return { portfolios, orders };
  }, [computed, filters]);

  async function handleResetData() {
    setIsResetting(true);
    try {
      await ensureDatabaseSeeded(true);
      setCachedPlans({});
      setSelectedCustomerId(null);
      setToast("Dados restaurados.");
    } finally {
      setIsResetting(false);
    }
  }

  function handleExportCsv() {
    if (!computed) return;
    const rowsToExport =
      activeSection === "triage"
        ? computed.autoTriagedOrders
        : activeSection === "overview"
        ? computed.activeEnriched
        : filteredData.orders;
    const csv = serializeEnrichedOrdersCsv(rowsToExport);
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `opera-${activeSection}-${rowsToExport.length}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setToast(`CSV exportado (${rowsToExport.length} pedidos).`);
  }

  async function handleExecutePortfolioResolution(params: {
    portfolio: CustomerPortfolio;
    selectedOrders: CustomerPortfolio["orders"];
    plan: PortfolioResolutionPlan | null;
    actionOverrides: Record<string, RecommendedActionType>;
    customMessage: string;
  }) {
    const res = await executePortfolioResolution({
      customerId: params.portfolio.customer_id,
      enrichedOrders: params.selectedOrders,
      plan: params.plan,
      actionOverrides: params.actionOverrides,
      customMessage: params.customMessage,
    });

    const isPartial =
      params.selectedOrders.length < params.portfolio.orders.length;
    const remainingOrders = params.portfolio.orders.filter(
      (o) => !params.selectedOrders.some((s) => s.order_id === o.order_id)
    );

    setToast(
      isPartial
        ? `${res.resolvedCount} de ${params.portfolio.orders.length} pedido(s) de ${params.portfolio.customer_id} concluído(s) (+${formatBRL(res.totalSavingsBRL)}) • ${remainingOrders.length} segue(m) na fila`
        : `Carteira ${params.portfolio.customer_id} concluída (+${formatBRL(res.totalSavingsBRL)})${
            res.claimsOpened > 0 ? ` • ${res.claimsOpened} sinistro(s)` : ""
          }`
    );

    const remainingMatchingCurrentCd =
      filters.cd === "all"
        ? remainingOrders
        : remainingOrders.filter((o) => o.cd === filters.cd);

    if (!isPartial || remainingMatchingCurrentCd.length === 0) {
      const nextPortfolio = filteredData.portfolios.find(
        (p) => p.customer_id !== params.portfolio.customer_id
      );
      setSelectedCustomerId(nextPortfolio?.customer_id ?? null);
    }
  }

  if (isBootstrapping || !computed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-slate-800" />
        <p className="mt-2.5 text-xs font-medium text-slate-500">
          Carregando operação...
        </p>
        {bootError && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {bootError}
          </div>
        )}
      </div>
    );
  }

  const activeContainments = (containments ?? []).filter((c) => c.active);
  const claimsList = claims ?? [];
  const claimsTotalBRL = round2(
    claimsList.reduce((acc, c) => acc + c.valor_reclamado_brl, 0)
  );
  const exportCount =
    activeSection === "triage"
      ? computed.autoTriagedOrders.length
      : activeSection === "overview"
      ? computed.activeEnriched.length
      : filteredData.orders.length;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100/80">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        queueCount={computed.allPortfolios.length}
        anomaliesCount={computed.anomalies.length}
        activeContainmentsCount={activeContainments.length}
        autoTriagedCount={computed.autoTriagedOrders.length}
        claimsCount={claimsList.length}
        exportCount={exportCount}
        onOpenIngest={() => setIsIngestOpen(true)}
        onExportCsv={handleExportCsv}
        onResetData={handleResetData}
        isResetting={isResetting}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <KpiHeader
          activeSection={activeSection}
          totalActiveExposureBRL={computed.totalActiveExposureBRL}
          totalProtectedSavingsBRL={computed.totalProtectedSavingsBRL}
          resolvedTreatmentsCount={computed.resolvedTreatmentsCount}
          dailyCapacity={DAILY_HUMAN_CAPACITY}
          claimsTotalBRL={claimsTotalBRL}
          activeContainmentsCount={activeContainments.length}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-[1440px]">
            {activeSection === "overview" && (
              <OverviewTab
                activeOrders={computed.activeEnriched}
                portfolios={computed.allPortfolios}
                anomalies={computed.anomalies}
                simulation={computed.simulation}
                totalActiveExposureBRL={computed.totalActiveExposureBRL}
                totalProtectedSavingsBRL={computed.totalProtectedSavingsBRL}
                resolvedTreatmentsCount={computed.resolvedTreatmentsCount}
                resolvedOrdersCount={computed.resolvedOrders.length}
                autoTriagedCount={computed.autoTriagedOrders.length}
                onJumpToException={(tipo: ExceptionType) => {
                  setFilters({
                    ...DEFAULT_FILTERS,
                    scope: "all_active",
                    tipoExcecao: tipo,
                  });
                  setSelectedCustomerId(null);
                  setActiveSection("queue");
                }}
                onJumpToCarrier={(carrier: string) => {
                  setFilters({
                    ...DEFAULT_FILTERS,
                    scope: "all_active",
                    transportadora: carrier,
                  });
                  setSelectedCustomerId(null);
                  setActiveSection("queue");
                }}
                onJumpToPortfolio={(customerId: string) => {
                  setFilters(DEFAULT_FILTERS);
                  setSelectedCustomerId(customerId);
                  setActiveSection("queue");
                }}
                onNavigateQueue={() => setActiveSection("queue")}
                onNavigateRadar={() => setActiveSection("radar")}
                onNavigateTriage={() => setActiveSection("triage")}
              />
            )}

            {activeSection === "queue" && (
              <SmartQueueTab
                filters={filters}
                onChangeFilters={setFilters}
                filteredPortfolios={filteredData.portfolios}
                filteredOrders={filteredData.orders}
                allBrands={computed.allBrands}
                allCarriers={computed.allCarriers}
                customersMap={computed.customersMap}
                carriersByUf={computed.carriersByUf}
                activeContainments={activeContainments}
                selectedCustomerId={selectedCustomerId}
                onSelectCustomerId={setSelectedCustomerId}
                cachedPlans={cachedPlans}
                onPlanGenerated={(cid, plan) =>
                  setCachedPlans((prev) => ({ ...prev, [cid]: plan }))
                }
                onExecuteResolution={handleExecutePortfolioResolution}
              />
            )}

            {activeSection === "radar" && (
              <SystemicRadarTab
                anomalies={computed.anomalies}
                containments={containments ?? []}
                allOrders={computed.enrichedOrders}
                onActivateContainment={async (plan: SystemicContainmentPlan) => {
                  await activateSystemicContainment(plan);
                  setToast(`Bloqueio ativado: ${plan.blockedTarget}`);
                }}
                onToggleContainment={async (id, active) => {
                  await toggleContainmentActive(id, active);
                  setToast(active ? "Bloqueio reativado." : "Bloqueio pausado.");
                }}
              />
            )}

            {(activeSection === "triage" || activeSection === "claims") && (
              <AutoTriageAuditTab
                mode={activeSection}
                autoTriagedOrders={computed.autoTriagedOrders}
                claims={claimsList}
                auditLogs={auditLogs ?? []}
                potentialClaimPoolBRL={computed.potentialClaimPoolBRL}
                onRevertToHumanQueue={async (orderId) => {
                  await revertAutoTriagedOrderToHumanQueue(orderId);
                  setToast(`Pedido ${orderId} movido para a fila.`);
                }}
              />
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-semibold text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      <IngestModal
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
        onIngestOrders={async (orders: RawOrder[], source) => {
          const result = await ingestNewOrders(orders, source);
          if (orders.length === 1 && result.activeAdded === 1) {
            setSelectedCustomerId(orders[0].customer_id);
            setActiveSection("queue");
          }
          return result;
        }}
      />
    </div>
  );
}

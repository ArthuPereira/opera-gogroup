"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Crown,
  FileWarning,
  Loader2,
  MessageSquareText,
  PackageCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import {
  calculateFreightConsolidationSavings,
  checkTripleFreightLock,
  round2,
  SAC_CONTACT_COST_BRL,
} from "@/lib/business-rules";
import {
  ACTION_LABELS,
  EXCEPTION_LABELS,
  formatBRL,
  formatIsoDateBR,
} from "@/lib/format";
import {
  CarrierRoute,
  ContainmentOrder,
  CustomerPortfolio,
  EnrichedOrder,
  PortfolioResolutionPlan,
  RecommendedActionType,
} from "@/lib/types";

interface AgentActionPanelProps {
  portfolio: CustomerPortfolio | null;
  carriersByUf: Map<string, CarrierRoute[]>;
  activeContainments: ContainmentOrder[];
  cachedPlans: Record<string, PortfolioResolutionPlan>;
  activeCdFilter?: string;
  focusedOrderId?: string | null;
  onPlanGenerated: (planKey: string, plan: PortfolioResolutionPlan) => void;
  onExecuteResolution: (params: {
    portfolio: CustomerPortfolio;
    selectedOrders: EnrichedOrder[];
    plan: PortfolioResolutionPlan | null;
    actionOverrides: Record<string, RecommendedActionType>;
    customMessage: string;
  }) => Promise<void>;
}

export function AgentActionPanel({
  portfolio,
  carriersByUf,
  activeContainments,
  cachedPlans,
  activeCdFilter = "all",
  focusedOrderId = null,
  onPlanGenerated,
  onExecuteResolution,
}: AgentActionPanelProps) {
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [actionOverrides, setActionOverrides] = useState<
    Record<string, RecommendedActionType>
  >({});
  const [customMessage, setCustomMessage] = useState("");

  const orderIdsSignature = portfolio
    ? portfolio.orders.map((o) => o.order_id).join(",")
    : "";

  useEffect(() => {
    setAgentError(null);
    setActionOverrides({});
    if (!portfolio) {
      setSelectedOrderIds([]);
      return;
    }

    if (
      focusedOrderId &&
      portfolio.orders.some((o) => o.order_id === focusedOrderId)
    ) {
      setSelectedOrderIds([focusedOrderId]);
      return;
    }

    if (activeCdFilter && activeCdFilter !== "all") {
      const cdMatches = portfolio.orders
        .filter((o) => o.cd === activeCdFilter)
        .map((o) => o.order_id);
      if (cdMatches.length > 0) {
        setSelectedOrderIds(cdMatches);
        return;
      }
    }

    setSelectedOrderIds(portfolio.orders.map((o) => o.order_id));
  }, [portfolio?.customer_id, orderIdsSignature, activeCdFilter, focusedOrderId]);

  const selectedOrders = useMemo(() => {
    if (!portfolio) return [];
    const idSet = new Set(selectedOrderIds);
    return portfolio.orders.filter((o) => idSet.has(o.order_id));
  }, [portfolio, selectedOrderIds]);

  const planKey = useMemo(() => {
    if (!portfolio || selectedOrders.length === 0) return "";
    if (selectedOrders.length === portfolio.orders.length) {
      return portfolio.customer_id;
    }
    return `${portfolio.customer_id}:${selectedOrders
      .map((o) => o.order_id)
      .sort()
      .join(",")}`;
  }, [portfolio, selectedOrders]);

  const cachedPlan = planKey ? cachedPlans[planKey] ?? null : null;

  useEffect(() => {
    if (!portfolio || selectedOrders.length === 0) {
      setCustomMessage("");
      return;
    }

    if (cachedPlan) {
      setCustomMessage(cachedPlan.customerMessage);
      return;
    }

    const orderListText =
      selectedOrders.length > 1
        ? `seus pedidos (${selectedOrders.map((o) => o.order_id).join(", ")})`
        : `seu pedido ${selectedOrders[0].order_id}`;
    const summaryActions = selectedOrders
      .map((o) => {
        const act =
          actionOverrides[o.order_id] ?? o.economics.recommendedOption.action;
        return `${o.order_id}: ${ACTION_LABELS[act]}`;
      })
      .join(" | ");
    setCustomMessage(
      `Olá! Revisamos ${orderListText} e já liberamos a solução prioritária (${summaryActions}). Qualquer dúvida, responda por aqui.`
    );
  }, [portfolio?.customer_id, planKey, cachedPlan, selectedOrders, actionOverrides]);

  if (!portfolio) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <PackageCheck className="h-8 w-8 text-slate-400" />
        <p className="mt-2 text-xs font-medium text-slate-500">
          Selecione um cliente na lista ao lado.
        </p>
      </div>
    );
  }

  const isAllResolved = portfolio.orders.every(
    (o) => o.workflowStatus === "resolved"
  );
  const distinctCds = Array.from(
    new Set(portfolio.orders.map((o) => o.cd))
  ).sort();
  const hasMultipleCds = distinctCds.length > 1;

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((prev) => {
      if (prev.includes(orderId)) {
        if (prev.length === 1) return prev; // Mantém ao menos 1 selecionado
        return prev.filter((id) => id !== orderId);
      }
      return [...prev, orderId];
    });
  }

  async function handleRunAgent() {
    if (!portfolio || selectedOrders.length === 0) return;
    setIsInvestigating(true);
    setAgentError(null);
    try {
      const carriersRecord: Record<string, CarrierRoute[]> = {};
      for (const o of selectedOrders) {
        carriersRecord[o.uf] = carriersByUf.get(o.uf) ?? [];
      }

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "portfolio_resolution",
          customer: portfolio.customer,
          orders: selectedOrders,
          carriersByUf: carriersRecord,
          activeContainments,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Erro HTTP ${res.status}`);
      }

      const plan = data as PortfolioResolutionPlan;
      onPlanGenerated(planKey, plan);
      setCustomMessage(plan.customerMessage);
    } catch (err) {
      setAgentError(
        err instanceof Error ? err.message : "Falha ao gerar análise."
      );
    } finally {
      setIsInvestigating(false);
    }
  }

  async function handleApprovePlan() {
    if (!portfolio || selectedOrders.length === 0) return;
    setIsExecuting(true);
    try {
      await onExecuteResolution({
        portfolio,
        selectedOrders,
        plan: cachedPlan,
        actionOverrides,
        customMessage,
      });
    } finally {
      setIsExecuting(false);
    }
  }

  const selectedFreightSavings =
    calculateFreightConsolidationSavings(selectedOrders);
  const selectedCanConsolidate = checkTripleFreightLock(selectedOrders);

  const selectedRiskBRL = round2(
    selectedOrders.reduce(
      (acc, o) => acc + o.directOrderRiskBRL + o.marginalCliffBRL,
      0
    ) +
      (selectedOrders.length > 0 ? portfolio.customerLtvRiskBRL : 0) +
      Math.max(0, selectedOrders.length - 1) * SAC_CONTACT_COST_BRL
  );

  const totalEligibleClaims = selectedOrders.reduce(
    (acc, o) => acc + o.economics.eligibleCarrierClaimBRL,
    0
  );

  const rawSelectedDirectCost = selectedOrders.reduce((acc, o) => {
    const selectedAction =
      actionOverrides[o.order_id] ??
      cachedPlan?.decisions.find((d) => d.order_id === o.order_id)
        ?.recommendedAction ??
      o.economics.recommendedOption.action;

    const allQuotes = [
      o.economics.recommendedOption,
      ...o.economics.alternativeOptions,
    ];
    const q =
      allQuotes.find((opt) => opt.action === selectedAction) ??
      o.economics.recommendedOption;
    return acc + q.directCostBRL;
  }, 0);

  const estimatedDirectExecutionCost = round2(
    Math.max(0, rawSelectedDirectCost - selectedFreightSavings)
  );

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-xs">
      {/* Compact Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-slate-900">
              {portfolio.customer_id}
            </span>
            {portfolio.isVip && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                <Crown className="h-3 w-3 text-amber-500" />
                VIP • {formatBRL(portfolio.customer.receita_acumulada, true)}
              </span>
            )}
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {portfolio.customer.n_pedidos} compras • LTV{" "}
              {formatBRL(portfolio.customerLtvRiskBRL)}
            </span>
            {hasMultipleCds && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                <Building2 className="h-3 w-3 text-amber-600" />
                {distinctCds.join(" + ")}
              </span>
            )}
            {selectedFreightSavings > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                <Truck className="h-3 w-3" />
                {selectedCanConsolidate ? "Caixa única" : "Consolidação parcial"}{" "}
                (-{formatBRL(selectedFreightSavings)})
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="text-right">
            <div className="text-[10px] font-medium uppercase text-slate-400">
              {selectedOrders.length < portfolio.orders.length
                ? `Risco (${selectedOrders.length}/${portfolio.orders.length})`
                : "Risco"}
            </div>
            <div className="font-mono text-base font-bold text-rose-600 leading-none">
              {formatBRL(selectedRiskBRL)}
            </div>
          </div>

          <button
            type="button"
            onClick={handleRunAgent}
            disabled={
              isInvestigating || isAllResolved || selectedOrders.length === 0
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
          >
            {isInvestigating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analisando...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                {cachedPlan ? "Reanalisar" : "Analisar com IA"}
              </>
            )}
          </button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {/* Multi-order & Multi-CD Selection Bar */}
        {portfolio.orders.length > 1 && !isAllResolved && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="font-medium text-slate-600">
              Tratando{" "}
              <strong className="text-slate-900">
                {selectedOrders.length} de {portfolio.orders.length}
              </strong>{" "}
              pedidos
              {hasMultipleCds && (
                <span className="ml-1 text-[11px] text-slate-500">
                  (CDs distintos têm expedição independente)
                </span>
              )}
            </span>

            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setSelectedOrderIds(portfolio.orders.map((o) => o.order_id))
                }
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                  selectedOrders.length === portfolio.orders.length
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                }`}
              >
                Todos ({portfolio.orders.length})
              </button>

              {hasMultipleCds &&
                distinctCds.map((cd) => {
                  const cdIds = portfolio.orders
                    .filter((o) => o.cd === cd)
                    .map((o) => o.order_id);
                  const isExactCdSelected =
                    selectedOrderIds.length === cdIds.length &&
                    cdIds.every((id) => selectedOrderIds.includes(id));
                  return (
                    <button
                      key={cd}
                      type="button"
                      onClick={() => setSelectedOrderIds(cdIds)}
                      className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                        isExactCdSelected
                          ? "bg-slate-900 text-white"
                          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      Só {cd} ({cdIds.length})
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {agentError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {agentError}
          </div>
        )}

        {/* AI Result Summary + Collapsible Steps */}
        {cachedPlan && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs">
            <p className="font-medium text-slate-800">
              {cachedPlan.executiveSummary}
            </p>

            {cachedPlan.toolTraces.length > 0 && (
              <details className="group mt-2">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline">
                  <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                  Ver etapas da análise ({cachedPlan.toolTraces.length})
                </summary>
                <div className="mt-2 space-y-1 rounded-lg bg-slate-900 p-2.5 text-[11px] text-slate-200">
                  {cachedPlan.toolTraces.map((trace) => (
                    <div key={`${trace.step}-${trace.toolName}`}>
                      <span className="font-mono text-indigo-300">
                        {trace.step}. {trace.toolName}:
                      </span>{" "}
                      {trace.summary}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Orders List */}
        <div className="space-y-2.5">
          {portfolio.orders.map((order) => {
            const isChecked = selectedOrderIds.includes(order.order_id);
            const agentDecision = cachedPlan?.decisions.find(
              (d) => d.order_id === order.order_id
            );
            const currentSelectedAction: RecommendedActionType =
              actionOverrides[order.order_id] ??
              agentDecision?.recommendedAction ??
              order.economics.recommendedOption.action;

            const allQuotes = [
              order.economics.recommendedOption,
              ...order.economics.alternativeOptions,
            ];

            const guards =
              agentDecision?.antiRecurrenceGuards?.length
                ? agentDecision.antiRecurrenceGuards
                : order.economics.recommendedOption.antiRecurrenceGuards;

            return (
              <div
                key={order.order_id}
                className={`rounded-xl border p-3 transition ${
                  isChecked
                    ? "border-slate-200 bg-slate-50/40"
                    : "border-slate-200/70 bg-slate-50/20 opacity-55"
                }`}
              >
                {/* Row 1: Checkbox (multi-order), Order ID, CD, Brand, Exception + Price */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {portfolio.orders.length > 1 && !isAllResolved && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOrder(order.order_id)}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                        aria-label={`Selecionar pedido ${order.order_id}`}
                      />
                    )}
                    <span className="font-mono text-xs font-bold text-slate-900">
                      {order.order_id}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${
                        hasMultipleCds
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {order.cd}
                    </span>
                    <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 border border-slate-200">
                      {order.marca}
                    </span>
                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200">
                      {EXCEPTION_LABELS[order.tipo_excecao]}
                    </span>
                    {order.brinde_no_pedido && (
                      <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                        Brinde
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {portfolio.orders.length > 1 &&
                      !isAllResolved &&
                      !(isChecked && selectedOrders.length === 1) && (
                        <button
                          type="button"
                          onClick={() => setSelectedOrderIds([order.order_id])}
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                          Tratar só este
                        </button>
                      )}
                    {order.economics.eligibleCarrierClaimBRL > 0 && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                        <FileWarning className="h-3 w-3" />
                        Sinistro +{formatBRL(order.economics.eligibleCarrierClaimBRL)}
                      </span>
                    )}
                    <span className="font-mono text-xs font-bold text-slate-900">
                      {formatBRL(order.valor)}
                    </span>
                  </div>
                </div>

                {/* Row 2: Compact Chips */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-700">
                    {order.sku} ({order.qtd_itens}x)
                  </span>
                  <span>
                    {order.turno}
                    {order.maquina ? ` • ${order.maquina}` : ""} •{" "}
                    {order.lote_produto}
                  </span>
                  <span>
                    {order.cidade}/{order.uf} ({order.transportadora})
                  </span>
                  <span>
                    Prazo real: <strong>{formatIsoDateBR(order.realDueDate)}</strong>
                    {order.businessDaysLate > 0 && (
                      <span className="ml-1 text-rose-600 font-semibold">
                        (+{order.businessDaysLate}d úteis)
                      </span>
                    )}
                  </span>
                </div>

                {/* Row 3: Short Guard Badge */}
                {guards.length > 0 && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span className="line-clamp-2">{guards.join(" • ")}</span>
                  </div>
                )}

                {/* Row 4: Clean Action Selector */}
                {isChecked && (
                  <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                    {allQuotes.slice(0, 3).map((quote) => {
                      const isSelected = quote.action === currentSelectedAction;
                      const isOptimal =
                        quote.action === order.economics.recommendedOption.action;
                      return (
                        <button
                          key={quote.action}
                          type="button"
                          onClick={() =>
                            setActionOverrides((prev) => ({
                              ...prev,
                              [order.order_id]: quote.action,
                            }))
                          }
                          className={`rounded-lg border px-2.5 py-2 text-left transition ${
                            isSelected
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-[11px] font-semibold">
                              {ACTION_LABELS[quote.action]}
                            </span>
                            {isOptimal && (
                              <span
                                className={`shrink-0 rounded px-1 py-0.2 text-[9px] font-bold ${
                                  isSelected
                                    ? "bg-emerald-500 text-slate-950"
                                    : "bg-emerald-50 text-emerald-700"
                                }`}
                              >
                                Ideal
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[11px]">
                            <span
                              className={`truncate ${
                                isSelected ? "text-slate-300" : "text-slate-400"
                              }`}
                            >
                              {quote.recommendedCarrier}
                            </span>
                            <strong className="font-mono">
                              {formatBRL(quote.directCostBRL)}
                            </strong>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Collapsible Customer Message */}
        <details className="group rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <MessageSquareText className="h-3.5 w-3.5 text-slate-500" />
              Mensagem ao cliente ({selectedOrders.length}{" "}
              {selectedOrders.length === 1 ? "pedido" : "pedidos"})
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition group-open:rotate-180" />
          </summary>
          <textarea
            rows={3}
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 focus:border-slate-400 focus:outline-none"
          />
        </details>

        {/* Clean Approval Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span>
              Custo direto:{" "}
              <strong className="text-slate-900">
                {formatBRL(estimatedDirectExecutionCost)}
              </strong>
            </span>
            {totalEligibleClaims > 0 && (
              <span className="text-emerald-700 font-medium">
                • Reembolso transp.: +{formatBRL(totalEligibleClaims)}
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={
              isExecuting || isAllResolved || selectedOrders.length === 0
            }
            onClick={handleApprovePlan}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : isAllResolved ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Resolvido
              </>
            ) : (
              <>
                <Check className="h-4 w-4 stroke-[2.5]" />
                {portfolio.orders.length > 1 &&
                selectedOrders.length < portfolio.orders.length
                  ? `Aprovar ${selectedOrders.length} de ${portfolio.orders.length}`
                  : "Aprovar tratativa"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

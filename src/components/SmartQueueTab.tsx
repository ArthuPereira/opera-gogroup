"use client";

import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  Crown,
  Layers,
  ListOrdered,
  Search,
  Sparkles,
  Truck,
  X,
} from "lucide-react";
import { EXCEPTION_LABELS, formatBRL } from "@/lib/format";
import {
  CarrierRoute,
  ContainmentOrder,
  Customer,
  CustomerPortfolio,
  EnrichedOrder,
  ExceptionType,
  PortfolioResolutionPlan,
  RecommendedActionType,
} from "@/lib/types";
import { AgentActionPanel } from "./AgentActionPanel";

export interface QueueFiltersState {
  search: string;
  scope: "top150" | "all_active" | "resolved";
  viewMode: "portfolio" | "order";
  marca: string;
  tipoExcecao: string;
  cd: string;
  transportadora: string;
  onlyVip: boolean;
  onlyMultiOrder: boolean;
}

interface SmartQueueTabProps {
  filters: QueueFiltersState;
  onChangeFilters: (next: QueueFiltersState) => void;
  filteredPortfolios: CustomerPortfolio[];
  filteredOrders: EnrichedOrder[];
  allBrands: string[];
  allCarriers: string[];
  customersMap: Map<string, Customer>;
  carriersByUf: Map<string, CarrierRoute[]>;
  activeContainments: ContainmentOrder[];
  selectedCustomerId: string | null;
  onSelectCustomerId: (customerId: string) => void;
  cachedPlans: Record<string, PortfolioResolutionPlan>;
  onPlanGenerated: (customerId: string, plan: PortfolioResolutionPlan) => void;
  onExecuteResolution: (params: {
    portfolio: CustomerPortfolio;
    plan: PortfolioResolutionPlan | null;
    actionOverrides: Record<string, RecommendedActionType>;
    customMessage: string;
  }) => Promise<void>;
}

export function SmartQueueTab({
  filters,
  onChangeFilters,
  filteredPortfolios,
  filteredOrders,
  allBrands,
  allCarriers,
  customersMap,
  carriersByUf,
  activeContainments,
  selectedCustomerId,
  onSelectCustomerId,
  cachedPlans,
  onPlanGenerated,
  onExecuteResolution,
}: SmartQueueTabProps) {
  const [visibleLimit, setVisibleLimit] = useState(60);

  const activePortfolio = useMemo<CustomerPortfolio | null>(() => {
    if (!selectedCustomerId) {
      return filteredPortfolios[0] ?? null;
    }
    const found = filteredPortfolios.find(
      (p) => p.customer_id === selectedCustomerId
    );
    if (found) return found;

    const matchingOrders = filteredOrders.filter(
      (o) => o.customer_id === selectedCustomerId
    );
    if (matchingOrders.length === 0) {
      return filteredPortfolios[0] ?? null;
    }
    const first = matchingOrders[0];
    const customer = customersMap.get(selectedCustomerId) ?? {
      customer_id: selectedCustomerId,
      n_pedidos: first.customerOrderCount,
      receita_acumulada: first.customerAccumulatedRevenue,
      data_primeiro_pedido: first.data_pedido,
      n_contatos_atendimento: 1,
    };
    return {
      customer_id: selectedCustomerId,
      customer,
      isVip: first.isVipCustomer,
      orders: matchingOrders,
      orderCount: matchingOrders.length,
      totalOrderValueBRL: matchingOrders.reduce((a, o) => a + o.valor, 0),
      directOrderRiskBRL: matchingOrders.reduce(
        (a, o) => a + o.directOrderRiskBRL,
        0
      ),
      marginalCliffBRL: matchingOrders.reduce(
        (a, o) => a + o.marginalCliffBRL,
        0
      ),
      customerLtvRiskBRL: first.customerLtvAtRiskSingleBRL,
      avoidedSacContactsBRL: Math.max(0, matchingOrders.length - 1) * 9,
      freightConsolidationSavingsBRL: 0,
      riskTotalBRL:
        matchingOrders.reduce(
          (a, o) => a + o.directOrderRiskBRL + o.marginalCliffBRL,
          0
        ) + first.customerLtvAtRiskSingleBRL,
      canConsolidatePhysicalBox: false,
      earliestExceptionDate: first.data_abertura_excecao,
      brands: Array.from(new Set(matchingOrders.map((o) => o.marca))),
      exceptionTypes: Array.from(
        new Set(matchingOrders.map((o) => o.tipo_excecao))
      ),
      anomalyBadges: Array.from(
        new Set(matchingOrders.flatMap((o) => o.anomalyFlags))
      ),
      topPriorityReason: "",
    };
  }, [
    selectedCustomerId,
    filteredPortfolios,
    filteredOrders,
    customersMap,
  ]);

  const hasActiveFilter =
    Boolean(filters.search) ||
    filters.marca !== "all" ||
    filters.tipoExcecao !== "all" ||
    filters.cd !== "all" ||
    filters.transportadora !== "all" ||
    filters.onlyVip ||
    filters.onlyMultiOrder;

  function resetFilters() {
    onChangeFilters({
      ...filters,
      search: "",
      marca: "all",
      tipoExcecao: "all",
      cd: "all",
      transportadora: "all",
      onlyVip: false,
      onlyMultiOrder: false,
    });
  }

  const displayedPortfolios = filteredPortfolios.slice(0, visibleLimit);
  const displayedOrders = filteredOrders.slice(0, visibleLimit);

  return (
    <div className="space-y-3">
      {/* Compact Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) =>
                onChangeFilters({ ...filters, search: e.target.value })
              }
              placeholder="Buscar pedido, cliente, SKU ou cidade..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
            />
            {filters.search && (
              <button
                type="button"
                onClick={() => onChangeFilters({ ...filters, search: "" })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Scope */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onChangeFilters({ ...filters, scope: "top150" })}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                filters.scope === "top150"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Prioridade (150)
            </button>
            <button
              type="button"
              onClick={() =>
                onChangeFilters({ ...filters, scope: "all_active" })
              }
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                filters.scope === "all_active"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => onChangeFilters({ ...filters, scope: "resolved" })}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                filters.scope === "resolved"
                  ? "bg-emerald-700 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Resolvidos
            </button>
          </div>

          {/* View Mode */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
            <button
              type="button"
              onClick={() =>
                onChangeFilters({ ...filters, viewMode: "portfolio" })
              }
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                filters.viewMode === "portfolio"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Layers className="h-3.5 w-3.5 text-indigo-600" />
              Carteiras ({filteredPortfolios.length})
            </button>
            <button
              type="button"
              onClick={() => onChangeFilters({ ...filters, viewMode: "order" })}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                filters.viewMode === "order"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ListOrdered className="h-3.5 w-3.5 text-slate-500" />
              Pedidos ({filteredOrders.length})
            </button>
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <select
            value={filters.marca}
            onChange={(e) =>
              onChangeFilters({ ...filters, marca: e.target.value })
            }
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="all">Marca: Todas</option>
            {allBrands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            value={filters.tipoExcecao}
            onChange={(e) =>
              onChangeFilters({ ...filters, tipoExcecao: e.target.value })
            }
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="all">Exceção: Todas</option>
            {(Object.keys(EXCEPTION_LABELS) as ExceptionType[]).map((k) => (
              <option key={k} value={k}>
                {EXCEPTION_LABELS[k]}
              </option>
            ))}
          </select>

          <select
            value={filters.cd}
            onChange={(e) =>
              onChangeFilters({ ...filters, cd: e.target.value })
            }
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="all">CD: Todos</option>
            <option value="CD1">CD1</option>
            <option value="CD2">CD2</option>
          </select>

          <select
            value={filters.transportadora}
            onChange={(e) =>
              onChangeFilters({ ...filters, transportadora: e.target.value })
            }
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="all">Transportadora: Todas</option>
            {allCarriers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() =>
              onChangeFilters({ ...filters, onlyVip: !filters.onlyVip })
            }
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-medium transition ${
              filters.onlyVip
                ? "border-amber-400 bg-amber-50 text-amber-900"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Crown className="h-3 w-3 text-amber-500" />
            VIP
          </button>

          <button
            type="button"
            onClick={() =>
              onChangeFilters({
                ...filters,
                onlyMultiOrder: !filters.onlyMultiOrder,
              })
            }
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-medium transition ${
              filters.onlyMultiOrder
                ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            2+ pedidos
          </button>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto text-xs font-semibold text-rose-600 hover:underline"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Master-Detail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
        {/* Left Compact List (5 cols) */}
        <div className="lg:col-span-5 space-y-1.5 max-h-[calc(100vh-205px)] overflow-y-auto pr-1">
          {filters.viewMode === "portfolio" ? (
            displayedPortfolios.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                Nenhum resultado encontrado.
              </div>
            ) : (
              <>
                {displayedPortfolios.map((portfolio, index) => {
                  const isSelected =
                    activePortfolio?.customer_id === portfolio.customer_id;
                  const hasAgentPlan = Boolean(
                    cachedPlans[portfolio.customer_id]
                  );

                  return (
                    <button
                      key={portfolio.customer_id}
                      type="button"
                      onClick={() => onSelectCustomerId(portfolio.customer_id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              isSelected ? "text-emerald-400" : "text-slate-400"
                            }`}
                          >
                            #{index + 1}
                          </span>
                          <span className="font-mono text-xs font-bold">
                            {portfolio.customer_id}
                          </span>
                          {portfolio.isVip && (
                            <Crown className="h-3.5 w-3.5 text-amber-400" />
                          )}
                          {portfolio.orderCount > 1 && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                isSelected
                                  ? "bg-slate-800 text-indigo-300"
                                  : "bg-indigo-50 text-indigo-700"
                              }`}
                            >
                              {portfolio.orderCount} ped.
                            </span>
                          )}
                          {portfolio.canConsolidatePhysicalBox && (
                            <Truck
                              className={`h-3.5 w-3.5 ${
                                isSelected
                                  ? "text-emerald-400"
                                  : "text-emerald-600"
                              }`}
                            />
                          )}
                          {hasAgentPlan && (
                            <Sparkles className="h-3 w-3 text-indigo-400" />
                          )}
                        </div>

                        <span
                          className={`font-mono text-xs font-bold ${
                            isSelected ? "text-emerald-400" : "text-rose-600"
                          }`}
                        >
                          {formatBRL(portfolio.riskTotalBRL)}
                        </span>
                      </div>

                      <div
                        className={`mt-1 flex items-center justify-between text-[11px] ${
                          isSelected ? "text-slate-300" : "text-slate-500"
                        }`}
                      >
                        <span className="truncate pr-2">
                          {portfolio.brands.slice(0, 2).join(", ")} •{" "}
                          {portfolio.exceptionTypes
                            .slice(0, 2)
                            .map((t) => EXCEPTION_LABELS[t])
                            .join(" + ")}
                        </span>
                        <span className="shrink-0 text-[10px]">
                          {formatBRL(portfolio.totalOrderValueBRL, true)}
                        </span>
                      </div>
                    </button>
                  );
                })}

                {filteredPortfolios.length > visibleLimit && (
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((prev) => prev + 80)}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Carregar mais ({filteredPortfolios.length - visibleLimit})
                  </button>
                )}
              </>
            )
          ) : displayedOrders.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              Nenhum pedido encontrado.
            </div>
          ) : (
            <>
              {displayedOrders.map((order) => {
                const isSelected =
                  activePortfolio?.customer_id === order.customer_id;
                return (
                  <button
                    key={order.order_id}
                    type="button"
                    onClick={() => onSelectCustomerId(order.customer_id)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold">
                          {order.order_id}
                        </span>
                        <span
                          className={`font-mono text-[11px] ${
                            isSelected ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          {order.customer_id}
                        </span>
                        {order.workflowStatus === "resolved" && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                      </div>

                      <span
                        className={`font-mono text-xs font-bold ${
                          isSelected ? "text-emerald-400" : "text-rose-600"
                        }`}
                      >
                        {order.workflowStatus === "resolved"
                          ? `+${formatBRL(order.resolvedSavingsBRL ?? 0)}`
                          : formatBRL(
                              order.directOrderRiskBRL + order.marginalCliffBRL
                            )}
                      </span>
                    </div>

                    <div
                      className={`mt-1 flex items-center justify-between text-[11px] ${
                        isSelected ? "text-slate-300" : "text-slate-500"
                      }`}
                    >
                      <span className="truncate">
                        {order.marca} • {EXCEPTION_LABELS[order.tipo_excecao]}
                      </span>
                      <span className="shrink-0">
                        {order.cidade}/{order.uf}
                      </span>
                    </div>
                  </button>
                );
              })}

              {filteredOrders.length > visibleLimit && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 80)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Carregar mais ({filteredOrders.length - visibleLimit})
                </button>
              )}
            </>
          )}
        </div>

        {/* Right Detail Panel (7 cols) */}
        <div className="lg:col-span-7">
          <AgentActionPanel
            portfolio={activePortfolio}
            carriersByUf={carriersByUf}
            activeContainments={activeContainments}
            cachedPlan={
              activePortfolio
                ? cachedPlans[activePortfolio.customer_id] ?? null
                : null
            }
            onPlanGenerated={onPlanGenerated}
            onExecuteResolution={onExecuteResolution}
          />
        </div>
      </div>
    </div>
  );
}

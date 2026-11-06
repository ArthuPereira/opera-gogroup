"use client";

import React, { useMemo } from "react";
import {
  ArrowRight,
  Crown,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";
import { EXCEPTION_LABELS, formatBRL } from "@/lib/format";
import {
  CustomerPortfolio,
  EnrichedOrder,
  ExceptionType,
  QueueSimulationComparison,
  SystemicAnomaly,
} from "@/lib/types";

interface OverviewTabProps {
  activeOrders: EnrichedOrder[];
  portfolios: CustomerPortfolio[];
  anomalies: SystemicAnomaly[];
  simulation: QueueSimulationComparison;
  totalActiveExposureBRL: number;
  totalProtectedSavingsBRL: number;
  resolvedTreatmentsCount: number;
  resolvedOrdersCount: number;
  autoTriagedCount: number;
  onJumpToException: (tipo: ExceptionType) => void;
  onJumpToCarrier: (carrier: string) => void;
  onJumpToPortfolio: (customerId: string) => void;
  onNavigateQueue: () => void;
  onNavigateRadar: () => void;
  onNavigateTriage: () => void;
}

export function OverviewTab({
  activeOrders,
  portfolios,
  anomalies,
  simulation,
  totalActiveExposureBRL,
  totalProtectedSavingsBRL,
  resolvedTreatmentsCount,
  resolvedOrdersCount,
  autoTriagedCount,
  onJumpToException,
  onJumpToCarrier,
  onJumpToPortfolio,
  onNavigateQueue,
  onNavigateRadar,
  onNavigateTriage,
}: OverviewTabProps) {
  const byException = useMemo(() => {
    const map = new Map<ExceptionType, { count: number; riskBRL: number }>();
    for (const o of activeOrders) {
      const cur = map.get(o.tipo_excecao) ?? { count: 0, riskBRL: 0 };
      cur.count += 1;
      cur.riskBRL += o.directOrderRiskBRL + o.marginalCliffBRL;
      map.set(o.tipo_excecao, cur);
    }
    return Array.from(map.entries())
      .map(([tipo, v]) => ({ tipo, ...v }))
      .sort((a, b) => b.riskBRL - a.riskBRL)
      .slice(0, 6);
  }, [activeOrders]);

  const byCarrier = useMemo(() => {
    const map = new Map<string, { count: number; riskBRL: number }>();
    for (const o of activeOrders) {
      const cur = map.get(o.transportadora) ?? { count: 0, riskBRL: 0 };
      cur.count += 1;
      cur.riskBRL += o.directOrderRiskBRL + o.marginalCliffBRL;
      map.set(o.transportadora, cur);
    }
    return Array.from(map.entries())
      .map(([carrier, v]) => ({ carrier, ...v }))
      .sort((a, b) => b.riskBRL - a.riskBRL);
  }, [activeOrders]);

  const maxExcRisk = byException[0]?.riskBRL || 1;
  const maxCarrierRisk = byCarrier[0]?.riskBRL || 1;

  const capacityPct = Math.min(
    100,
    Math.round(
      (resolvedTreatmentsCount / simulation.dailyCapacityTreatments) * 100
    )
  );

  return (
    <div className="space-y-5">
      {/* Row 1: 4 Clean KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={onNavigateQueue}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-slate-300"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Risco em Aberto</span>
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-slate-900">
              {formatBRL(totalActiveExposureBRL, true)}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {activeOrders.length} pedidos
            </span>
          </div>
        </button>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Valor Protegido</span>
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-emerald-600">
              +{formatBRL(totalProtectedSavingsBRL, true)}
            </span>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {resolvedOrdersCount} tratados
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onNavigateQueue}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-slate-300"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Meta Diária (150 tratativas)</span>
            <TrendingUp className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-slate-900">
              {resolvedTreatmentsCount}
              <span className="text-sm font-normal text-slate-400">
                /{simulation.dailyCapacityTreatments}
              </span>
            </span>
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
              Lote cobre {simulation.aiFirstOrdersUnlocked} ped.
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${Math.max(4, capacityPct)}%` }}
            />
          </div>
        </button>

        <button
          type="button"
          onClick={onNavigateTriage}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-slate-300"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Resolvidos na Triagem</span>
            <Zap className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-slate-900">
              {autoTriagedCount}
            </span>
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {((autoTriagedCount * 12) / 60).toFixed(0)}h poupadas
            </span>
          </div>
        </button>
      </div>

      {/* Row 2: Visual Distributions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Exceptions Chart (7 cols) */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-7">
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              Risco por Tipo de Exceção
            </h2>
            <span className="text-[11px] text-slate-400">
              Clique para filtrar na fila
            </span>
          </div>

          <div className="space-y-2.5">
            {byException.map((item) => {
              const pct = Math.max(4, Math.round((item.riskBRL / maxExcRisk) * 100));
              return (
                <button
                  key={item.tipo}
                  type="button"
                  onClick={() => onJumpToException(item.tipo)}
                  className="group block w-full text-left"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 group-hover:text-slate-950">
                      {EXCEPTION_LABELS[item.tipo]}
                    </span>
                    <span className="font-mono text-slate-500">
                      {item.count} ped. •{" "}
                      <strong className="text-slate-900">
                        {formatBRL(item.riskBRL, true)}
                      </strong>
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-800 transition-all group-hover:bg-indigo-600"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Carriers + Capacity Efficiency (5 cols) */}
        <div className="flex flex-col justify-between gap-4 lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-sm font-bold text-slate-900">
                Exposição por Transportadora
              </h2>
            </div>

            <div className="space-y-2">
              {byCarrier.map((item) => {
                const pct = Math.max(
                  4,
                  Math.round((item.riskBRL / maxCarrierRisk) * 100)
                );
                return (
                  <button
                    key={item.carrier}
                    type="button"
                    onClick={() => onJumpToCarrier(item.carrier)}
                    className="group block w-full text-left"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 group-hover:text-slate-950">
                        {item.carrier}
                      </span>
                      <span className="font-mono text-slate-500">
                        {item.count} •{" "}
                        <strong className="text-slate-900">
                          {formatBRL(item.riskBRL, true)}
                        </strong>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-rose-500 transition-all group-hover:bg-rose-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Compact Capacity Comparison */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Rendimento de 150 Tratativas/Dia
              </h2>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                {simulation.orderMultiplierVsFifo.toFixed(1)}x pedidos
              </span>
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-slate-500">
                  <span>Ordem de Chegada</span>
                  <span>
                    {simulation.fifoActiveOrdersUnlocked} ped. ({formatBRL(simulation.fifoRiskProtectedBRL, true)})
                  </span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-400"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (simulation.fifoActiveOrdersUnlocked /
                            Math.max(1, simulation.aiFirstOrdersUnlocked)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between font-semibold text-slate-900">
                  <span>Priorização por Carteira</span>
                  <span className="text-emerald-700">
                    {simulation.aiFirstOrdersUnlocked} ped. ({formatBRL(simulation.aiFirstRiskProtectedBRL, true)})
                  </span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                  <div className="h-full w-full rounded-full bg-emerald-500" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Quick Action Lists */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top 5 Portfolios */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              Carteiras Mais Críticas
            </h2>
            <button
              type="button"
              onClick={onNavigateQueue}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Ver fila <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {portfolios.slice(0, 5).map((p, i) => (
              <div
                key={p.customer_id}
                className="flex items-center justify-between py-2.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 font-mono text-[11px] font-bold text-slate-400">
                    #{i + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-slate-900">
                        {p.customer_id}
                      </span>
                      {p.isVip && (
                        <Crown className="h-3.5 w-3.5 text-amber-500" />
                      )}
                      {p.orderCount > 1 && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                          {p.orderCount} ped.
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {p.brands.slice(0, 2).join(", ")} •{" "}
                      {p.exceptionTypes
                        .slice(0, 2)
                        .map((t) => EXCEPTION_LABELS[t])
                        .join(", ")}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <strong className="font-mono text-rose-600">
                    {formatBRL(p.riskTotalBRL)}
                  </strong>
                  <button
                    type="button"
                    onClick={() => onJumpToPortfolio(p.customer_id)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Tratar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Root Causes Quick Status */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              Gargalos Operacionais Detectados
            </h2>
            <button
              type="button"
              onClick={onNavigateRadar}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Gerenciar bloqueios <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {anomalies.slice(0, 5).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between py-2.5 text-xs"
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-slate-900">
                      {a.targetEntity}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {a.area}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {a.affectedOrdersCount} pedidos • Exposição{" "}
                    {formatBRL(a.financialExposureBRL, true)}
                  </div>
                </div>

                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    a.isContained
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {a.isContained ? "Bloqueado" : "Pendente"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

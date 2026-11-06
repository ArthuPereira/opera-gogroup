"use client";

import React from "react";
import {
  Download,
  FilePlus2,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { formatBRL } from "@/lib/format";
import { QueueSimulationComparison } from "@/lib/types";

interface KpiHeaderProps {
  totalActiveExposureBRL: number;
  totalOrderValueActiveBRL: number;
  totalProtectedSavingsBRL: number;
  resolvedTreatmentsCount: number;
  resolvedOrdersCount: number;
  autoTriagedCount: number;
  claimsTotalBRL: number;
  claimsCount: number;
  activeContainmentsCount: number;
  filteredExportCount: number;
  simulation: QueueSimulationComparison;
  onOpenIngest: () => void;
  onExportFilteredCsv: () => void;
  onResetSimulation: () => void;
  isResetting: boolean;
}

export function KpiHeader({
  totalActiveExposureBRL,
  totalOrderValueActiveBRL,
  totalProtectedSavingsBRL,
  resolvedTreatmentsCount,
  resolvedOrdersCount,
  autoTriagedCount,
  claimsTotalBRL,
  claimsCount,
  activeContainmentsCount,
  filteredExportCount,
  simulation,
  onOpenIngest,
  onExportFilteredCsv,
  onResetSimulation,
  isResetting,
}: KpiHeaderProps) {
  const remainingTreatments = Math.max(
    0,
    simulation.dailyCapacityTreatments - resolvedTreatmentsCount
  );

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto max-w-[1600px] px-4 py-3 sm:px-6">
        {/* Top Row: Brand + Global Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
              <Sparkles className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                  Opera Gogroup
                </h1>
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  Central AI-First • IPA
                </span>
                {activeContainmentsCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {activeContainmentsCount} Contenç{activeContainmentsCount === 1 ? "ão Ativa" : "ões Ativas"}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Gocase & GoBeauté • Data-base 30/09/2026 • Priorização Financeira por Carteira + Agente Groq
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenIngest}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              <FilePlus2 className="h-3.5 w-3.5 text-emerald-400" />
              + Novo Pedido / Importar CSV
            </button>

            <button
              type="button"
              onClick={onExportFilteredCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              title="Exporta exatamente os registros da busca/filtros atuais enriquecidos com R$ em risco e ação recomendada"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              Exportar Busca ({filteredExportCount})
            </button>

            <button
              type="button"
              onClick={onResetSimulation}
              disabled={isResetting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
              title="Restaura os 2.042 pedidos originais no seu navegador"
            >
              <RotateCcw
                className={`h-3.5 w-3.5 ${isResetting ? "animate-spin" : ""}`}
              />
              Resetar Base
            </button>
          </div>
        </div>

        {/* Bottom Row: 4 Executive KPI Cards */}
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {/* KPI 1: Exposição vs Protegido */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Exposição Financeira Ativa (R$ Risco)</span>
              <ShieldAlert className="h-4 w-4 text-rose-500" />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold tracking-tight text-slate-900">
                {formatBRL(totalActiveExposureBRL)}
              </span>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                +{formatBRL(totalProtectedSavingsBRL)} protegidos
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              GMV em fila humana: {formatBRL(totalOrderValueActiveBRL)} (c/ LTV + Cliff)
            </p>
          </div>

          {/* KPI 2: Capacidade Diária (150 tratativas) */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Capacidade Diária (Meta 150/dia)</span>
              <TrendingUp className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold tracking-tight text-slate-900">
                {resolvedTreatmentsCount} / {simulation.dailyCapacityTreatments}{" "}
                <span className="text-xs font-normal text-slate-500">
                  tratativas ({resolvedOrdersCount} ped.)
                </span>
              </span>
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                {simulation.orderMultiplierVsFifo.toFixed(1)}x vs FIFO
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Top 150 Carteiras destravam{" "}
              <strong className="text-slate-700">
                {simulation.aiFirstOrdersUnlocked} pedidos
              </strong>{" "}
              (FIFO: {simulation.fifoActiveOrdersUnlocked}) • Restam {remainingTreatments} vagas hoje
            </p>
          </div>

          {/* KPI 3: Auto-Triagem Zero-Toque */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Auto-Triagem Zero-Toque (Entrada)</span>
              <Zap className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold tracking-tight text-slate-900">
                {autoTriagedCount}{" "}
                <span className="text-xs font-normal text-slate-500">
                  casos limpos s/ humano
                </span>
              </span>
              <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                {((autoTriagedCount * 12) / 60).toFixed(1)}h poupadas
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Entregues encerrados + Link Pix 24h + Falsos atrasos (dias corridos)
            </p>
          </div>

          {/* KPI 4: Ressarcimento Transportadoras */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Ressarcimento de Transportadoras</span>
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold tracking-tight text-slate-900">
                {formatBRL(claimsTotalBRL)}
              </span>
              <span className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                {claimsCount} sinistro{claimsCount === 1 ? "" : "s"} aberto{claimsCount === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Recuperação automática de CMV + Frete em extravios e avarias
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

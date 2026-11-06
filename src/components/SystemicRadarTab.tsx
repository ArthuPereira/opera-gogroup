"use client";

import React, { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { formatBRL } from "@/lib/format";
import {
  ContainmentOrder,
  EnrichedOrder,
  SystemicAnomaly,
  SystemicAnomalyId,
  SystemicContainmentPlan,
} from "@/lib/types";

interface SystemicRadarTabProps {
  anomalies: SystemicAnomaly[];
  containments: ContainmentOrder[];
  allOrders: EnrichedOrder[];
  onActivateContainment: (plan: SystemicContainmentPlan) => Promise<void>;
  onToggleContainment: (anomalyId: string, active: boolean) => Promise<void>;
}

export function SystemicRadarTab({
  anomalies,
  containments,
  allOrders,
  onActivateContainment,
  onToggleContainment,
}: SystemicRadarTabProps) {
  const [loadingId, setLoadingId] = useState<SystemicAnomalyId | null>(null);
  const [generatedPlans, setGeneratedPlans] = useState<
    Record<string, SystemicContainmentPlan>
  >({});

  async function handleGenerateAndActivate(anomaly: SystemicAnomaly) {
    setLoadingId(anomaly.id);
    try {
      const sampleOrders = allOrders
        .filter((o) => {
          if (anomaly.id === "imp_02_gocase") return o.maquina === "IMP-02";
          if (anomaly.id === "lote_l2607b_apice")
            return o.lote_produto === "L2607-B";
          if (anomaly.id === "cd2_noite_brinde")
            return o.cd === "CD2" && o.turno === "noite";
          if (anomaly.id === "rota_express_nordeste")
            return o.transportadora === "Rota Express";
          if (anomaly.id === "carga_norte_lescent_kokeshi")
            return o.transportadora === "Carga Norte" || o.marca === "Kokeshi";
          return o.calendarBugDetected;
        })
        .slice(0, 6)
        .map((o) => ({
          order_id: o.order_id,
          marca: o.marca,
          sku: o.sku,
          valor: o.valor,
          uf: o.uf,
          transportadora: o.transportadora,
          cd: o.cd,
          turno: o.turno,
          maquina: o.maquina,
          lote_produto: o.lote_produto,
        }));

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "systemic_containment",
          anomaly,
          sampleOrders,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Erro HTTP ${res.status}`);
      }

      const plan = data as SystemicContainmentPlan;
      setGeneratedPlans((prev) => ({ ...prev, [anomaly.id]: plan }));
      await onActivateContainment(plan);
    } catch {
      const fallbackPlan: SystemicContainmentPlan = {
        anomalyId: anomaly.id,
        title: anomaly.title,
        executiveDiagnosis: anomaly.rootCauseEvidence,
        ruleSummary: anomaly.recommendedContainmentRule,
        blockedTarget: anomaly.targetEntity,
        redirectTarget: anomaly.replacementTarget,
        technicalDispatchMessage: `[${anomaly.area}] Bloquear ${anomaly.targetEntity} → Ativar ${anomaly.replacementTarget}.`,
        estimatedSavingsBRL: anomaly.avoidableCostBRL,
        modelUsed: "motor-deterministico-local",
        toolTraces: [],
      };
      setGeneratedPlans((prev) => ({ ...prev, [anomaly.id]: fallbackPlan }));
      await onActivateContainment(fallbackPlan);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {anomalies.map((anomaly) => {
        const activeContainment = containments.find(
          (c) => c.anomalyId === anomaly.id
        );
        const isContained = Boolean(activeContainment?.active);
        const plan = generatedPlans[anomaly.id];
        const isLoading = loadingId === anomaly.id;
        const pctMatch = anomaly.concentrationMetric.match(/^(\d+)%/);
        const pctVal = pctMatch ? Math.min(100, Number(pctMatch[1])) : 50;

        return (
          <div
            key={anomaly.id}
            className={`flex flex-col justify-between rounded-xl border p-4 shadow-xs transition ${
              isContained
                ? "border-emerald-300 bg-emerald-50/20"
                : "border-slate-200 bg-white"
            }`}
          >
            <div>
              {/* Badges + Numbers */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                      anomaly.severity === "critica"
                        ? "bg-rose-100 text-rose-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {anomaly.severity === "critica" ? "Crítica" : "Alta"}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {anomaly.area}
                  </span>
                  {isContained && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      <ShieldCheck className="h-3 w-3" />
                      Bloqueio ativo
                    </span>
                  )}
                </div>

                <div className="text-right font-mono text-xs">
                  <div className="font-bold text-slate-900">
                    {formatBRL(anomaly.financialExposureBRL, true)}
                  </div>
                  <div className="text-[11px] font-semibold text-emerald-600">
                    Economia {formatBRL(anomaly.avoidableCostBRL, true)}
                  </div>
                </div>
              </div>

              {/* Title + Concentration Bar */}
              <h3 className="mt-2.5 text-sm font-bold text-slate-900">
                {anomaly.title}
              </h3>

              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="truncate pr-2">
                    {anomaly.concentrationMetric}
                  </span>
                  <span className="shrink-0 font-mono font-semibold text-slate-700">
                    {anomaly.affectedOrdersCount} ped.
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      isContained ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                    style={{ width: `${pctVal}%` }}
                  />
                </div>
              </div>

              {/* Action Route */}
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="font-semibold text-rose-700">
                  {anomaly.targetEntity}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-semibold text-emerald-700">
                  {anomaly.replacementTarget}
                </span>
              </div>

              {/* Collapsible Details & Dispatch */}
              <details className="group mt-2.5">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800">
                  <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                  Detalhes e comunicado operacional
                </summary>
                <div className="mt-2 space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-600">
                  <p>{anomaly.rootCauseEvidence}</p>
                  {(activeContainment || plan) && (
                    <div className="rounded bg-slate-900 p-2 text-[11px] text-slate-200">
                      {activeContainment?.technicalDispatch ||
                        plan?.technicalDispatchMessage}
                    </div>
                  )}
                </div>
              </details>
            </div>

            {/* Footer */}
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              {activeContainment && (
                <button
                  type="button"
                  onClick={() =>
                    onToggleContainment(anomaly.id, !isContained)
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {isContained ? "Pausar" : "Reativar"}
                </button>
              )}

              <button
                type="button"
                disabled={isLoading}
                onClick={() => handleGenerateAndActivate(anomaly)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50 ${
                  isContained
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-slate-900 hover:bg-slate-800"
                }`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Aplicando...
                  </>
                ) : isContained ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Atualizar bloqueio
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Aplicar bloqueio
                  </>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

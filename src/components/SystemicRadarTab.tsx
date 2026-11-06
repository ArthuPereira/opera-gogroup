"use client";

import React, { useState } from "react";
import {
  AlertOctagon,
  ArrowRight,
  Bot,
  CheckCircle2,
  Loader2,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { formatBRL } from "@/lib/format";
import {
  ContainmentOrder,
  EnrichedOrder,
  QueueSimulationComparison,
  SystemicAnomaly,
  SystemicAnomalyId,
  SystemicContainmentPlan,
} from "@/lib/types";

interface SystemicRadarTabProps {
  simulation: QueueSimulationComparison;
  anomalies: SystemicAnomaly[];
  containments: ContainmentOrder[];
  allOrders: EnrichedOrder[];
  onActivateContainment: (plan: SystemicContainmentPlan) => Promise<void>;
  onToggleContainment: (anomalyId: string, active: boolean) => Promise<void>;
}

export function SystemicRadarTab({
  simulation,
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleGenerateAndActivate(anomaly: SystemicAnomaly) {
    setLoadingId(anomaly.id);
    setErrorMsg(null);
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
    } catch (err) {
      // Fallback determinístico caso API falhe p/ nunca travar a demonstração
      const fallbackPlan: SystemicContainmentPlan = {
        anomalyId: anomaly.id,
        title: anomaly.title,
        executiveDiagnosis: anomaly.rootCauseEvidence,
        ruleSummary: anomaly.recommendedContainmentRule,
        blockedTarget: anomaly.targetEntity,
        redirectTarget: anomaly.replacementTarget,
        technicalDispatchMessage: `[ORDEM IMEDIATA - ${anomaly.area}] Bloquear ${anomaly.targetEntity} -> Redirecionar para ${anomaly.replacementTarget}.`,
        estimatedSavingsBRL: anomaly.avoidableCostBRL,
        modelUsed: "motor-deterministico-local",
        toolTraces: [],
      };
      setGeneratedPlans((prev) => ({ ...prev, [anomaly.id]: fallbackPlan }));
      await onActivateContainment(fallbackPlan);
      setErrorMsg(
        err instanceof Error
          ? `Aviso: Agente remoto indisponível (${err.message}); contenção determinística aplicada.`
          : null
      );
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Executive Defense Block: FIFO vs AI-First */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 border border-indigo-200">
              <Scale className="h-3.5 w-3.5" />
              Defesa Executiva do Modelo Operacional
            </span>
            <h2 className="mt-1.5 text-base font-bold text-slate-900 sm:text-lg">
              Fila Passiva por Ordem de Chegada (FIFO) vs. Central Opera AI-First
            </h2>
          </div>
          <div className="text-right text-xs text-slate-500">
            Restrição física do time: <strong>150 tratativas humanas/dia</strong> (12 min/tratativa)
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* FIFO Card */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-rose-700">
              Modelo Legado • Ordem de Chegada (FIFO)
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {simulation.fifoActiveOrdersUnlocked}{" "}
                  <span className="text-xs font-normal text-slate-500">
                    pedidos úteis/dia
                  </span>
                </div>
                <p className="text-[11px] text-rose-700">
                  Desperdiça {simulation.fifoWastedAutoTriagedSlots} vagas humanas em casos já entregues, Pix pendente ou falso atraso
                </p>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {formatBRL(simulation.fifoRiskProtectedBRL, true)}
                </div>
                <p className="text-[11px] text-slate-600">
                  R$ em risco coberto no Dia 1 (ignora VIPs, cliffs de SLA e múltiplos pedidos do mesmo cliente)
                </p>
              </div>
            </div>
          </div>

          {/* AI-First Card */}
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Central Opera AI-First • Carteira + Auto-Triagem
              </span>
              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
                {simulation.orderMultiplierVsFifo.toFixed(1)}x mais pedidos reais no Dia 1
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <div className="text-2xl font-extrabold text-emerald-950">
                  {simulation.aiFirstOrdersUnlocked}{" "}
                  <span className="text-xs font-normal text-emerald-800">
                    pedidos destravados
                  </span>
                </div>
                <p className="text-[11px] text-emerald-800">
                  +{simulation.autoTriagedTotal} limpos na entrada em zero-toque ({simulation.autoTriagedHoursSaved}h humanas salvas)
                </p>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-emerald-950">
                  {formatBRL(simulation.aiFirstRiskProtectedBRL, true)}
                </div>
                <p className="text-[11px] text-emerald-800">
                  <strong>+{formatBRL(simulation.extraRiskProtectedBRL, true)}</strong> de proteção adicional já nas primeiras 150 tratativas
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          {errorMsg}
        </div>
      )}

      {/* 6 Root Causes Grid */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Radar das 6 Causas-Raiz Sistêmicas & Ordens de Contenção
            </h3>
            <p className="text-xs text-slate-500">
              Não basta tratar a fila: o Agente Groq emite bloqueios operacionais de máquina, lote, WMS e transportadora que passam a valer imediatamente nas próximas decisões da Aba 1.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {anomalies.map((anomaly) => {
            const activeContainment = containments.find(
              (c) => c.anomalyId === anomaly.id
            );
            const isContained = Boolean(activeContainment?.active);
            const plan = generatedPlans[anomaly.id];
            const isLoading = loadingId === anomaly.id;

            return (
              <div
                key={anomaly.id}
                className={`flex flex-col justify-between rounded-2xl border p-4 shadow-sm transition ${
                  isContained
                    ? "border-emerald-300 bg-emerald-50/30"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div>
                  {/* Card Top */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                          anomaly.severity === "critica"
                            ? "bg-rose-100 text-rose-800 border border-rose-200"
                            : "bg-amber-100 text-amber-800 border border-amber-200"
                        }`}
                      >
                        <AlertOctagon className="h-3 w-3" />
                        {anomaly.severity === "critica" ? "Crítica" : "Alta"}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {anomaly.area}
                      </span>
                      {isContained && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
                          <ShieldCheck className="h-3 w-3" />
                          Contenção Ativa
                        </span>
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-900">
                        Exposição: {formatBRL(anomaly.financialExposureBRL)}
                      </div>
                      <div className="text-[11px] font-semibold text-emerald-700">
                        Evitável: {formatBRL(anomaly.avoidableCostBRL)}
                      </div>
                    </div>
                  </div>

                  <h4 className="mt-2 text-sm font-bold text-slate-900">
                    {anomaly.title}
                  </h4>
                  <p className="text-xs font-medium text-indigo-700">
                    {anomaly.concentrationMetric}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-600">
                    {anomaly.rootCauseEvidence}
                  </p>

                  {/* Routing Box */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-rose-700">
                      Bloquear: {anomaly.targetEntity}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-semibold text-emerald-700">
                      Ativar: {anomaly.replacementTarget}
                    </span>
                  </div>

                  {/* Agent Trace or Active Dispatch */}
                  {(plan || activeContainment) && (
                    <div className="mt-3 rounded-xl bg-slate-900 p-3 text-xs text-slate-100">
                      {plan && plan.toolTraces.length > 0 && (
                        <div className="mb-2 border-b border-slate-700 pb-2">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-400">
                            <span className="inline-flex items-center gap-1">
                              <Terminal className="h-3 w-3" />
                              Tools Groq ({plan.modelUsed})
                            </span>
                          </div>
                          {plan.toolTraces.map((t) => (
                            <div
                              key={`${t.step}-${t.toolName}`}
                              className="mt-1 text-[11px] text-slate-300"
                            >
                              <strong className="text-indigo-300">
                                {t.toolName}:
                              </strong>{" "}
                              {t.summary}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="text-[11px] text-slate-200">
                        <strong className="text-emerald-400">
                          Comunicado Operacional Emitido:{" "}
                        </strong>
                        {activeContainment?.technicalDispatch ||
                          plan?.technicalDispatchMessage}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Footer */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                  <span className="text-[11px] text-slate-500">
                    {anomaly.affectedOrdersCount} pedidos impactados na base
                  </span>

                  <div className="flex items-center gap-2">
                    {activeContainment && (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleContainment(anomaly.id, !isContained)
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {isContained ? "Pausar Regra" : "Reativar Regra"}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => handleGenerateAndActivate(anomaly)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50 ${
                        isContained
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : "bg-slate-900 hover:bg-slate-800"
                      }`}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Emitindo c/ Groq...
                        </>
                      ) : isContained ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Atualizar Ordem IA
                        </>
                      ) : (
                        <>
                          <Bot className="h-3.5 w-3.5 text-emerald-400" />
                          Emitir & Ativar Contenção (1 Clique)
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

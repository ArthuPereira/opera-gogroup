"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Crown,
  FileWarning,
  Loader2,
  MessageSquareText,
  PackageCheck,
  ShieldAlert,
  Sparkles,
  Terminal,
  Truck,
} from "lucide-react";
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
  PortfolioResolutionPlan,
  RecommendedActionType,
} from "@/lib/types";

interface AgentActionPanelProps {
  portfolio: CustomerPortfolio | null;
  carriersByUf: Map<string, CarrierRoute[]>;
  activeContainments: ContainmentOrder[];
  cachedPlan: PortfolioResolutionPlan | null;
  onPlanGenerated: (customerId: string, plan: PortfolioResolutionPlan) => void;
  onExecuteResolution: (params: {
    portfolio: CustomerPortfolio;
    plan: PortfolioResolutionPlan | null;
    actionOverrides: Record<string, RecommendedActionType>;
    customMessage: string;
  }) => Promise<void>;
}

const SELECTABLE_ACTIONS: RecommendedActionType[] = [
  "reenvio_prioritario",
  "reexpedicao_sem_cmv",
  "voucher_credito",
  "reembolso_direto",
];

export function AgentActionPanel({
  portfolio,
  carriersByUf,
  activeContainments,
  cachedPlan,
  onPlanGenerated,
  onExecuteResolution,
}: AgentActionPanelProps) {
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [actionOverrides, setActionOverrides] = useState<
    Record<string, RecommendedActionType>
  >({});
  const [customMessage, setCustomMessage] = useState("");

  useEffect(() => {
    setAgentError(null);
    setActionOverrides({});
    if (!portfolio) {
      setCustomMessage("");
      return;
    }

    if (cachedPlan) {
      setCustomMessage(cachedPlan.customerMessage);
    } else {
      const orderListText =
        portfolio.orders.length > 1
          ? `seus pedidos (${portfolio.orders.map((o) => o.order_id).join(", ")})`
          : `seu pedido ${portfolio.orders[0].order_id}`;
      const summaryActions = portfolio.orders
        .map(
          (o) =>
            `${o.order_id}: ${
              ACTION_LABELS[o.economics.recommendedOption.action]
            }`
        )
        .join(" | ");
      setCustomMessage(
        `Olá! Aqui é do time de Prioridade Gogroup. Revisamos ${orderListText} em atendimento unificado e já liberamos a melhor solução sem burocracia (${summaryActions}). Qualquer dúvida, basta responder esta mensagem!`
      );
    }
  }, [portfolio?.customer_id, cachedPlan]);

  if (!portfolio) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <PackageCheck className="h-10 w-10 text-slate-400" />
        <h3 className="mt-3 text-sm font-semibold text-slate-800">
          Nenhuma carteira pendente selecionada
        </h3>
        <p className="mt-1 max-w-sm text-xs text-slate-500">
          Selecione um cliente ou pedido na fila à esquerda para inspecionar os
          cálculos em R$, acionar o Agente Groq e aprovar a resolução em 1 clique.
        </p>
      </div>
    );
  }

  const isAllResolved = portfolio.orders.every(
    (o) => o.workflowStatus === "resolved"
  );

  async function handleRunAgent() {
    if (!portfolio) return;
    setIsInvestigating(true);
    setAgentError(null);
    try {
      const carriersRecord: Record<string, CarrierRoute[]> = {};
      for (const o of portfolio.orders) {
        carriersRecord[o.uf] = carriersByUf.get(o.uf) ?? [];
      }

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "portfolio_resolution",
          customer: portfolio.customer,
          orders: portfolio.orders,
          carriersByUf: carriersRecord,
          activeContainments,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Falha HTTP ${res.status} na rota /api/agent`);
      }

      const plan = data as PortfolioResolutionPlan;
      onPlanGenerated(portfolio.customer_id, plan);
      setCustomMessage(plan.customerMessage);
    } catch (err) {
      setAgentError(
        err instanceof Error
          ? err.message
          : "Erro ao consultar o Agente Groq."
      );
    } finally {
      setIsInvestigating(false);
    }
  }

  async function handleApprovePlan() {
    if (!portfolio) return;
    setIsExecuting(true);
    try {
      await onExecuteResolution({
        portfolio,
        plan: cachedPlan,
        actionOverrides,
        customMessage,
      });
    } finally {
      setIsExecuting(false);
    }
  }

  const totalEligibleClaims = portfolio.orders.reduce(
    (acc, o) => acc + o.economics.eligibleCarrierClaimBRL,
    0
  );

  const estimatedDirectExecutionCost = portfolio.orders.reduce((acc, o) => {
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

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Portfolio Header */}
      <div className="border-b border-slate-200 bg-slate-50/80 p-4 rounded-t-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-slate-900">
                Carteira {portfolio.customer_id}
              </span>
              {portfolio.isVip && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 border border-amber-300">
                  <Crown className="h-3 w-3" />
                  VIP ({formatBRL(portfolio.customer.receita_acumulada)} acum.)
                </span>
              )}
              <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-medium text-slate-700">
                {portfolio.orderCount}{" "}
                {portfolio.orderCount === 1 ? "pedido aberto" : "pedidos agrupados"}
              </span>
              {portfolio.canConsolidatePhysicalBox && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-300">
                  <Truck className="h-3 w-3" />
                  Caixa Única Consolidável (-{formatBRL(portfolio.freightConsolidationSavingsBRL)})
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Histórico: {portfolio.customer.n_pedidos} compras • LTV 12m em risco (1x):{" "}
              <strong>{formatBRL(portfolio.customerLtvRiskBRL)}</strong>
              {portfolio.avoidedSacContactsBRL > 0 && (
                <>
                  {" "}
                  • Economia SAC unificado:{" "}
                  <strong className="text-emerald-700">
                    +{formatBRL(portfolio.avoidedSacContactsBRL)}
                  </strong>
                </>
              )}
            </p>
          </div>

          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Score Total R$ em Risco
            </div>
            <div className="text-xl font-extrabold text-rose-600">
              {formatBRL(portfolio.riskTotalBRL)}
            </div>
          </div>
        </div>

        {/* Trigger Groq Agent Bar */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200/80 bg-indigo-50/60 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-indigo-950">
            <Bot className="h-4 w-4 shrink-0 text-indigo-600" />
            {cachedPlan ? (
              <span>
                <strong>Agente Groq concluiu investigação</strong> ({cachedPlan.modelUsed} •{" "}
                {cachedPlan.toolTraces.length} tools executadas)
              </span>
            ) : (
              <span>
                Acione o <strong>Agente de IA (Groq)</strong> para auditar armadilhas, simular Unit Economics e redigir o plano consolidado.
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleRunAgent}
            disabled={isInvestigating || isAllResolved}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {isInvestigating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Executando Tools Groq...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                {cachedPlan ? "Reexecutar Agente IA" : "Investigar c/ Agente IA (Groq)"}
              </>
            )}
          </button>
        </div>

        {agentError && (
          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <strong>Aviso da API do Agente:</strong> {agentError} (O plano determinístico abaixo continua disponível para execução imediata.)
          </div>
        )}
      </div>

      {/* Body */}
      <div className="space-y-4 p-4">
        {/* Agent Tool Trace & Executive Summary (when investigated) */}
        {cachedPlan && (
          <div className="rounded-xl border border-indigo-100 bg-slate-900 p-3.5 text-slate-100">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-emerald-400">
              <span className="inline-flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5" />
                Rastro Transparente de Tools ({cachedPlan.toolTraces.length} etapas)
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {cachedPlan.modelUsed}
              </span>
            </div>

            <div className="mt-2 space-y-1.5">
              {cachedPlan.toolTraces.map((trace) => (
                <div
                  key={`${trace.step}-${trace.toolName}`}
                  className="rounded-lg bg-slate-800/90 px-2.5 py-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-indigo-300">
                      {trace.step}. {trace.toolName}()
                    </span>
                    <span className="text-[11px] text-slate-400 truncate max-w-[220px]">
                      {trace.inputPreview}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-200">
                    {trace.summary}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-lg border border-slate-700 bg-slate-800/50 p-2.5 text-xs text-slate-200">
              <strong className="text-white">Diagnóstico Executivo IA: </strong>
              {cachedPlan.executiveSummary}
            </div>
          </div>
        )}

        {/* Per-Order Economic Comparison & Anti-Recurrence Guards */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Pedidos da Carteira & Matriz Economicamente Ótima
          </h4>

          {portfolio.orders.map((order) => {
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
            const activeQuote =
              allQuotes.find((q) => q.action === currentSelectedAction) ??
              order.economics.recommendedOption;

            const guards =
              agentDecision?.antiRecurrenceGuards?.length
                ? agentDecision.antiRecurrenceGuards
                : order.economics.recommendedOption.antiRecurrenceGuards;

            return (
              <div
                key={order.order_id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {order.order_id}
                      </span>
                      <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 border border-slate-200">
                        {order.marca}
                      </span>
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200">
                        {EXCEPTION_LABELS[order.tipo_excecao]}
                      </span>
                      {order.brinde_no_pedido && (
                        <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700 border border-purple-200">
                          c/ Brinde
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-medium text-slate-800">
                      {order.sku} — {order.descricao_produto} ({order.qtd_itens} un.)
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Origem: <strong>{order.cd}</strong> ({order.turno}
                      {order.maquina ? ` • ${order.maquina}` : ""} • Lote{" "}
                      {order.lote_produto}) → Destino:{" "}
                      <strong>
                        {order.cidade}/{order.uf}
                      </strong>{" "}
                      via {order.transportadora}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Pedido: {formatIsoDateBR(order.data_pedido)} • Prometido Checkout:{" "}
                      {formatIsoDateBR(order.data_prometida)} •{" "}
                      <strong className="text-slate-700">
                        Prazo Real Útil: {formatIsoDateBR(order.realDueDate)}
                      </strong>{" "}
                      {order.businessDaysLate > 0 && (
                        <span className="text-rose-600 font-semibold">
                          ({order.businessDaysLate}d úteis atraso • Cancel.{" "}
                          {Math.round(order.cancelProbability * 100)}%)
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-bold text-slate-900">
                      Valor: {formatBRL(order.valor)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      CMV (24%): {formatBRL(order.economics.cmvBRL)} • Frete:{" "}
                      {formatBRL(order.economics.currentCarrierFreightBRL)}
                    </div>
                    {order.economics.eligibleCarrierClaimBRL > 0 && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                        <FileWarning className="h-3 w-3" />
                        Sinistro: +{formatBRL(order.economics.eligibleCarrierClaimBRL)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Anti-Recurrence Traps */}
                {(order.anomalyFlags.length > 0 || guards.length > 0) && (
                  <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50/80 p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      Travas Anti-Reincidência Ativadas
                    </div>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-amber-900 list-disc list-inside">
                      {guards.length > 0
                        ? guards.map((g, i) => <li key={i}>{g}</li>)
                        : order.anomalyFlags.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}

                {/* Economic Option Comparison & Manual Override */}
                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {allQuotes.slice(0, 3).map((quote) => {
                    const isSelected = quote.action === currentSelectedAction;
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
                        className={`rounded-lg border p-2 text-left transition ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-bold text-slate-800 line-clamp-1">
                            {ACTION_LABELS[quote.action]}
                          </span>
                          {quote.action ===
                            order.economics.recommendedOption.action && (
                            <span className="shrink-0 rounded bg-emerald-600 px-1 py-0.2 text-[9px] font-bold uppercase text-white">
                              Ótimo
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-baseline justify-between text-xs">
                          <span className="text-slate-500">Custo Direto:</span>
                          <strong className="text-slate-900">
                            {formatBRL(quote.directCostBRL)}
                          </strong>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          Rota: {quote.recommendedCarrier}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Override Dropdown + Rationale */}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 text-[11px] text-slate-600">
                  <span className="flex-1">{activeQuote.rationale}</span>
                  <label className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    Override:
                    <select
                      value={currentSelectedAction}
                      onChange={(e) =>
                        setActionOverrides((prev) => ({
                          ...prev,
                          [order.order_id]: e.target
                            .value as RecommendedActionType,
                        }))
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800"
                    >
                      {SELECTABLE_ACTIONS.map((act) => (
                        <option key={act} value={act}>
                          {ACTION_LABELS[act]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Consolidated Customer Communication */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <label className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <MessageSquareText className="h-3.5 w-3.5 text-indigo-600" />
              Mensagem Única Consolidada ao Cliente (1 Contato p/ Toda a Carteira)
            </span>
            <span className="text-[11px] font-normal text-slate-500">
              Editável antes do disparo
            </span>
          </label>
          <textarea
            rows={3}
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {/* Bottom 1-Click Approval Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
          <div className="text-xs text-emerald-950">
            <div>
              Custo Direto da Ação:{" "}
              <strong>{formatBRL(estimatedDirectExecutionCost)}</strong> vs Risco
              Protegido: <strong>{formatBRL(portfolio.riskTotalBRL)}</strong>
            </div>
            {totalEligibleClaims > 0 && (
              <div className="text-[11px] text-emerald-800">
                Inclui abertura automática de protocolo de ressarcimento:{" "}
                <strong>{formatBRL(totalEligibleClaims)}</strong>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={isExecuting || isAllResolved}
            onClick={handleApprovePlan}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Executando Plano...
              </>
            ) : isAllResolved ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Carteira Já Resolvida
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4" />
                Aprovar e Executar Plano (1 Clique)
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  RotateCcw,
  Search,
  Zap,
} from "lucide-react";
import {
  AUTO_TRIAGE_LABELS,
  formatBRL,
  formatIsoDateBR,
} from "@/lib/format";
import {
  AuditLogEntry,
  AutoTriageCategory,
  CarrierClaim,
  EnrichedOrder,
} from "@/lib/types";

interface AutoTriageAuditTabProps {
  autoTriagedOrders: EnrichedOrder[];
  claims: CarrierClaim[];
  auditLogs: AuditLogEntry[];
  potentialClaimPoolBRL: number;
  onRevertToHumanQueue: (orderId: string) => Promise<void>;
}

export function AutoTriageAuditTab({
  autoTriagedOrders,
  claims,
  auditLogs,
  potentialClaimPoolBRL,
  onRevertToHumanQueue,
}: AutoTriageAuditTabProps) {
  const [ruleFilter, setRuleFilter] = useState<
    "all" | Exclude<AutoTriageCategory, "none">
  >("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(60);

  const counts = useMemo(() => {
    let a = 0;
    let b = 0;
    let c = 0;
    for (const o of autoTriagedOrders) {
      if (o.autoTriageCategory === "auto_encerrado_entregue") a++;
      else if (o.autoTriageCategory === "auto_cobranca_pix") b++;
      else if (o.autoTriageCategory === "auto_aviso_falso_atraso") c++;
    }
    return { a, b, c };
  }, [autoTriagedOrders]);

  const filteredAuto = useMemo(() => {
    const q = search.trim().toLowerCase();
    return autoTriagedOrders.filter((o) => {
      if (ruleFilter !== "all" && o.autoTriageCategory !== ruleFilter) {
        return false;
      }
      if (!q) return true;
      return (
        o.order_id.toLowerCase().includes(q) ||
        o.customer_id.toLowerCase().includes(q) ||
        o.marca.toLowerCase().includes(q) ||
        o.cidade.toLowerCase().includes(q)
      );
    });
  }, [autoTriagedOrders, ruleFilter, search]);

  const totalClaimsOpenedBRL = claims.reduce(
    (acc, c) => acc + c.valor_reclamado_brl,
    0
  );

  return (
    <div className="space-y-6">
      {/* Section 1: Auto-Triage Audit */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
              <Zap className="h-3.5 w-3.5" />
              Automação Determinística Auditável e Reversível
            </span>
            <h2 className="mt-1.5 text-base font-bold text-slate-900">
              Auditoria dos {autoTriagedOrders.length} Casos Auto-Triados (Zero Fila Humana)
            </h2>
            <p className="text-xs text-slate-500">
              Cada registro limpo automaticamente possui justificativa matemática explícita e pode ser devolvido à fila humana em 1 clique.
            </p>
          </div>

          <div className="relative min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar pedido ou cliente..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* Rule Buckets */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRuleFilter("all")}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              ruleFilter === "all"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
            }`}
          >
            Todos ({autoTriagedOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setRuleFilter("auto_encerrado_entregue")}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              ruleFilter === "auto_encerrado_entregue"
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            Regra A • Atraso já Entregue ({counts.a})
          </button>
          <button
            type="button"
            onClick={() => setRuleFilter("auto_cobranca_pix")}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              ruleFilter === "auto_cobranca_pix"
                ? "border-sky-700 bg-sky-700 text-white"
                : "border-sky-200 bg-sky-50 text-sky-800"
            }`}
          >
            Regra B • Link Pix 24h / Estoque ({counts.b})
          </button>
          <button
            type="button"
            onClick={() => setRuleFilter("auto_aviso_falso_atraso")}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              ruleFilter === "auto_aviso_falso_atraso"
                ? "border-violet-700 bg-violet-700 text-white"
                : "border-violet-200 bg-violet-50 text-violet-800"
            }`}
          >
            Regra C • Falso Atraso Checkout ({counts.c})
          </button>
        </div>

        {/* Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">Pedido / Cliente</th>
                <th className="py-2 pr-3">Marca / Valor</th>
                <th className="py-2 pr-3">Regra Aplicada</th>
                <th className="py-2 pr-3">Evidência Determinística</th>
                <th className="py-2 text-right">Auditoria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAuto.slice(0, limit).map((order) => {
                const cat =
                  order.autoTriageCategory !== "none"
                    ? AUTO_TRIAGE_LABELS[order.autoTriageCategory]
                    : null;
                return (
                  <tr key={order.order_id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 pr-3">
                      <div className="font-mono font-bold text-slate-900">
                        {order.order_id}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {order.customer_id}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-800">
                        {order.marca}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {formatBRL(order.valor)}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {cat && (
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cat.color}`}
                        >
                          {cat.badge}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 max-w-md text-slate-600">
                      {order.autoTriageNote}
                      <div className="text-[10px] text-slate-400">
                        Prometido Checkout: {formatIsoDateBR(order.data_prometida)} • Prazo Útil Real: {formatIsoDateBR(order.realDueDate)}
                        {order.data_entrega
                          ? ` • Entregue: ${formatIsoDateBR(order.data_entrega)}`
                          : ""}
                      </div>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onRevertToHumanQueue(order.order_id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reverter p/ Fila Humana
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredAuto.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((prev) => prev + 100)}
            className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Mostrar mais ({filteredAuto.length - limit} restantes)
          </button>
        )}
      </section>

      {/* Section 2 & 3: Carrier Claims + Audit Log */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Carrier Claims */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <FileCheck2 className="h-4 w-4 text-emerald-600" />
                Dossiês de Ressarcimento de Transportadoras
              </h3>
              <p className="text-xs text-slate-500">
                Potencial mapeado na fila ativa: <strong>{formatBRL(potentialClaimPoolBRL)}</strong> (CMV + Frete em extravios e avarias)
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm font-extrabold text-emerald-700">
                {formatBRL(totalClaimsOpenedBRL)}
              </div>
              <div className="text-[10px] text-slate-500">
                {claims.length} protocolados
              </div>
            </div>
          </div>

          {claims.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Aprove uma carteira com <strong>Extravio</strong> ou{" "}
              <strong>Avaria no Transporte</strong> na Aba 1 para gerar automaticamente o protocolo de ressarcimento aqui.
            </div>
          ) : (
            <div className="mt-3 space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {claims.map((claim) => (
                <div
                  key={claim.claim_id}
                  className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900">
                      {claim.claim_id} • Pedido {claim.order_id}
                    </span>
                    <span className="font-bold text-emerald-700">
                      +{formatBRL(claim.valor_reclamado_brl)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-slate-700">
                    Transportadora: <strong>{claim.transportadora}</strong> ({claim.uf}) • {claim.marca} ({claim.sku})
                  </div>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {claim.evidencia_tecnica}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Session Audit Log */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <ClipboardList className="h-4 w-4 text-indigo-600" />
                Log de Governança & Ações Executadas
              </h3>
              <p className="text-xs text-slate-500">
                Registro imutável por sessão no navegador (Auto-Triagem, Agente IA e Contenções)
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {auditLogs.map((log) => (
              <div
                key={log.id ?? log.timestamp}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    {log.actionTitle}
                  </div>
                  {log.financialImpactBRL > 0 && (
                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                      +{formatBRL(log.financialImpactBRL)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-600">{log.details}</p>
                <div className="mt-1 text-[10px] text-slate-400">
                  Ator: {log.actor} • {new Date(log.timestamp).toLocaleTimeString("pt-BR")}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

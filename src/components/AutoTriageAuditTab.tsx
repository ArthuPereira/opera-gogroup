"use client";

import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  ACTOR_LABELS,
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
  mode: "triage" | "claims";
  autoTriagedOrders: EnrichedOrder[];
  claims: CarrierClaim[];
  auditLogs: AuditLogEntry[];
  potentialClaimPoolBRL: number;
  onRevertToHumanQueue: (orderId: string) => Promise<void>;
}

export function AutoTriageAuditTab({
  mode,
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

  if (mode === "claims") {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Carrier Claims */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <FileCheck2 className="h-4 w-4 text-emerald-600" />
                Sinistros Protocolados
              </h2>
              <p className="text-[11px] text-slate-500">
                Mapeado na fila ativa: {formatBRL(potentialClaimPoolBRL)}
              </p>
            </div>
            <div className="text-right font-mono">
              <div className="text-sm font-bold text-emerald-700">
                {formatBRL(totalClaimsOpenedBRL)}
              </div>
              <div className="text-[10px] text-slate-500">
                {claims.length} abertos
              </div>
            </div>
          </div>

          {claims.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Nenhum sinistro aberto ainda. Aprove tratativas de extravio ou avaria na fila para protocolar automaticamente.
            </div>
          ) : (
            <div className="mt-3 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
              {claims.map((claim) => (
                <div
                  key={claim.claim_id}
                  className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900">
                      {claim.claim_id} • {claim.order_id}
                    </span>
                    <span className="font-mono font-bold text-emerald-700">
                      +{formatBRL(claim.valor_reclamado_brl)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-600">
                    {claim.transportadora} ({claim.uf}) • {claim.marca} • {claim.sku}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Activity Log */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <ClipboardList className="h-4 w-4 text-indigo-600" />
              Histórico de Ações
            </h2>
            <span className="text-[11px] text-slate-400">
              {auditLogs.length} registros
            </span>
          </div>

          <div className="mt-3 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {auditLogs.map((log) => (
              <div
                key={log.id ?? log.timestamp}
                className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    {log.actionTitle}
                  </div>
                  {log.financialImpactBRL > 0 && (
                    <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-700">
                      +{formatBRL(log.financialImpactBRL)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                  {log.details}
                </p>
                <div className="mt-1 text-[10px] text-slate-400">
                  {ACTOR_LABELS[log.actor] ?? log.actor} •{" "}
                  {new Date(log.timestamp).toLocaleTimeString("pt-BR")}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setRuleFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              ruleFilter === "all"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:text-slate-900"
            }`}
          >
            Todos ({autoTriagedOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setRuleFilter("auto_encerrado_entregue")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              ruleFilter === "auto_encerrado_entregue"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-50 text-emerald-800"
            }`}
          >
            Já Entregues ({counts.a})
          </button>
          <button
            type="button"
            onClick={() => setRuleFilter("auto_cobranca_pix")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              ruleFilter === "auto_cobranca_pix"
                ? "bg-sky-700 text-white"
                : "bg-sky-50 text-sky-800"
            }`}
          >
            Pix Pendente ({counts.b})
          </button>
          <button
            type="button"
            onClick={() => setRuleFilter("auto_aviso_falso_atraso")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              ruleFilter === "auto_aviso_falso_atraso"
                ? "bg-violet-700 text-white"
                : "bg-violet-50 text-violet-800"
            }`}
          >
            No Prazo Real ({counts.c})
          </button>
        </div>

        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pedido ou cliente..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:bg-white focus:outline-none"
          />
        </div>
      </div>

      {/* Compact Table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-400">
              <th className="py-2 pr-3">Pedido</th>
              <th className="py-2 pr-3">Cliente</th>
              <th className="py-2 pr-3">Marca</th>
              <th className="py-2 pr-3">Valor</th>
              <th className="py-2 pr-3">Classificação</th>
              <th className="py-2 pr-3">Datas (Checkout / Real / Entrega)</th>
              <th className="py-2 text-right">Ação</th>
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
                  <td className="py-2 pr-3 font-mono font-bold text-slate-900">
                    {order.order_id}
                  </td>
                  <td className="py-2 pr-3 font-mono text-slate-600">
                    {order.customer_id}
                  </td>
                  <td className="py-2 pr-3 text-slate-700">{order.marca}</td>
                  <td className="py-2 pr-3 font-mono text-slate-700">
                    {formatBRL(order.valor)}
                  </td>
                  <td className="py-2 pr-3">
                    {cat && (
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${cat.color}`}
                      >
                        {cat.badge}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-slate-500">
                    {formatIsoDateBR(order.data_prometida)} •{" "}
                    <strong className="text-slate-700">
                      {formatIsoDateBR(order.realDueDate)}
                    </strong>{" "}
                    • {formatIsoDateBR(order.data_entrega)}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onRevertToHumanQueue(order.order_id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Mover p/ fila
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
          className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          Mostrar mais ({filteredAuto.length - limit})
        </button>
      )}
    </section>
  );
}

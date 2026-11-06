"use client";

import React, { useState } from "react";
import {
  FileSpreadsheet,
  PlusCircle,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { parseOrdersCsv, QUICK_INGEST_PRESETS } from "@/lib/csv-io";
import { EXCEPTION_LABELS } from "@/lib/format";
import { ExceptionType, RawOrder } from "@/lib/types";

interface IngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIngestOrders: (
    orders: RawOrder[],
    source: "manual" | "csv_upload"
  ) => Promise<{ totalAdded: number; autoTriaged: number; activeAdded: number }>;
}

export function IngestModal({
  isOpen,
  onClose,
  onIngestOrders,
}: IngestModalProps) {
  const [tab, setTab] = useState<"form" | "csv">("form");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Manual form state
  const [orderId, setOrderId] = useState(
    () => `GB99${Math.floor(100 + Math.random() * 899)}`
  );
  const [customerId, setCustomerId] = useState("CL300014");
  const [marca, setMarca] = useState("Ápice");
  const [valor, setValor] = useState("249.90");
  const [sku, setSku] = useState("APC-1067");
  const [descricao, setDescricao] = useState(
    "Máscara Reconstrutora Pro Ápice 500g"
  );
  const [qtdItens, setQtdItens] = useState("2");
  const [brinde, setBrinde] = useState(true);
  const [tipoExcecao, setTipoExcecao] =
    useState<ExceptionType>("vazamento_produto");
  const [transportadora, setTransportadora] = useState("Veloz Log");
  const [uf, setUf] = useState("CE");
  const [cidade, setCidade] = useState("Fortaleza");
  const [dataPedido, setDataPedido] = useState("2026-09-22");
  const [dataPrometida, setDataPrometida] = useState("2026-09-28");
  const [dataEntrega, setDataEntrega] = useState("");
  const [cd, setCd] = useState("CD1");
  const [turno, setTurno] = useState("manhã");
  const [maquina, setMaquina] = useState("");
  const [lote, setLote] = useState("L2607-B");

  if (!isOpen) return null;

  function applyPreset(presetIndex: number) {
    const p = QUICK_INGEST_PRESETS[presetIndex];
    if (!p) return;
    const o = p.order;
    setOrderId(`${o.orderPrefix}99${Math.floor(100 + Math.random() * 899)}`);
    setCustomerId(o.customer_id);
    setMarca(o.marca);
    setValor(o.valor.toFixed(2));
    setSku(o.sku);
    setDescricao(o.descricao_produto);
    setQtdItens(String(o.qtd_itens));
    setBrinde(o.brinde_no_pedido);
    setTipoExcecao(o.tipo_excecao);
    setTransportadora(o.transportadora);
    setUf(o.uf);
    setCidade(o.cidade);
    setDataPedido(o.data_pedido);
    setDataPrometida(o.data_prometida);
    setDataEntrega(o.data_entrega ?? "");
    setCd(o.cd);
    setTurno(o.turno);
    setMaquina(o.maquina ?? "");
    setLote(o.lote_produto);
    setFeedback(
      `Preset carregado: "${p.title}" — ${p.expectedBehavior}`
    );
    setError(null);
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const raw: RawOrder = {
        order_id: orderId.trim() || `GB99${Date.now().toString().slice(-3)}`,
        customer_id: customerId.trim() || "CL300014",
        marca: marca.trim(),
        data_pedido: dataPedido,
        valor: Math.max(1, Number(valor.replace(",", ".")) || 100),
        sku: sku.trim(),
        descricao_produto: descricao.trim(),
        qtd_itens: Math.max(1, parseInt(qtdItens, 10) || 1),
        brinde_no_pedido: brinde,
        tipo_excecao: tipoExcecao,
        status: "aberta",
        transportadora,
        uf: uf.trim().toUpperCase(),
        cidade: cidade.trim(),
        data_prometida: dataPrometida,
        data_entrega: dataEntrega.trim() || null,
        maquina: maquina.trim() || null,
        turno,
        cd,
        lote_produto: lote.trim(),
        data_abertura_excecao: "2026-09-30",
      };

      const res = await onIngestOrders([raw], "manual");
      setFeedback(
        res.autoTriaged > 0
          ? `✅ Pedido ${raw.order_id} inserido e RESOLVIDO AUTOMATICAMENTE na Auto-Triagem (Zero Fila Humana)! Confira na Aba 3.`
          : `✅ Pedido ${raw.order_id} inserido na Fila Inteligente do cliente ${raw.customer_id} e recalculado em R$!`
      );
      setOrderId(`GB99${Math.floor(100 + Math.random() * 899)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao inserir pedido");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const text = await file.text();
      const parsed = parseOrdersCsv(text);
      const res = await onIngestOrders(parsed, "csv_upload");
      setFeedback(
        `✅ Lote CSV importado (${res.totalAdded} pedidos): ${res.autoTriaged} limpos na Auto-Triagem e ${res.activeAdded} priorizados na Fila Inteligente!`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ler arquivo CSV");
    } finally {
      setIsSubmitting(false);
      e.target.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Ingestão de Exceções em Tempo Real
            </h3>
            <p className="text-xs text-slate-500">
              Todo novo pedido passa imediatamente pela Auto-Triagem e pelo Motor de Priorização Financeira no seu navegador.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Switch */}
        <div className="flex gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2.5">
          <button
            type="button"
            onClick={() => setTab("form")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              tab === "form"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Formulário Rápido + 4 Presets
          </button>
          <button
            type="button"
            onClick={() => setTab("csv")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              tab === "csv"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Upload de Arquivo CSV
          </button>
        </div>

        <div className="p-5 space-y-4">
          {feedback && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900">
              {feedback}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
              {error}
            </div>
          )}

          {tab === "form" ? (
            <>
              {/* 4 Quick Evaluator Presets */}
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                  Presets de Teste Rápido (1 Clique p/ Preencher):
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {QUICK_INGEST_PRESETS.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(idx)}
                      className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-left transition hover:border-indigo-400 hover:bg-indigo-50/50"
                    >
                      <span className="inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                        {p.badge}
                      </span>
                      <div className="mt-1 text-xs font-bold text-slate-900">
                        {p.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 line-clamp-2">
                        {p.expectedBehavior}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Form */}
              <form
                onSubmit={handleFormSubmit}
                className="grid grid-cols-1 gap-3 pt-2 border-t border-slate-100 sm:grid-cols-3 text-xs"
              >
                <label className="block">
                  <span className="font-semibold text-slate-700">Order ID</span>
                  <input
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    required
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    Customer ID (VIP ex: CL300014)
                  </span>
                  <input
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    required
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">Marca</span>
                  <select
                    value={marca}
                    onChange={(e) => setMarca(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {[
                      "Gocase",
                      "Ápice",
                      "Barbour's",
                      "Lescent",
                      "Kokeshi",
                      "Rituária",
                      "By Samia",
                      "Yenzah",
                      "Auá",
                    ].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    Tipo de Exceção
                  </span>
                  <select
                    value={tipoExcecao}
                    onChange={(e) =>
                      setTipoExcecao(e.target.value as ExceptionType)
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {(Object.keys(EXCEPTION_LABELS) as ExceptionType[]).map(
                      (t) => (
                        <option key={t} value={t}>
                          {EXCEPTION_LABELS[t]}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    Valor Pago (R$)
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                    required
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">SKU</span>
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="font-semibold text-slate-700">
                    Descrição do Produto
                  </span>
                  <input
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    Transportadora
                  </span>
                  <select
                    value={transportadora}
                    onChange={(e) => setTransportadora(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {[
                      "Rota Express",
                      "Veloz Log",
                      "Carga Norte",
                      "Entrega Já",
                      "Postal Nacional",
                    ].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">UF</span>
                  <input
                    maxLength={2}
                    value={uf}
                    onChange={(e) => setUf(e.target.value.toUpperCase())}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 uppercase"
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">Cidade</span>
                  <input
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    CD / Turno
                  </span>
                  <div className="mt-1 flex gap-1.5">
                    <select
                      value={cd}
                      onChange={(e) => setCd(e.target.value)}
                      className="w-1/2 rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                    >
                      <option value="CD1">CD1</option>
                      <option value="CD2">CD2</option>
                    </select>
                    <select
                      value={turno}
                      onChange={(e) => setTurno(e.target.value)}
                      className="w-1/2 rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                    >
                      <option value="manhã">manhã</option>
                      <option value="tarde">tarde</option>
                      <option value="noite">noite</option>
                    </select>
                  </div>
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    Máquina (Gocase)
                  </span>
                  <input
                    value={maquina}
                    placeholder="Ex: IMP-02"
                    onChange={(e) => setMaquina(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    Lote Produto
                  </span>
                  <input
                    value={lote}
                    onChange={(e) => setLote(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-slate-700">
                    Data Entrega (vazio se ñ entregue)
                  </span>
                  <input
                    type="date"
                    value={dataEntrega}
                    onChange={(e) => setDataEntrega(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                </label>

                <div className="sm:col-span-3 flex items-center justify-between pt-2">
                  <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={brinde}
                      onChange={(e) => setBrinde(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Pedido inclui brinde de campanha promocional
                  </label>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isSubmitting
                      ? "Processando..."
                      : "Ingerir Pedido & Calcular Score"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40">
                <Upload className="h-8 w-8 text-indigo-600" />
                <span className="mt-2 text-sm font-bold text-slate-800">
                  Clique para selecionar um arquivo .CSV
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  Compatível com o formato oficial de{" "}
                  <code>pedidos_excecao.csv</code> (ou exportações da própria plataforma)
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileChange}
                  disabled={isSubmitting}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

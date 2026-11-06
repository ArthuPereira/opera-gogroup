"use client";

import React, { useState } from "react";
import { FileSpreadsheet, PlusCircle, Upload, X } from "lucide-react";
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
    setFeedback(null);
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
          ? `Pedido ${raw.order_id} resolvido automaticamente na triagem.`
          : `Pedido ${raw.order_id} adicionado à fila do cliente ${raw.customer_id}.`
      );
      setOrderId(`GB99${Math.floor(100 + Math.random() * 899)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar pedido");
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
        `${res.totalAdded} pedidos importados (${res.autoTriaged} na triagem, ${res.activeAdded} na fila).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ler CSV");
    } finally {
      setIsSubmitting(false);
      e.target.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-bold text-slate-900">Adicionar Pedidos</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switch */}
        <div className="flex gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2">
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
            Cadastro Manual
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
            Importar CSV
          </button>
        </div>

        <div className="p-5 space-y-4">
          {feedback && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
              {feedback}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
              {error}
            </div>
          )}

          {tab === "form" ? (
            <>
              {/* Compact 1-line Quick Fill Chips */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] font-medium text-slate-400">
                  Exemplos:
                </span>
                {QUICK_INGEST_PRESETS.map((p, idx) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(idx)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                  >
                    {p.title}
                  </button>
                ))}
              </div>

              <form
                onSubmit={handleFormSubmit}
                className="grid grid-cols-1 gap-3 pt-2 border-t border-slate-100 sm:grid-cols-3 text-xs"
              >
                <label className="block">
                  <span className="font-medium text-slate-600">Pedido</span>
                  <input
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    required
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-slate-600">Cliente</span>
                  <input
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    required
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-slate-600">Marca</span>
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
                  <span className="font-medium text-slate-600">Exceção</span>
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
                  <span className="font-medium text-slate-600">Valor (R$)</span>
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
                  <span className="font-medium text-slate-600">SKU</span>
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="font-medium text-slate-600">Produto</span>
                  <input
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-slate-600">
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
                  <span className="font-medium text-slate-600">UF</span>
                  <input
                    maxLength={2}
                    value={uf}
                    onChange={(e) => setUf(e.target.value.toUpperCase())}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 uppercase"
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-slate-600">Cidade</span>
                  <input
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-slate-600">CD / Turno</span>
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
                  <span className="font-medium text-slate-600">Máquina</span>
                  <input
                    value={maquina}
                    placeholder="Ex: IMP-02"
                    onChange={(e) => setMaquina(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-slate-600">Lote</span>
                  <input
                    value={lote}
                    onChange={(e) => setLote(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-slate-600">
                    Data Entrega
                  </span>
                  <input
                    type="date"
                    value={dataEntrega}
                    onChange={(e) => setDataEntrega(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                </label>

                <div className="sm:col-span-3 flex items-center justify-between pt-2">
                  <label className="inline-flex items-center gap-2 text-slate-600">
                    <input
                      type="checkbox"
                      checked={brinde}
                      onChange={(e) => setBrinde(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Inclui brinde
                  </label>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isSubmitting ? "Salvando..." : "Adicionar pedido"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-slate-400">
              <Upload className="h-7 w-7 text-slate-500" />
              <span className="mt-2 text-xs font-bold text-slate-800">
                Selecionar arquivo .CSV
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFileChange}
                disabled={isSubmitting}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

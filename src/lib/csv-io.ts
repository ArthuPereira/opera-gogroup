import Papa from "papaparse";
import { EnrichedOrder, ExceptionType, RawOrder } from "./types";

const VALID_EXCEPTIONS = new Set<ExceptionType>([
  "atraso_entrega",
  "extravio",
  "rastreio_parado",
  "devolvido_transportadora",
  "avaria_transporte",
  "vazamento_produto",
  "item_faltante",
  "falha_personalizacao",
  "pagamento_pendente",
  "ruptura_pos_venda",
  "endereco_divergente",
]);

export function parseOrdersCsv(csvText: string): RawOrder[] {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (!parsed.data || parsed.data.length === 0) {
    throw new Error("O arquivo CSV está vazio ou sem linhas válidas.");
  }

  const rows: RawOrder[] = [];

  for (let idx = 0; idx < parsed.data.length; idx++) {
    const row = parsed.data[idx];
    const orderId = String(row.order_id ?? "").trim();
    const customerId = String(row.customer_id ?? "").trim();
    if (!orderId || !customerId) continue;

    const rawTipo = String(row.tipo_excecao ?? "atraso_entrega").trim() as ExceptionType;
    const tipoExcecao: ExceptionType = VALID_EXCEPTIONS.has(rawTipo)
      ? rawTipo
      : "atraso_entrega";

    const brindeStr = String(row.brinde_no_pedido ?? "false").trim().toLowerCase();
    const brinde =
      brindeStr === "true" || brindeStr === "1" || brindeStr === "sim";

    const dataPedido = String(row.data_pedido ?? "2026-09-24").trim();
    const dataEntregaRaw = String(row.data_entrega ?? "").trim();
    const maquinaRaw = String(row.maquina ?? "").trim();

    rows.push({
      order_id: orderId,
      customer_id: customerId,
      marca: String(row.marca ?? "Gocase").trim(),
      data_pedido: dataPedido,
      valor: Math.max(0, Number(String(row.valor ?? "0").replace(",", ".")) || 0),
      sku: String(row.sku ?? "GOC-2001").trim(),
      descricao_produto: String(row.descricao_produto ?? "Produto Gogroup").trim(),
      qtd_itens: Math.max(1, parseInt(String(row.qtd_itens ?? "1"), 10) || 1),
      brinde_no_pedido: brinde,
      tipo_excecao: tipoExcecao,
      status: String(row.status ?? "aberta").trim(),
      transportadora: String(row.transportadora ?? "Veloz Log").trim(),
      uf: String(row.uf ?? "SP").trim().toUpperCase(),
      cidade: String(row.cidade ?? "São Paulo").trim(),
      data_prometida: String(row.data_prometida ?? dataPedido).trim(),
      data_entrega: dataEntregaRaw || null,
      maquina: maquinaRaw || null,
      turno: String(row.turno ?? "manhã").trim(),
      cd: String(row.cd ?? "CD1").trim().toUpperCase(),
      lote_produto: String(row.lote_produto ?? "L2608-A").trim(),
      data_abertura_excecao: String(
        row.data_abertura_excecao ?? "2026-09-30"
      ).trim(),
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "Nenhum pedido válido encontrado. Verifique se o CSV possui as colunas order_id e customer_id."
    );
  }

  return rows;
}

export function serializeEnrichedOrdersCsv(orders: EnrichedOrder[]): string {
  const formatted = orders.map((o) => ({
    order_id: o.order_id,
    customer_id: o.customer_id,
    marca: o.marca,
    data_pedido: o.data_pedido,
    valor: o.valor.toFixed(2),
    sku: o.sku,
    descricao_produto: o.descricao_produto,
    qtd_itens: o.qtd_itens,
    brinde_no_pedido: o.brinde_no_pedido ? "True" : "False",
    tipo_excecao: o.tipo_excecao,
    status: o.status,
    transportadora: o.transportadora,
    uf: o.uf,
    cidade: o.cidade,
    data_prometida: o.data_prometida,
    prazo_real_dias_uteis: o.realDueDate,
    dias_uteis_atraso_real: o.businessDaysLate,
    data_entrega: o.data_entrega ?? "",
    maquina: o.maquina ?? "",
    turno: o.turno,
    cd: o.cd,
    lote_produto: o.lote_produto,
    data_abertura_excecao: o.data_abertura_excecao,
    vip: o.isVipCustomer ? "Sim" : "Não",
    status_central_ai: o.workflowStatus,
    regra_auto_triagem: o.autoTriageCategory,
    risco_financeiro_brl: (o.directOrderRiskBRL + o.marginalCliffBRL).toFixed(2),
    acao_otima_recomendada: o.economics.recommendedOption.action,
    transportadora_recomendada:
      o.resolvedCarrier ?? o.economics.recommendedOption.recommendedCarrier,
    acao_executada:
      o.resolvedAction ??
      (o.workflowStatus === "auto_triaged" ? o.autoTriageCategory : ""),
    economia_gerada_brl: (o.resolvedSavingsBRL ?? 0).toFixed(2),
  }));

  return Papa.unparse(formatted, {
    quotes: true,
  });
}

export interface IngestPreset {
  id: string;
  badge: string;
  title: string;
  expectedBehavior: string;
  order: Omit<RawOrder, "order_id"> & { orderPrefix: "GC" | "GB" };
}

export const QUICK_INGEST_PRESETS: IngestPreset[] = [
  {
    id: "preset_auto_delivered",
    badge: "Entregue",
    title: "Já entregue",
    expectedBehavior: "Encerrado na triagem automática.",
    order: {
      orderPrefix: "GB",
      customer_id: "CL300021",
      marca: "Barbour's",
      data_pedido: "2026-09-18",
      valor: 164.9,
      sku: "BBS-1031",
      descricao_produto: "Deo Bd Spl Alter Ego 200Ml",
      qtd_itens: 2,
      brinde_no_pedido: false,
      tipo_excecao: "atraso_entrega",
      status: "aberta",
      transportadora: "Veloz Log",
      uf: "SP",
      cidade: "São Paulo",
      data_prometida: "2026-09-22",
      data_entrega: "2026-09-28",
      maquina: null,
      turno: "tarde",
      cd: "CD2",
      lote_produto: "L2608-A",
      data_abertura_excecao: "2026-09-29",
    },
  },
  {
    id: "preset_vip_lote_b",
    badge: "VIP",
    title: "VIP • Vazamento L2607-B",
    expectedBehavior: "Prioridade VIP com bloqueio de lote.",
    order: {
      orderPrefix: "GB",
      customer_id: "CL300014",
      marca: "Ápice",
      data_pedido: "2026-09-22",
      valor: 289.5,
      sku: "APC-1067",
      descricao_produto: "Máscara Reconstrutora Pro Ápice 500g",
      qtd_itens: 3,
      brinde_no_pedido: true,
      tipo_excecao: "vazamento_produto",
      status: "aberta",
      transportadora: "Veloz Log",
      uf: "RJ",
      cidade: "Rio de Janeiro",
      data_prometida: "2026-09-28",
      data_entrega: "2026-09-28",
      maquina: null,
      turno: "manhã",
      cd: "CD1",
      lote_produto: "L2607-B",
      data_abertura_excecao: "2026-09-30",
    },
  },
  {
    id: "preset_gocase_imp02",
    badge: "IMP-02",
    title: "Gocase • IMP-02",
    expectedBehavior: "Redireciona impressão para IMP-01/03.",
    order: {
      orderPrefix: "GC",
      customer_id: "CL309198",
      marca: "Gocase",
      data_pedido: "2026-09-25",
      valor: 139.9,
      sku: "GOC-2003",
      descricao_produto: "Case Personalizado iPhone 16 Pro Nome + Foto",
      qtd_itens: 2,
      brinde_no_pedido: false,
      tipo_excecao: "falha_personalizacao",
      status: "aberta",
      transportadora: "Entrega Já",
      uf: "SP",
      cidade: "São Paulo",
      data_prometida: "2026-09-29",
      data_entrega: "2026-09-29",
      maquina: "IMP-02",
      turno: "manhã",
      cd: "CD1",
      lote_produto: "L2608-B",
      data_abertura_excecao: "2026-09-30",
    },
  },
  {
    id: "preset_ne_extravio",
    badge: "Extravio NE",
    title: "Extravio • Rota Express CE",
    expectedBehavior: "Migra p/ Veloz Log e abre sinistro.",
    order: {
      orderPrefix: "GB",
      customer_id: "CL303045",
      marca: "Lescent",
      data_pedido: "2026-09-16",
      valor: 248.0,
      sku: "LSC-1059",
      descricao_produto: "Difusor de Ambientes Vidro Âmbar 250ml",
      qtd_itens: 2,
      brinde_no_pedido: false,
      tipo_excecao: "extravio",
      status: "aguardando_transportadora",
      transportadora: "Rota Express",
      uf: "CE",
      cidade: "Fortaleza",
      data_prometida: "2026-09-22",
      data_entrega: null,
      maquina: null,
      turno: "tarde",
      cd: "CD2",
      lote_produto: "L2608-C",
      data_abertura_excecao: "2026-09-29",
    },
  },
];

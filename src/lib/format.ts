import {
  AutoTriageCategory,
  ExceptionType,
  RecommendedActionType,
} from "./types";

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const brlCompactFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatBRL(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "R$ 0,00";
  return compact ? brlCompactFormatter.format(value) : brlFormatter.format(value);
}

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  atraso_entrega: "Atraso de Entrega",
  extravio: "Extravio em Trânsito",
  rastreio_parado: "Rastreio Parado",
  devolvido_transportadora: "Devolvido Transportadora",
  avaria_transporte: "Avaria no Transporte",
  vazamento_produto: "Vazamento de Produto",
  item_faltante: "Item / Brinde Faltante",
  falha_personalizacao: "Falha de Personalização",
  pagamento_pendente: "Pagamento Pendente",
  ruptura_pos_venda: "Ruptura Pós-Venda",
  endereco_divergente: "Endereço Divergente",
};

export const ACTION_LABELS: Record<RecommendedActionType, string> = {
  reenvio_prioritario: "Reenvio Prioritário Seguro",
  reexpedicao_sem_cmv: "Reexpedição Sem Novo CMV (0% CMV)",
  voucher_credito: "Voucher / Crédito Instantâneo (Frete R$ 0)",
  reembolso_direto: "Reembolso Integral",
  cobranca_pix_expiracao: "Disparo Automático Pix 24h",
  encerrar_entregue: "Encerramento Automático (Entregue)",
  monitorar_no_prazo: "Notificação Proativa (Prazo Real Vigente)",
};

export const AUTO_TRIAGE_LABELS: Record<
  Exclude<AutoTriageCategory, "none">,
  { title: string; badge: string; color: string }
> = {
  auto_encerrado_entregue: {
    title: "Regra A • Entregue Encerrado",
    badge: "Já Entregue",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  auto_cobranca_pix: {
    title: "Regra B • Link Pix 24h / Trava Estoque",
    badge: "Cobrança Pix",
    color: "bg-sky-50 text-sky-700 border-sky-200",
  },
  auto_aviso_falso_atraso: {
    title: "Regra C • Falso Atraso (Bug Dias Corridos)",
    badge: "Dentro do SLA Útil",
    color: "bg-violet-50 text-violet-700 border-violet-200",
  },
};

export function formatIsoDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

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
  extravio: "Extravio",
  rastreio_parado: "Rastreio Parado",
  devolvido_transportadora: "Devolvido",
  avaria_transporte: "Avaria",
  vazamento_produto: "Vazamento",
  item_faltante: "Item Faltante",
  falha_personalizacao: "Personalização",
  pagamento_pendente: "Pagto. Pendente",
  ruptura_pos_venda: "Ruptura",
  endereco_divergente: "Endereço Divergente",
};

export const ACTION_LABELS: Record<RecommendedActionType, string> = {
  reenvio_prioritario: "Reenvio Prioritário",
  reexpedicao_sem_cmv: "Reexpedição (Sem CMV)",
  voucher_credito: "Voucher / Crédito",
  reembolso_direto: "Reembolso",
  cobranca_pix_expiracao: "Cobrança Pix 24h",
  encerrar_entregue: "Encerrado (Entregue)",
  monitorar_no_prazo: "No Prazo Real",
};

export const AUTO_TRIAGE_LABELS: Record<
  Exclude<AutoTriageCategory, "none">,
  { title: string; badge: string; color: string }
> = {
  auto_encerrado_entregue: {
    title: "Já Entregues",
    badge: "Já Entregue",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  auto_cobranca_pix: {
    title: "Pix Pendente",
    badge: "Pix 24h",
    color: "bg-sky-50 text-sky-700 border-sky-200",
  },
  auto_aviso_falso_atraso: {
    title: "No Prazo Útil",
    badge: "No Prazo",
    color: "bg-violet-50 text-violet-700 border-violet-200",
  },
};

export const ACTOR_LABELS: Record<string, string> = {
  motor_deterministico: "Sistema",
  agente_ia_aprovado: "IA + Operador",
  operador_manual: "Operador",
  radar_sistemico: "Bloqueio Operacional",
};

export function formatIsoDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

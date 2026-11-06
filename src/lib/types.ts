export type ExceptionType =
  | "atraso_entrega"
  | "extravio"
  | "rastreio_parado"
  | "devolvido_transportadora"
  | "avaria_transporte"
  | "vazamento_produto"
  | "item_faltante"
  | "falha_personalizacao"
  | "pagamento_pendente"
  | "ruptura_pos_venda"
  | "endereco_divergente";

export type OrderStatus =
  | "aberta"
  | "aguardando_transportadora"
  | "aguardando_cliente"
  | "em_analise"
  | "auto_resolvida"
  | "resolvida";

export type AutoTriageCategory =
  | "none"
  | "auto_encerrado_entregue"
  | "auto_cobranca_pix"
  | "auto_aviso_falso_atraso";

export type RecommendedActionType =
  | "reenvio_prioritario"
  | "reexpedicao_sem_cmv"
  | "voucher_credito"
  | "reembolso_direto"
  | "cobranca_pix_expiracao"
  | "encerrar_entregue"
  | "monitorar_no_prazo";

export interface RawOrder {
  order_id: string;
  customer_id: string;
  marca: string;
  data_pedido: string;
  valor: number;
  sku: string;
  descricao_produto: string;
  qtd_itens: number;
  brinde_no_pedido: boolean;
  tipo_excecao: ExceptionType;
  status: string;
  transportadora: string;
  uf: string;
  cidade: string;
  data_prometida: string;
  data_entrega: string | null;
  maquina: string | null;
  turno: string;
  cd: string;
  lote_produto: string;
  data_abertura_excecao: string;
}

export interface OrderRecord extends RawOrder {
  workflowStatus: "active_queue" | "auto_triaged" | "resolved";
  autoTriageCategory: AutoTriageCategory;
  autoTriageNote?: string;
  manualOverrideFromAuto?: boolean;
  resolvedAction?: RecommendedActionType;
  resolvedCarrier?: string;
  resolvedNote?: string;
  resolvedSavingsBRL?: number;
  resolvedCostBRL?: number;
  resolvedAt?: string;
  claimId?: string;
  source?: "seed" | "manual" | "csv_upload";
}

export interface Customer {
  customer_id: string;
  n_pedidos: number;
  receita_acumulada: number;
  data_primeiro_pedido: string;
  n_contatos_atendimento: number;
}

export interface CarrierRoute {
  id?: string; // `${transportadora}|${uf_atendida}`
  transportadora: string;
  uf_atendida: string;
  sla_contratado_dias_uteis: number;
  custo_medio_frete: number;
}

export interface ActionOptionQuote {
  action: RecommendedActionType;
  label: string;
  directCostBRL: number;
  expectedLtvLossBRL: number;
  carrierRecoveryBRL: number;
  netImpactBRL: number;
  recommendedCarrier: string;
  carrierSlaDays: number;
  carrierFreightBRL: number;
  requiresPhysicalReship: boolean;
  antiRecurrenceGuards: string[];
  rationale: string;
}

export interface OrderEconomicsSummary {
  cmvBRL: number;
  currentCarrierFreightBRL: number;
  currentCarrierSlaDays: number;
  standardReshipCostBRL: number;
  refundCostBRL: number;
  reshipExceedsOrderValue: boolean;
  vipProtectionOverride: boolean;
  eligibleCarrierClaimBRL: number;
  recommendedOption: ActionOptionQuote;
  alternativeOptions: ActionOptionQuote[];
}

export interface EnrichedOrder extends OrderRecord {
  realDueDate: string;
  calendarBugDetected: boolean;
  businessDaysLate: number;
  daysOpen: number;
  cancelProbability: number;
  nextCliffDaysLeft: number | null;
  marginalCliffBRL: number;
  directOrderRiskBRL: number;
  isVipCustomer: boolean;
  customerAccumulatedRevenue: number;
  customerOrderCount: number;
  customerTicketAverage: number;
  customerLtvAtRiskSingleBRL: number;
  anomalyFlags: string[];
  requiresPhysicalReship: boolean;
  economics: OrderEconomicsSummary;
}

export interface CustomerPortfolio {
  customer_id: string;
  customer: Customer;
  isVip: boolean;
  orders: EnrichedOrder[];
  orderCount: number;
  totalOrderValueBRL: number;
  directOrderRiskBRL: number;
  marginalCliffBRL: number;
  customerLtvRiskBRL: number;
  avoidedSacContactsBRL: number;
  freightConsolidationSavingsBRL: number;
  riskTotalBRL: number;
  canConsolidatePhysicalBox: boolean;
  earliestExceptionDate: string;
  brands: string[];
  exceptionTypes: ExceptionType[];
  anomalyBadges: string[];
  topPriorityReason: string;
}

export interface QueueSimulationComparison {
  dailyCapacityTreatments: number;
  aiFirstPortfoliosHandled: number;
  aiFirstOrdersUnlocked: number;
  aiFirstRiskProtectedBRL: number;
  aiFirstValueCoveredBRL: number;
  fifoOrdersHandled: number;
  fifoActiveOrdersUnlocked: number;
  fifoWastedAutoTriagedSlots: number;
  fifoRiskProtectedBRL: number;
  fifoValueCoveredBRL: number;
  orderMultiplierVsFifo: number;
  extraRiskProtectedBRL: number;
  autoTriagedTotal: number;
  autoTriagedHoursSaved: number;
}

export type SystemicAnomalyId =
  | "bug_dias_corridos"
  | "imp_02_gocase"
  | "cd2_noite_brinde"
  | "lote_l2607b_apice"
  | "rota_express_nordeste"
  | "carga_norte_lescent_kokeshi";

export interface SystemicAnomaly {
  id: SystemicAnomalyId;
  title: string;
  subtitle: string;
  severity: "critica" | "alta";
  area: "TI / Checkout" | "Produção CD1" | "Picking CD2" | "Qualidade / Estoque" | "Malha Logística" | "Embalagem & Catálogo";
  affectedOrdersCount: number;
  concentrationMetric: string;
  financialExposureBRL: number;
  avoidableCostBRL: number;
  rootCauseEvidence: string;
  recommendedContainmentRule: string;
  targetEntity: string;
  replacementTarget: string;
  isContained: boolean;
}

export interface ContainmentOrder {
  id: string; // matches SystemicAnomalyId
  anomalyId: SystemicAnomalyId;
  title: string;
  active: boolean;
  activatedAt: string;
  ruleSummary: string;
  technicalDispatch: string;
  blockedTarget: string;
  redirectTarget: string;
  estimatedMonthlySavingsBRL: number;
  generatedByAgent: boolean;
}

export interface CarrierClaim {
  claim_id: string;
  order_id: string;
  customer_id: string;
  transportadora: string;
  uf: string;
  tipo_ocorrencia: "extravio" | "avaria_transporte";
  marca: string;
  sku: string;
  valor_pedido: number;
  valor_reclamado_brl: number;
  status_sinistro: "protocolado" | "em_recuperacao";
  evidencia_tecnica: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id?: number;
  timestamp: string;
  actor: "motor_deterministico" | "agente_ia_aprovado" | "operador_manual" | "radar_sistemico";
  actionTitle: string;
  targetIds: string[];
  financialImpactBRL: number;
  details: string;
  reversibleOrderIds?: string[];
}

export interface AgentToolTrace {
  step: number;
  toolName: string;
  summary: string;
  inputPreview: string;
  outputPreview: string;
}

export interface AgentOrderDecision {
  order_id: string;
  recommendedAction: RecommendedActionType;
  alternativeAction: RecommendedActionType;
  targetCarrier: string;
  productionDirective: string;
  antiRecurrenceGuards: string[];
  estimatedNetCostBRL: number;
  estimatedSavingsVsWorstBRL: number;
  openCarrierClaim: boolean;
  carrierClaimValueBRL: number;
}

export interface PortfolioResolutionPlan {
  customer_id: string;
  executiveSummary: string;
  consolidatePhysicalShipment: boolean;
  consolidationExplanation: string;
  totalProtectedRiskBRL: number;
  totalNetExecutionCostBRL: number;
  totalSavingsGeneratedBRL: number;
  totalCarrierClaimsBRL: number;
  decisions: AgentOrderDecision[];
  customerMessage: string;
  modelUsed: string;
  toolTraces: AgentToolTrace[];
}

export interface SystemicContainmentPlan {
  anomalyId: SystemicAnomalyId;
  title: string;
  executiveDiagnosis: string;
  ruleSummary: string;
  blockedTarget: string;
  redirectTarget: string;
  technicalDispatchMessage: string;
  estimatedSavingsBRL: number;
  modelUsed: string;
  toolTraces: AgentToolTrace[];
}

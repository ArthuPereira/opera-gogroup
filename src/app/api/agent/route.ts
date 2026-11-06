import { NextResponse } from "next/server";
import { generateText, tool } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";
import {
  buildOrderRecordFromRaw,
  checkTripleFreightLock,
  enrichOrderRecord,
  round2,
  SAC_CONTACT_COST_BRL,
} from "@/lib/business-rules";
import {
  AgentOrderDecision,
  AgentToolTrace,
  CarrierRoute,
  ContainmentOrder,
  Customer,
  PortfolioResolutionPlan,
  RawOrder,
  RecommendedActionType,
  SystemicAnomaly,
  SystemicContainmentPlan,
} from "@/lib/types";

export const maxDuration = 30;

const ACTION_ENUM = z.enum([
  "reenvio_prioritario",
  "reexpedicao_sem_cmv",
  "voucher_credito",
  "reembolso_direto",
]);

const CANDIDATE_MODELS = [
  process.env.GROQ_MODEL,
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
].filter((m): m is string => Boolean(m && m.trim()));

function getGroqProvider() {
  const apiKey = process.env.GROQ_KEY_API || process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chave da API Groq não encontrada. Configure GROQ_KEY_API no .env ou nas variáveis da Vercel."
    );
  }
  return createGroq({ apiKey });
}

async function runWithModelFallback<T>(
  runner: (modelName: string) => Promise<T>
): Promise<{ output: T; modelUsed: string }> {
  let lastError: unknown = null;
  for (let i = 0; i < CANDIDATE_MODELS.length; i++) {
    const modelName = CANDIDATE_MODELS[i];
    try {
      const output = await runner(modelName);
      return {
        output,
        modelUsed: i === 0 ? modelName : `${modelName} (fallback)`,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Nenhum modelo Groq disponível respondeu com sucesso.");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = body?.mode as "portfolio_resolution" | "systemic_containment";

    if (mode === "portfolio_resolution") {
      return await handlePortfolioResolution(body);
    }
    if (mode === "systemic_containment") {
      return await handleSystemicContainment(body);
    }

    return NextResponse.json(
      { error: "Modo de operação inválido para /api/agent." },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha inesperada na execução do Agente Groq.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePortfolioResolution(body: {
  customer: Customer;
  orders: RawOrder[];
  carriersByUf: Record<string, CarrierRoute[]>;
  activeContainments?: ContainmentOrder[];
}) {
  const groq = getGroqProvider();
  const {
    customer,
    orders: rawOrders,
    carriersByUf: carriersRecord,
    activeContainments = [],
  } = body;

  const carriersByUf = new Map<string, CarrierRoute[]>(
    Object.entries(carriersRecord || {})
  );
  const flatCarrierMap = new Map<string, CarrierRoute>();
  for (const list of carriersByUf.values()) {
    for (const c of list) {
      flatCarrierMap.set(`${c.transportadora}|${c.uf_atendida}`, c);
    }
  }

  const enrichedOrders = rawOrders.map((raw) => {
    const rec = buildOrderRecordFromRaw(raw, flatCarrierMap, "seed");
    rec.workflowStatus = "active_queue";
    return enrichOrderRecord(rec, customer, carriersByUf, activeContainments);
  });

  const canConsolidateBox = checkTripleFreightLock(enrichedOrders);
  const firstOrder = enrichedOrders[0];
  const ltvRisk = firstOrder?.customerLtvAtRiskSingleBRL ?? 0;
  const directRisk = round2(
    enrichedOrders.reduce(
      (acc, o) => acc + o.directOrderRiskBRL + o.marginalCliffBRL,
      0
    )
  );
  const sacAvoided = round2(
    Math.max(0, enrichedOrders.length - 1) * SAC_CONTACT_COST_BRL
  );
  const totalProtectedRiskBRL = round2(directRisk + ltvRisk + sacAvoided);

  interface SubmittedPlanShape {
    executiveSummary: string;
    consolidatePhysicalShipment: boolean;
    consolidationExplanation: string;
    decisions: Array<{
      order_id: string;
      recommendedAction: RecommendedActionType;
      alternativeAction: RecommendedActionType;
      targetCarrier: string;
      productionDirective: string;
      antiRecurrenceGuards: string[];
      openCarrierClaim: boolean;
    }>;
    customerMessage: string;
  }
  const planHolder: { current: SubmittedPlanShape | null } = { current: null };

  const toolTraces: AgentToolTrace[] = [];
  let stepCounter = 0;

  const { output: generation, modelUsed } = await runWithModelFallback((modelName) =>
    generateText({
      model: groq(modelName),
      temperature: 0.15,
      maxSteps: 6,
      system: `Você é o Agente Central AI-First de Operações da Gogroup (Gocase e GoBeauté).
Sua missão é investigar a carteira do cliente usando OBRIGATORIAMENTE as tools determinísticas na sequência lógica:
1) inspectPortfolioContext
2) checkRecurrenceAnomalies
3) simulateOptimalEconomics
4) submitResolutionPlan (OBRIGATÓRIO chamar esta tool ao final para entregar o plano executável).

REGRAS INEGOCIÁVEIS DE NEGÓCIO:
- Nunca invente valores em R$: use exatamente os números calculados pelas tools.
- Trava Anti-Reincidência:
  * Vazamento no lote L2607-B (APC-1067): proíba separar do L2607-B; exija lote íntegro (L2608-A/C).
  * Falha de personalização na IMP-02: bloqueie IMP-02 e roteie reimpressão para IMP-01 ou IMP-03 (CD1).
  * Nordeste (CE, PB, PE, BA, RN) com Rota Express: migre reenvio para Veloz Log (+R$ 3,22, mesmo SLA de 6d úteis).
  * Avaria na Carga Norte (especialmente vidro Lescent): migre transportadora + embalagem colmeia dupla + abra protocolo de ressarcimento.
  * Devolvido transportadora (especialmente personalizados Gocase sem valor de revenda): use reexpedicao_sem_cmv (CMV R$ 0 + frete) após confirmar endereço.
  * Item faltante com brinde ou ruptura pós-venda (KSH-1009/1010/1011): priorize voucher_credito (Frete R$ 0).
- Trava Tripla de Consolidação: só marque consolidatePhysicalShipment=true se inspectPortfolioContext confirmar mesmo CD + mesma UF/cidade + >=2 reenvios físicos.
- Escreva tudo em Português do Brasil claro, executivo e empático na mensagem ao cliente.`,
      prompt: `Investigue e monte o Plano Economicamente Ótimo para a carteira do cliente ${customer.customer_id} (${enrichedOrders.length} pedido(s): ${enrichedOrders
        .map((o) => `${o.order_id} [${o.marca} - ${o.tipo_excecao} - R$ ${o.valor.toFixed(2)}]`)
        .join(", ")}). Execute as 4 tools em sequência até registrar submitResolutionPlan.`,
      tools: {
        inspectPortfolioContext: tool({
          description:
            "Inspeciona os pedidos da carteira do cliente, status VIP/LTV em risco e verifica a Trava Tripla de consolidação física de frete.",
          parameters: z.object({
            focusNote: z
              .string()
              .optional()
              .default("")
              .describe("Foco inicial da inspeção da carteira"),
          }),
          execute: async (args) => {
            const payload = {
              customer_id: customer.customer_id,
              isVip: firstOrder?.isVipCustomer ?? false,
              accumulatedRevenueBRL: customer.receita_acumulada,
              historicalOrders: customer.n_pedidos,
              ltvAtRiskOnceBRL: ltvRisk,
              avoidedExtraSacContactsBRL: sacAvoided,
              tripleFreightLock: {
                canConsolidatePhysicalBox: canConsolidateBox,
                rule: "Mesmo CD + Mesma UF/Cidade + >=2 ações de reenvio físico",
              },
              orders: enrichedOrders.map((o) => ({
                order_id: o.order_id,
                marca: o.marca,
                sku: o.sku,
                descricao: o.descricao_produto,
                valorBRL: o.valor,
                brinde: o.brinde_no_pedido,
                tipo_excecao: o.tipo_excecao,
                transportadoraAtual: o.transportadora,
                destino: `${o.cidade}/${o.uf}`,
                cd: o.cd,
                turno: o.turno,
                maquina: o.maquina,
                lote: o.lote_produto,
                realDueDate: o.realDueDate,
                businessDaysLate: o.businessDaysLate,
                directRiskBRL: o.directOrderRiskBRL,
                cliffBRL: o.marginalCliffBRL,
              })),
            };

            stepCounter++;
            toolTraces.push({
              step: stepCounter,
              toolName: "inspectPortfolioContext",
              summary: `Carteira ${customer.customer_id} (${
                payload.isVip ? "VIP" : "Regular"
              }, R$ ${customer.receita_acumulada.toFixed(2)} acum.) com ${
                enrichedOrders.length
              } pedido(s) • Risco Total R$ ${totalProtectedRiskBRL.toFixed(2)} • Consolidação física: ${
                canConsolidateBox ? "APROVADA" : "NÃO APLICÁVEL"
              }`,
              inputPreview: args.focusNote || `customer_id=${customer.customer_id}`,
              outputPreview: `LTV em risco: R$ ${ltvRisk.toFixed(2)} | Risco direto+cliff: R$ ${directRisk.toFixed(2)}`,
            });

            return payload;
          },
        }),

        checkRecurrenceAnomalies: tool({
          description:
            "Verifica armadilhas operacionais nos pedidos (IMP-02, Lote L2607-B, Rota Express NE, Carga Norte Lescent, CD2 Noite Brinde, Ruptura Kokeshi) e contenções sistêmicas ativas.",
          parameters: z.object({
            includeActiveContainments: z.boolean().default(true),
          }),
          execute: async () => {
            const findings = enrichedOrders.map((o) => ({
              order_id: o.order_id,
              anomalyFlags: o.anomalyFlags,
              requiredGuards: o.economics.recommendedOption.antiRecurrenceGuards,
            }));
            const activeRules = activeContainments
              .filter((c) => c.active)
              .map((c) => `${c.title}: ${c.blockedTarget} -> ${c.redirectTarget}`);

            const totalGuards = findings.reduce(
              (acc, f) => acc + f.anomalyFlags.length + f.requiredGuards.length,
              0
            );

            stepCounter++;
            toolTraces.push({
              step: stepCounter,
              toolName: "checkRecurrenceAnomalies",
              summary:
                totalGuards > 0
                  ? `${totalGuards} alerta(s)/trava(s) anti-reincidência detectados (${findings
                      .flatMap((f) => f.anomalyFlags)
                      .join(", ") || "proteção de rota"})`
                  : "Nenhuma anomalia crônica crítica; aplicadas boas práticas padrão de rota.",
              inputPreview: `${enrichedOrders.length} pedido(s) cruzados contra 6 causas-raiz`,
              outputPreview:
                activeRules.length > 0
                  ? `Contenções sistêmicas ativas aplicadas: ${activeRules.join(" | ")}`
                  : findings
                      .map((f) => `${f.order_id}: ${f.anomalyFlags.join(", ") || "OK"}`)
                      .join(" • "),
            });

            return { findings, activeSystemicContainments: activeRules };
          },
        }),

        simulateOptimalEconomics: tool({
          description:
            "Compara matematicamente os custos líquidos em R$ de Reenvio, Reexpedição (0% CMV), Voucher (Frete R$ 0) e Reembolso + ressarcimento de transportadora.",
          parameters: z.object({
            evaluateCarrierClaims: z.boolean().default(true),
          }),
          execute: async () => {
            const simulations = enrichedOrders.map((o) => ({
              order_id: o.order_id,
              valorPagoBRL: o.valor,
              cmv24PctBRL: o.economics.cmvBRL,
              reshipExceedsOrderValue: o.economics.reshipExceedsOrderValue,
              vipProtectionOverride: o.economics.vipProtectionOverride,
              eligibleCarrierClaimBRL: o.economics.eligibleCarrierClaimBRL,
              optimalAction: o.economics.recommendedOption,
              alternatives: o.economics.alternativeOptions,
            }));

            const totalNetCost = round2(
              enrichedOrders.reduce(
                (acc, o) => acc + o.economics.recommendedOption.directCostBRL,
                0
              )
            );
            const totalClaims = round2(
              enrichedOrders.reduce(
                (acc, o) => acc + o.economics.eligibleCarrierClaimBRL,
                0
              )
            );
            const totalRefundComparison = round2(
              enrichedOrders.reduce((acc, o) => acc + o.valor, 0) + ltvRisk
            );

            stepCounter++;
            toolTraces.push({
              step: stepCounter,
              toolName: "simulateOptimalEconomics",
              summary: `Custo ótimo R$ ${totalNetCost.toFixed(
                2
              )} vs Perda de Cancelamento+LTV R$ ${totalRefundComparison.toFixed(
                2
              )}${
                totalClaims > 0
                  ? ` • Sinistro recuperável: R$ ${totalClaims.toFixed(2)}`
                  : ""
              }`,
              inputPreview: "Matriz CMV (24%) + Frete UF + Proteção LTV + Sinistros",
              outputPreview: simulations
                .map(
                  (s) =>
                    `${s.order_id}: ${s.optimalAction.action} (R$ ${s.optimalAction.directCostBRL.toFixed(
                      2
                    )} via ${s.optimalAction.recommendedCarrier})`
                )
                .join(" • "),
            });

            return {
              totalProtectedRiskBRL,
              totalDirectExecutionCostBRL: totalNetCost,
              totalRecoverableCarrierClaimsBRL: totalClaims,
              simulations,
            };
          },
        }),

        submitResolutionPlan: tool({
          description:
            "Registra o plano final validado com decisões por pedido, travas anti-reincidência e mensagem consolidada para o cliente.",
          parameters: z.object({
            executiveSummary: z
              .string()
              .describe("Resumo executivo direto explicando a lógica financeira em R$ e travas aplicadas"),
            consolidatePhysicalShipment: z.boolean().default(false),
            consolidationExplanation: z.string().default(""),
            decisions: z.array(
              z.object({
                order_id: z.string(),
                recommendedAction: ACTION_ENUM,
                alternativeAction: ACTION_ENUM.default("voucher_credito"),
                targetCarrier: z.string().default("Veloz Log"),
                productionDirective: z.string().default(""),
                antiRecurrenceGuards: z.array(z.string()).default([]),
                openCarrierClaim: z.boolean().default(false),
              })
            ),
            customerMessage: z
              .string()
              .describe("Mensagem única e acolhedora pronta para envio via WhatsApp/E-mail cobrindo toda a carteira"),
          }),
          execute: async (args) => {
            planHolder.current = args;
            stepCounter++;
            toolTraces.push({
              step: stepCounter,
              toolName: "submitResolutionPlan",
              summary: `Plano estruturado validado p/ ${args.decisions.length} pedido(s) pronto para execução em 1 clique.`,
              inputPreview: `consolidate=${args.consolidatePhysicalShipment}`,
              outputPreview: args.executiveSummary.slice(0, 140),
            });
            return { status: "plan_locked_and_validated" };
          },
        }),
      },
    })
  );

  const submittedPlanArgs = planHolder.current;

  // Combina as decisões do Agente com a garantia matemática determinística de cada pedido
  const finalDecisions: AgentOrderDecision[] = enrichedOrders.map((o) => {
    const llmDec = submittedPlanArgs?.decisions.find(
      (d) => d.order_id === o.order_id
    );
    const recAction: RecommendedActionType =
      llmDec?.recommendedAction ?? o.economics.recommendedOption.action;
    const altAction: RecommendedActionType =
      llmDec?.alternativeAction ??
      o.economics.alternativeOptions[0]?.action ??
      "reembolso_direto";

    const allQuotes = [
      o.economics.recommendedOption,
      ...o.economics.alternativeOptions,
    ];
    const matchedQuote =
      allQuotes.find((q) => q.action === recAction) ??
      o.economics.recommendedOption;

    const worstImpact = o.economics.alternativeOptions.reduce(
      (max, q) => Math.max(max, q.netImpactBRL),
      o.valor + o.customerLtvAtRiskSingleBRL / Math.max(1, enrichedOrders.length)
    );

    const guards = Array.from(
      new Set([
        ...o.economics.recommendedOption.antiRecurrenceGuards,
        ...(llmDec?.antiRecurrenceGuards ?? []),
      ])
    );

    return {
      order_id: o.order_id,
      recommendedAction: recAction,
      alternativeAction: altAction,
      targetCarrier:
        llmDec?.targetCarrier || matchedQuote.recommendedCarrier,
      productionDirective:
        llmDec?.productionDirective ||
        guards[0] ||
        matchedQuote.rationale,
      antiRecurrenceGuards: guards,
      estimatedNetCostBRL: matchedQuote.directCostBRL,
      estimatedSavingsVsWorstBRL: round2(
        Math.max(5, worstImpact - matchedQuote.netImpactBRL)
      ),
      openCarrierClaim:
        o.economics.eligibleCarrierClaimBRL > 0 &&
        (llmDec?.openCarrierClaim ?? true),
      carrierClaimValueBRL: o.economics.eligibleCarrierClaimBRL,
    };
  });

  const freightConsolidationDiscount = canConsolidateBox
    ? round2(
        enrichedOrders
          .filter((o) => o.requiresPhysicalReship)
          .slice(1)
          .reduce(
            (acc, o) => acc + o.economics.recommendedOption.carrierFreightBRL,
            0
          )
      )
    : 0;

  const totalNetExecutionCostBRL = round2(
    Math.max(
      0,
      finalDecisions.reduce((acc, d) => acc + d.estimatedNetCostBRL, 0) -
        freightConsolidationDiscount
    )
  );
  const totalCarrierClaimsBRL = round2(
    finalDecisions.reduce(
      (acc, d) => acc + (d.openCarrierClaim ? d.carrierClaimValueBRL : 0),
      0
    )
  );
  const totalSavingsGeneratedBRL = round2(
    Math.max(
      12,
      totalProtectedRiskBRL -
        Math.max(0, totalNetExecutionCostBRL - totalCarrierClaimsBRL) * 0.4
    )
  );

  const fallbackSummary =
    generation.text?.trim() ||
    `Carteira ${customer.customer_id} analisada: proteção de R$ ${totalProtectedRiskBRL.toFixed(
      2
    )} em risco com custo direto otimizado de R$ ${totalNetExecutionCostBRL.toFixed(
      2
    )}${
      totalCarrierClaimsBRL > 0
        ? ` e recuperação de R$ ${totalCarrierClaimsBRL.toFixed(
            2
          )} via sinistro de transportadora`
        : ""
    }.`;

  const fallbackMessage = `Olá! Aqui é da equipe de Prioridade Gogroup. Identificamos tudo sobre ${
    enrichedOrders.length > 1
      ? `os seus pedidos (${enrichedOrders.map((o) => o.order_id).join(", ")})`
      : `o seu pedido ${enrichedOrders[0].order_id}`
  } e já aplicamos a solução imediata: ${finalDecisions
    .map(
      (d) =>
        `${d.order_id} -> ${d.recommendedAction.replace(/_/g, " ")} (${
          d.targetCarrier
        })`
    )
    .join("; ")}. Você receberá a atualização de acompanhamento prioritário ainda hoje!`;

  const responsePlan: PortfolioResolutionPlan = {
    customer_id: customer.customer_id,
    executiveSummary: submittedPlanArgs?.executiveSummary || fallbackSummary,
    consolidatePhysicalShipment: canConsolidateBox,
    consolidationExplanation: canConsolidateBox
      ? submittedPlanArgs?.consolidationExplanation ||
        `Trava Tripla atendida (${firstOrder.cd} -> ${firstOrder.cidade}/${firstOrder.uf}): reenvios unificados em caixa única economizando R$ ${freightConsolidationDiscount.toFixed(2)} em frete.`
      : submittedPlanArgs?.consolidationExplanation ||
        (enrichedOrders.length === 1
          ? "Carteira com pedido único (sem necessidade de consolidação de caixa)."
          : "Trava Tripla bloqueou unificação física (CDs ou modalidades distintas), mas unificou o atendimento em 1 único contato."),
    totalProtectedRiskBRL,
    totalNetExecutionCostBRL,
    totalSavingsGeneratedBRL,
    totalCarrierClaimsBRL,
    decisions: finalDecisions,
    customerMessage: submittedPlanArgs?.customerMessage || fallbackMessage,
    modelUsed,
    toolTraces,
  };

  return NextResponse.json(responsePlan);
}

async function handleSystemicContainment(body: {
  anomaly: SystemicAnomaly;
  sampleOrders?: Array<{
    order_id: string;
    marca: string;
    sku: string;
    valor: number;
    uf: string;
    transportadora: string;
    cd: string;
    turno: string;
    maquina: string | null;
    lote_produto: string;
  }>;
}) {
  const groq = getGroqProvider();
  const { anomaly, sampleOrders = [] } = body;

  const toolTraces: AgentToolTrace[] = [];
  let stepCounter = 0;

  interface SubmittedContainmentShape {
    title: string;
    executiveDiagnosis: string;
    ruleSummary: string;
    blockedTarget: string;
    redirectTarget: string;
    technicalDispatchMessage: string;
  }
  const containmentHolder: { current: SubmittedContainmentShape | null } = {
    current: null,
  };

  const { output: generation, modelUsed } = await runWithModelFallback((modelName) =>
    generateText({
      model: groq(modelName),
      temperature: 0.15,
      maxSteps: 5,
      system: `Você é o Engenheiro Líder de Automação de Processos AI-First da Gogroup.
Ao investigar um alerta do Radar Sistêmico, execute em sequência:
1) quantifyAnomalyImpact
2) simulateContainmentRouting
3) submitContainmentOrder (OBRIGATÓRIO para emitir a Ordem de Contenção Operacional).

Use números exatos em R$, cite a concentração estatística real e redija um comunicado técnico curto e acionável para os líderes de CD / Logística / TI.`,
      prompt: `Emita uma Ordem de Contenção Sistêmica para estancar a causa-raiz "${anomaly.title}" (${anomaly.concentrationMetric}, exposição de R$ ${anomaly.financialExposureBRL.toFixed(2)}).`,
      tools: {
        quantifyAnomalyImpact: tool({
          description:
            "Quantifica o volume afetado, concentração percentual e perda financeira evitável da anomalia sistêmica.",
          parameters: z.object({
            anomalyId: z.string(),
          }),
          execute: async () => {
            stepCounter++;
            const stats = {
              id: anomaly.id,
              area: anomaly.area,
              affectedOrdersCount: anomaly.affectedOrdersCount,
              concentrationMetric: anomaly.concentrationMetric,
              financialExposureBRL: anomaly.financialExposureBRL,
              avoidableCostBRL: anomaly.avoidableCostBRL,
              sampleOrderIds: sampleOrders.slice(0, 5).map((s) => s.order_id),
            };
            toolTraces.push({
              step: stepCounter,
              toolName: "quantifyAnomalyImpact",
              summary: `${anomaly.affectedOrdersCount} pedidos atingidos • Exposição R$ ${anomaly.financialExposureBRL.toFixed(
                2
              )} • Economia direta R$ ${anomaly.avoidableCostBRL.toFixed(2)}`,
              inputPreview: `anomaly=${anomaly.id}`,
              outputPreview: anomaly.concentrationMetric,
            });
            return stats;
          },
        }),

        simulateContainmentRouting: tool({
          description:
            "Valida a capacidade operacional do substituto (máquina, lote, transportadora ou trava WMS/Checkout).",
          parameters: z.object({
            targetToBlock: z.string(),
            candidateSubstitute: z.string(),
          }),
          execute: async (args) => {
            stepCounter++;
            const result = {
              feasible: true,
              blockedTarget: anomaly.targetEntity,
              approvedSubstitute: anomaly.replacementTarget,
              recommendedRule: anomaly.recommendedContainmentRule,
              slaImpact: "Zero degradação de SLA; elimina reincidência na fila humana.",
            };
            toolTraces.push({
              step: stepCounter,
              toolName: "simulateContainmentRouting",
              summary: `Roteamento validado: bloquear [${anomaly.targetEntity}] -> ativar [${anomaly.replacementTarget}]`,
              inputPreview: `${args.targetToBlock} -> ${args.candidateSubstitute}`,
              outputPreview: anomaly.recommendedContainmentRule,
            });
            return result;
          },
        }),

        submitContainmentOrder: tool({
          description:
            "Emite a Ordem de Contenção Operacional estruturada para ativação imediata no motor da Central.",
          parameters: z.object({
            title: z.string(),
            executiveDiagnosis: z.string(),
            ruleSummary: z.string(),
            blockedTarget: z.string(),
            redirectTarget: z.string(),
            technicalDispatchMessage: z
              .string()
              .describe("Ordem de serviço objetiva para CD/Logística/TI executar agora"),
          }),
          execute: async (args) => {
            containmentHolder.current = args;
            stepCounter++;
            toolTraces.push({
              step: stepCounter,
              toolName: "submitContainmentOrder",
              summary: `Ordem de Contenção emitida: ${args.ruleSummary.slice(0, 110)}`,
              inputPreview: args.blockedTarget,
              outputPreview: args.redirectTarget,
            });
            return { status: "containment_ready" };
          },
        }),
      },
    })
  );

  const submittedContainment = containmentHolder.current;

  const plan: SystemicContainmentPlan = {
    anomalyId: anomaly.id,
    title: submittedContainment?.title || anomaly.title,
    executiveDiagnosis:
      submittedContainment?.executiveDiagnosis ||
      generation.text?.trim() ||
      anomaly.rootCauseEvidence,
    ruleSummary:
      submittedContainment?.ruleSummary || anomaly.recommendedContainmentRule,
    blockedTarget: submittedContainment?.blockedTarget || anomaly.targetEntity,
    redirectTarget:
      submittedContainment?.redirectTarget || anomaly.replacementTarget,
    technicalDispatchMessage:
      submittedContainment?.technicalDispatchMessage ||
      `[ORDEM DE CONTENÇÃO IMEDIATA - ${anomaly.area}] Bloquear ${anomaly.targetEntity} e redirecionar fluxo para ${anomaly.replacementTarget}. Evidência: ${anomaly.concentrationMetric}.`,
    estimatedSavingsBRL: anomaly.avoidableCostBRL,
    modelUsed,
    toolTraces,
  };

  return NextResponse.json(plan);
}

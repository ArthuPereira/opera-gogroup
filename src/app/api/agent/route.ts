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
import { ACTION_LABELS } from "@/lib/format";
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

/**
 * Modelos priorizados com buckets independentes de 8.000 TPM na Groq.
 * qwen/qwen3.8-27b foi removido da cadeia por instabilidade (503/429) e alto gasto de tokens de raciocínio.
 */
const CANDIDATE_MODELS = Array.from(
  new Set(
    [
      process.env.GROQ_MODEL,
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
    ].filter((m): m is string => Boolean(m && m.trim()))
  )
);

const CACHE_TTL_MS = 90_000;
const responseCache = new Map<string, { expiresAt: number; payload: unknown }>();

function getCachedResponse<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.payload as T;
}

function setCachedResponse(key: string, payload: unknown) {
  if (responseCache.size > 200) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  });
}

function getGroqProvider() {
  const apiKey = process.env.GROQ_KEY_API || process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }
  return createGroq({
    apiKey,
    fetch: async (url, init) => {
      if (init?.body && typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body) as Record<string, unknown>;
          const modelId = String(parsed.model || "");
          if (modelId.includes("gpt-oss") && !parsed.reasoning_effort) {
            parsed.reasoning_effort = "low";
          }
          init = { ...init, body: JSON.stringify(parsed) };
        } catch {
          // Mantém body original caso não seja JSON
        }
      }
      const res = await fetch(url, init);
      if (res.status === 429) {
        const cloneText = await res.clone().text().catch(() => "");
        const msMatch = cloneText.match(/try again in ([0-9.]+)(ms|s)/i);
        if (msMatch) {
          const rawVal = parseFloat(msMatch[1]);
          const waitMs =
            msMatch[2].toLowerCase() === "s" ? rawVal * 1000 : rawVal;
          if (waitMs > 0 && waitMs <= 2500) {
            await new Promise((r) => setTimeout(r, Math.ceil(waitMs) + 80));
            return fetch(url, init);
          }
        }
      }
      return res;
    },
  });
}

async function runWithModelFallback<T>(
  runner: (modelName: string) => Promise<T>
): Promise<{ output: T; modelUsed: string } | null> {
  for (let i = 0; i < CANDIDATE_MODELS.length; i++) {
    const modelName = CANDIDATE_MODELS[i];
    try {
      const output = await runner(modelName);
      return {
        output,
        modelUsed: i === 0 ? modelName : `${modelName} (fallback)`,
      };
    } catch (err) {
      console.warn(
        `[agent] Falha no modelo ${modelName}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return null;
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
        : "Falha inesperada ao processar análise.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePortfolioResolution(body: {
  customer: Customer;
  orders: RawOrder[];
  carriersByUf: Record<string, CarrierRoute[]>;
  activeContainments?: ContainmentOrder[];
}) {
  const {
    customer,
    orders: rawOrders,
    carriersByUf: carriersRecord,
    activeContainments = [],
  } = body;

  const activeContainmentKey = activeContainments
    .filter((c) => c.active)
    .map((c) => c.id)
    .sort()
    .join(",");
  const cacheKey = `portfolio:${customer.customer_id}:${rawOrders
    .map((o) => o.order_id)
    .sort()
    .join(",")}:${activeContainmentKey}`;

  const cached = getCachedResponse<PortfolioResolutionPlan>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

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

  const SubmitPlanSchema = z.object({
    executiveSummary: z.string(),
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
    customerMessage: z.string(),
  });

  type SubmittedPlanShape = z.infer<typeof SubmitPlanSchema>;

  const activeRules = activeContainments
    .filter((c) => c.active)
    .map((c) => `${c.blockedTarget}->${c.redirectTarget}`);

  const buildInspectTrace = (step: number): AgentToolTrace => ({
    step,
    toolName: "inspectPortfolioContext",
    summary: `Carteira ${customer.customer_id} (${
      firstOrder?.isVipCustomer ? "VIP" : "Regular"
    }, R$ ${customer.receita_acumulada.toFixed(2)} acum.) com ${
      enrichedOrders.length
    } pedido(s) • Risco R$ ${totalProtectedRiskBRL.toFixed(
      2
    )} • Caixa única: ${canConsolidateBox ? "SIM" : "NÃO"}`,
    inputPreview: `customer_id=${customer.customer_id}`,
    outputPreview: `LTV R$ ${ltvRisk.toFixed(2)} | Direto+SLA R$ ${directRisk.toFixed(2)}`,
  });

  const buildAnomalyTrace = (step: number): AgentToolTrace => {
    const flags = enrichedOrders.flatMap((o) => o.anomalyFlags);
    const guardsCount = enrichedOrders.reduce(
      (acc, o) =>
        acc +
        o.anomalyFlags.length +
        o.economics.recommendedOption.antiRecurrenceGuards.length,
      0
    );
    return {
      step,
      toolName: "checkRecurrenceAnomalies",
      summary:
        guardsCount > 0
          ? `${guardsCount} trava(s) anti-reincidência aplicadas (${
              Array.from(new Set(flags)).join(", ") || "proteção de rota"
            })`
          : "Sem anomalia crônica; mantido padrão seguro de expedição.",
      inputPreview: `${enrichedOrders.length} pedido(s) verificados`,
      outputPreview:
        activeRules.length > 0
          ? `Contenções ativas: ${activeRules.join(" | ")}`
          : enrichedOrders
              .map((o) => `${o.order_id}: ${o.anomalyFlags.join(",") || "OK"}`)
              .join(" • "),
    };
  };

  const buildEconomicsTrace = (step: number): AgentToolTrace => {
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
    const refundLoss = round2(
      enrichedOrders.reduce((acc, o) => acc + o.valor, 0) + ltvRisk
    );
    return {
      step,
      toolName: "simulateOptimalEconomics",
      summary: `Custo ótimo R$ ${totalNetCost.toFixed(
        2
      )} vs Cancelamento+LTV R$ ${refundLoss.toFixed(2)}${
        totalClaims > 0 ? ` • Sinistro R$ ${totalClaims.toFixed(2)}` : ""
      }`,
      inputPreview: "CMV 24% + Frete UF + LTV + Sinistro",
      outputPreview: enrichedOrders
        .map(
          (o) =>
            `${o.order_id}: ${o.economics.recommendedOption.action} (R$ ${o.economics.recommendedOption.directCostBRL.toFixed(
              2
            )})`
        )
        .join(" • "),
    };
  };

  let toolTraces: AgentToolTrace[] = [];
  let submittedPlanArgs: SubmittedPlanShape | null = null;
  let fallbackText = "";
  let modelUsed = "contingencia-operacional";

  const groq = getGroqProvider();

  if (groq) {
    const llmResult = await runWithModelFallback(async (modelName) => {
      const attemptTraces: AgentToolTrace[] = [];
      let stepCounter = 0;

      const gen = await generateText({
        model: groq(modelName),
        temperature: 0.1,
        maxRetries: 0,
        maxSteps: 3,
        system: `Analista sênior de operações Gogroup (Gocase e GoBeauté).
Passo 1: chame auditPortfolio.
Passo 2: chame submitResolutionPlan com os valores exatos em R$ retornados.
Regras:
- Nunca invente valores nem use jargões internos de sistema.
- Respeite travas de lote (bloquear L2607-B -> L2608-A/C), máquina (bloquear IMP-02 -> IMP-01/03), rota NE (migrar Rota Express -> Veloz Log), Carga Norte vidro (colmeia dupla + sinistro), devolvido Gocase personalizado (reexpedicao_sem_cmv) e ruptura KSH-1009..1011/brinde (voucher_credito).
- consolidatePhysicalShipment=true somente se boxConsolidation=true.
- Português do Brasil objetivo no resumo e empático na mensagem ao cliente.`,
        prompt: `Analise o cliente ${customer.customer_id} (${enrichedOrders
          .map((o) => `${o.order_id}:${o.tipo_excecao}`)
          .join(", ")}) e registre submitResolutionPlan.`,
        tools: {
          auditPortfolio: tool({
            description:
              "Audita contexto da carteira, anomalias de reincidência e simulação econômica ótima por pedido.",
            parameters: z.object({}),
            execute: async () => {
              attemptTraces.push(
                buildInspectTrace(++stepCounter),
                buildAnomalyTrace(++stepCounter),
                buildEconomicsTrace(++stepCounter)
              );
              return {
                vip: firstOrder?.isVipCustomer ?? false,
                ltvRisk,
                totalProtectedRiskBRL,
                boxConsolidation: canConsolidateBox,
                activeRules,
                orders: enrichedOrders.map((o) => ({
                  id: o.order_id,
                  marca: o.marca,
                  sku: o.sku,
                  val: o.valor,
                  exc: o.tipo_excecao,
                  dest: `${o.cidade}/${o.uf}`,
                  cd: o.cd,
                  atrasoUteis: o.businessDaysLate,
                  flags: o.anomalyFlags,
                  guards: o.economics.recommendedOption.antiRecurrenceGuards.map(
                    (g) => g.slice(0, 85)
                  ),
                  rec: o.economics.recommendedOption.action,
                  costBRL: o.economics.recommendedOption.directCostBRL,
                  carrier: o.economics.recommendedOption.recommendedCarrier,
                  alt:
                    o.economics.alternativeOptions[0]?.action ??
                    "reembolso_direto",
                  claimBRL: o.economics.eligibleCarrierClaimBRL,
                })),
              };
            },
          }),

          // Sem execute: encerra o loop imediatamente ao submeter o plano, economizando 1 round-trip inteiro de tokens
          submitResolutionPlan: tool({
            description: "Entrega o plano final consolidado para a carteira.",
            parameters: SubmitPlanSchema,
          }),
        },
      });

      const allToolCalls = gen.steps.flatMap((s) => s.toolCalls);
      const submitCall = allToolCalls.find(
        (tc) => tc.toolName === "submitResolutionPlan"
      );

      let parsedPlan: SubmittedPlanShape | null = null;
      if (submitCall) {
        const parsed = SubmitPlanSchema.safeParse(submitCall.args);
        if (parsed.success) {
          parsedPlan = parsed.data;
          stepCounter++;
          attemptTraces.push({
            step: stepCounter,
            toolName: "submitResolutionPlan",
            summary: `Plano consolidado para ${parsedPlan.decisions.length} pedido(s).`,
            inputPreview: `consolidate=${parsedPlan.consolidatePhysicalShipment}`,
            outputPreview: parsedPlan.executiveSummary.slice(0, 140),
          });
        }
      }

      return { gen, attemptTraces, parsedPlan };
    });

    if (llmResult) {
      modelUsed = llmResult.modelUsed;
      toolTraces = llmResult.output.attemptTraces;
      submittedPlanArgs = llmResult.output.parsedPlan;
      fallbackText = llmResult.output.gen.text?.trim() || "";
    }
  }

  // Se todos os modelos estiverem temporariamente em limite de cota (429/503) ou sem chave, garante resposta determinística completa sem erro 500
  if (toolTraces.length === 0) {
    toolTraces = [
      buildInspectTrace(1),
      buildAnomalyTrace(2),
      buildEconomicsTrace(3),
      {
        step: 4,
        toolName: "submitResolutionPlan",
        summary: `Plano calculado pelo motor de regras para ${enrichedOrders.length} pedido(s).`,
        inputPreview: `consolidate=${canConsolidateBox}`,
        outputPreview: "Contingência automática aplicada sem interrupção operacional.",
      },
    ];
  }

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
    fallbackText ||
    `Proteção de R$ ${totalProtectedRiskBRL.toFixed(
      2
    )} em receita/LTV com custo direto de execução de R$ ${totalNetExecutionCostBRL.toFixed(
      2
    )}${
      canConsolidateBox
        ? `, caixa única (-R$ ${freightConsolidationDiscount.toFixed(2)} em frete)`
        : ""
    }${
      totalCarrierClaimsBRL > 0
        ? ` e R$ ${totalCarrierClaimsBRL.toFixed(2)} elegíveis a ressarcimento logístico`
        : ""
    }.`;

  const fallbackMessage = `Olá! Revisamos ${
    enrichedOrders.length > 1
      ? `os seus pedidos (${enrichedOrders.map((o) => o.order_id).join(", ")})`
      : `o seu pedido ${enrichedOrders[0].order_id}`
  } e já liberamos a tratativa prioritária: ${finalDecisions
    .map(
      (d) =>
        `${d.order_id}: ${ACTION_LABELS[d.recommendedAction]}${
          d.targetCarrier && !d.targetCarrier.includes("Sem frete")
            ? ` via ${d.targetCarrier}`
            : ""
        }`
    )
    .join(" | ")}. Você receberá a atualização de acompanhamento ainda hoje.`;

  const responsePlan: PortfolioResolutionPlan = {
    customer_id: customer.customer_id,
    executiveSummary: submittedPlanArgs?.executiveSummary || fallbackSummary,
    consolidatePhysicalShipment: canConsolidateBox,
    consolidationExplanation: canConsolidateBox
      ? submittedPlanArgs?.consolidationExplanation ||
        `Envios unificados no ${firstOrder.cd} para ${firstOrder.cidade}/${firstOrder.uf}, economizando R$ ${freightConsolidationDiscount.toFixed(2)} em frete.`
      : submittedPlanArgs?.consolidationExplanation ||
        (enrichedOrders.length === 1
          ? "Pedido único na carteira."
          : "Atendimento unificado em contato único (envios em CDs ou modalidades distintas)."),
    totalProtectedRiskBRL,
    totalNetExecutionCostBRL,
    totalSavingsGeneratedBRL,
    totalCarrierClaimsBRL,
    decisions: finalDecisions,
    customerMessage: submittedPlanArgs?.customerMessage || fallbackMessage,
    modelUsed,
    toolTraces,
  };

  if (modelUsed !== "contingencia-operacional") {
    setCachedResponse(cacheKey, responsePlan);
  }

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
  const { anomaly, sampleOrders = [] } = body;
  const cacheKey = `containment:${anomaly.id}:${anomaly.affectedOrdersCount}`;
  const cached = getCachedResponse<SystemicContainmentPlan>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const SubmitContainmentSchema = z.object({
    title: z.string(),
    executiveDiagnosis: z.string(),
    ruleSummary: z.string(),
    blockedTarget: z.string(),
    redirectTarget: z.string(),
    technicalDispatchMessage: z.string(),
  });

  type SubmittedContainmentShape = z.infer<typeof SubmitContainmentSchema>;

  const buildImpactTrace = (step: number): AgentToolTrace => ({
    step,
    toolName: "quantifyAnomalyImpact",
    summary: `${anomaly.affectedOrdersCount} pedidos • Exposição R$ ${anomaly.financialExposureBRL.toFixed(
      2
    )} • Economia R$ ${anomaly.avoidableCostBRL.toFixed(2)}`,
    inputPreview: `anomaly=${anomaly.id}`,
    outputPreview: anomaly.concentrationMetric,
  });

  const buildRoutingTrace = (step: number): AgentToolTrace => ({
    step,
    toolName: "simulateContainmentRouting",
    summary: `Bloquear [${anomaly.targetEntity}] -> ativar [${anomaly.replacementTarget}]`,
    inputPreview: anomaly.targetEntity,
    outputPreview: anomaly.recommendedContainmentRule,
  });

  let toolTraces: AgentToolTrace[] = [];
  let submittedContainment: SubmittedContainmentShape | null = null;
  let fallbackText = "";
  let modelUsed = "contingencia-operacional";

  const groq = getGroqProvider();

  if (groq) {
    const llmResult = await runWithModelFallback(async (modelName) => {
      const attemptTraces: AgentToolTrace[] = [];
      let stepCounter = 0;

      const gen = await generateText({
        model: groq(modelName),
        temperature: 0.1,
        maxRetries: 0,
        maxSteps: 3,
        system: `Especialista de operações logísticas e industriais da Gogroup.
Passo 1: chame auditAnomaly.
Passo 2: chame submitContainmentOrder com valores exatos em R$ e instrução objetiva para CD/Logística/TI.`,
        prompt: `Gere ordem de contenção para "${anomaly.title}" (${anomaly.concentrationMetric}, exposição R$ ${anomaly.financialExposureBRL.toFixed(2)}).`,
        tools: {
          auditAnomaly: tool({
            description: "Quantifica volume afetado, economia e substituto operacional.",
            parameters: z.object({}),
            execute: async () => {
              attemptTraces.push(
                buildImpactTrace(++stepCounter),
                buildRoutingTrace(++stepCounter)
              );
              return {
                id: anomaly.id,
                area: anomaly.area,
                count: anomaly.affectedOrdersCount,
                metric: anomaly.concentrationMetric,
                exposureBRL: anomaly.financialExposureBRL,
                avoidableBRL: anomaly.avoidableCostBRL,
                blocked: anomaly.targetEntity,
                substitute: anomaly.replacementTarget,
                rule: anomaly.recommendedContainmentRule,
                samples: sampleOrders.slice(0, 4).map((s) => s.order_id),
              };
            },
          }),

          submitContainmentOrder: tool({
            description: "Registra a ordem de contenção final.",
            parameters: SubmitContainmentSchema,
          }),
        },
      });

      const submitCall = gen.steps
        .flatMap((s) => s.toolCalls)
        .find((tc) => tc.toolName === "submitContainmentOrder");

      let parsedOrder: SubmittedContainmentShape | null = null;
      if (submitCall) {
        const parsed = SubmitContainmentSchema.safeParse(submitCall.args);
        if (parsed.success) {
          parsedOrder = parsed.data;
          stepCounter++;
          attemptTraces.push({
            step: stepCounter,
            toolName: "submitContainmentOrder",
            summary: `Ordem emitida: ${parsedOrder.ruleSummary.slice(0, 110)}`,
            inputPreview: parsedOrder.blockedTarget,
            outputPreview: parsedOrder.redirectTarget,
          });
        }
      }

      return { gen, attemptTraces, parsedOrder };
    });

    if (llmResult) {
      modelUsed = llmResult.modelUsed;
      toolTraces = llmResult.output.attemptTraces;
      submittedContainment = llmResult.output.parsedOrder;
      fallbackText = llmResult.output.gen.text?.trim() || "";
    }
  }

  if (toolTraces.length === 0) {
    toolTraces = [
      buildImpactTrace(1),
      buildRoutingTrace(2),
      {
        step: 3,
        toolName: "submitContainmentOrder",
        summary: `Ordem calculada pelo motor operacional: ${anomaly.recommendedContainmentRule.slice(
          0,
          100
        )}`,
        inputPreview: anomaly.targetEntity,
        outputPreview: anomaly.replacementTarget,
      },
    ];
  }

  const plan: SystemicContainmentPlan = {
    anomalyId: anomaly.id,
    title: submittedContainment?.title || anomaly.title,
    executiveDiagnosis:
      submittedContainment?.executiveDiagnosis ||
      fallbackText ||
      anomaly.rootCauseEvidence,
    ruleSummary:
      submittedContainment?.ruleSummary || anomaly.recommendedContainmentRule,
    blockedTarget: submittedContainment?.blockedTarget || anomaly.targetEntity,
    redirectTarget:
      submittedContainment?.redirectTarget || anomaly.replacementTarget,
    technicalDispatchMessage:
      submittedContainment?.technicalDispatchMessage ||
      `[CONTENÇÃO IMEDIATA - ${anomaly.area}] Bloquear ${anomaly.targetEntity} e redirecionar fluxo para ${anomaly.replacementTarget}. Evidência: ${anomaly.concentrationMetric}.`,
    estimatedSavingsBRL: anomaly.avoidableCostBRL,
    modelUsed,
    toolTraces,
  };

  if (modelUsed !== "contingencia-operacional") {
    setCachedResponse(cacheKey, plan);
  }

  return NextResponse.json(plan);
}

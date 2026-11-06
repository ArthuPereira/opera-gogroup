import { NORTHEAST_CRITICAL_UFS, round2 } from "./business-rules";
import {
  ContainmentOrder,
  EnrichedOrder,
  SystemicAnomaly,
  SystemicAnomalyId,
} from "./types";

/**
 * Detector dinâmico das 6 Causas-Raiz Sistêmicas identificadas nos dados operacionais.
 * Recalcula automaticamente sobre os pedidos atuais do banco do usuário (incluindo uploads CSV).
 */
export function detectSystemicAnomalies(
  orders: EnrichedOrder[],
  containments: ContainmentOrder[] = []
): SystemicAnomaly[] {
  const activeContainmentIds = new Set<SystemicAnomalyId>(
    containments.filter((c) => c.active).map((c) => c.anomalyId)
  );

  // 1. Bug de Dias Corridos no Checkout
  const calendarBugOrders = orders.filter((o) => o.calendarBugDetected);
  const falseDelayOrders = orders.filter(
    (o) => o.autoTriageCategory === "auto_aviso_falso_atraso"
  );
  const calendarBugPct =
    orders.length > 0
      ? Math.round((calendarBugOrders.length / orders.length) * 100)
      : 0;
  const calendarBugExposure = round2(
    calendarBugOrders.reduce((acc, o) => acc + o.valor, 0)
  );
  const calendarBugAvoidable = round2(
    falseDelayOrders.length * 9.0 +
      falseDelayOrders.reduce((acc, o) => acc + o.valor * 0.04, 0)
  );

  // 2. Impressora IMP-02 (Gocase CD1)
  const allPersonalizationFailures = orders.filter(
    (o) => o.tipo_excecao === "falha_personalizacao"
  );
  const imp02Failures = allPersonalizationFailures.filter(
    (o) => o.maquina === "IMP-02"
  );
  const imp02Pct =
    allPersonalizationFailures.length > 0
      ? Math.round((imp02Failures.length / allPersonalizationFailures.length) * 100)
      : 0;
  const imp02Exposure = round2(imp02Failures.reduce((acc, o) => acc + o.valor, 0));
  const imp02Avoidable = round2(
    imp02Failures.reduce(
      (acc, o) => acc + o.economics.standardReshipCostBRL,
      0
    )
  );

  // 3. Picking CD2 Turno Noite + Brinde Promocional
  const allMissingItem = orders.filter((o) => o.tipo_excecao === "item_faltante");
  const cd2NightMissing = allMissingItem.filter(
    (o) => o.cd === "CD2" && o.turno === "noite"
  );
  const cd2NightBrinde = cd2NightMissing.filter((o) => o.brinde_no_pedido);
  const cd2NightPct =
    allMissingItem.length > 0
      ? Math.round((cd2NightMissing.length / allMissingItem.length) * 100)
      : 0;
  const cd2NightExposure = round2(
    cd2NightMissing.reduce((acc, o) => acc + o.valor, 0)
  );
  const cd2NightAvoidable = round2(
    cd2NightMissing.reduce(
      (acc, o) => acc + o.economics.currentCarrierFreightBRL + 9.0,
      0
    )
  );

  // 4. Lote Defeituoso L2607-B (Ápice APC-1067)
  const allLeaks = orders.filter((o) => o.tipo_excecao === "vazamento_produto");
  const loteBLeaks = allLeaks.filter((o) => o.lote_produto === "L2607-B");
  const loteBPct =
    allLeaks.length > 0
      ? Math.round((loteBLeaks.length / allLeaks.length) * 100)
      : 0;
  const loteBExposure = round2(loteBLeaks.reduce((acc, o) => acc + o.valor, 0));
  const loteBAvoidable = round2(
    loteBLeaks.reduce((acc, o) => acc + o.economics.standardReshipCostBRL + 9.0, 0)
  );

  // 5. Colapso da Rota Express no Nordeste (CE, PB, PE, BA, RN)
  const rotaNeOrders = orders.filter(
    (o) =>
      o.transportadora === "Rota Express" && NORTHEAST_CRITICAL_UFS.has(o.uf)
  );
  const allRotaOrders = orders.filter((o) => o.transportadora === "Rota Express");
  const rotaNePct =
    allRotaOrders.length > 0
      ? Math.round((rotaNeOrders.length / allRotaOrders.length) * 100)
      : 0;
  const rotaNeExposure = round2(rotaNeOrders.reduce((acc, o) => acc + o.valor, 0));
  // Diferença de frete p/ Veloz Log é R$ 3,22 vs perda esperada por atraso/extravio
  const rotaNeAvoidable = round2(
    rotaNeOrders.reduce((acc, o) => acc + o.directOrderRiskBRL, 0)
  );

  // 6. Avaria Carga Norte (Vidro Lescent) + Ruptura Crônica Kokeshi
  const allDamage = orders.filter((o) => o.tipo_excecao === "avaria_transporte");
  const cargaNorteDamage = allDamage.filter(
    (o) => o.transportadora === "Carga Norte"
  );
  const lescentDamage = cargaNorteDamage.filter((o) => o.marca === "Lescent");
  const kokeshiRupture = orders.filter(
    (o) =>
      o.tipo_excecao === "ruptura_pos_venda" &&
      o.marca === "Kokeshi" &&
      ["KSH-1010", "KSH-1011", "KSH-1009"].includes(o.sku)
  );
  const combined6Orders = [...cargaNorteDamage, ...kokeshiRupture];
  const damagePct =
    allDamage.length > 0
      ? Math.round((cargaNorteDamage.length / allDamage.length) * 100)
      : 0;
  const combined6Exposure = round2(
    combined6Orders.reduce((acc, o) => acc + o.valor, 0)
  );
  const combined6Avoidable = round2(
    cargaNorteDamage.reduce(
      (acc, o) => acc + o.economics.eligibleCarrierClaimBRL,
      0
    ) + kokeshiRupture.reduce((acc, o) => acc + o.valor * 0.76, 0)
  );

  return [
    {
      id: "rota_express_nordeste",
      title: "Colapso Malha Rota Express no Nordeste",
      subtitle: "CE, PB, PE, BA e RN concentram falhas graves de SLA e extravio",
      severity: "critica",
      area: "Malha Logística",
      affectedOrdersCount: rotaNeOrders.length,
      concentrationMetric: `${rotaNePct}% das ocorrências da Rota Express (${rotaNeOrders.length}/${allRotaOrders.length}) estão em 5 UFs do NE`,
      financialExposureBRL: rotaNeExposure,
      avoidableCostBRL: rotaNeAvoidable,
      rootCauseEvidence:
        "Rota Express promete 6 dias úteis por R$ 19,78 nas UFs CE/PB/PE/BA/RN, mas gera atraso sistêmico e paradas de rastreio. A Veloz Log entrega no mesmo SLA (6d úteis) por R$ 23,00 (+R$ 3,22/pedido).",
      recommendedContainmentRule:
        "Suspender cotação da Rota Express p/ CE, PB, PE, BA e RN no checkout e redirecionar reenvios automaticamente para Veloz Log.",
      targetEntity: "Rota Express (CE, PB, PE, BA, RN)",
      replacementTarget: "Veloz Log (SLA 6d úteis • R$ 23,00)",
      isContained: activeContainmentIds.has("rota_express_nordeste"),
    },
    {
      id: "cd2_noite_brinde",
      title: "Falha de Picking no CD2 — Turno da Noite (Brindes)",
      subtitle: "Omissão recorrente de itens/brindes promocionais na bancada noturna",
      severity: "critica",
      area: "Picking CD2",
      affectedOrdersCount: cd2NightMissing.length,
      concentrationMetric: `${cd2NightPct}% de todos os itens faltantes vêm do CD2 Noite (${cd2NightBrinde.length} com brinde promocional)`,
      financialExposureBRL: cd2NightExposure,
      avoidableCostBRL: cd2NightAvoidable,
      rootCauseEvidence:
        "Campanhas com brinde separado manualmente no turno da noite do CD2 não exigem bipagem do SKU promocional no fechamento, gerando reclamações caras de reenvio.",
      recommendedContainmentRule:
        "Travar fechamento de nota no WMS do CD2 Noite sem leitura de código de barras do brinde + priorizar Voucher Digital (Frete R$ 0) nos casos abertos.",
      targetEntity: "WMS Packing CD2 (Turno Noite)",
      replacementTarget: "Bipagem Obrigatória de Brinde + Voucher Instantâneo",
      isContained: activeContainmentIds.has("cd2_noite_brinde"),
    },
    {
      id: "imp_02_gocase",
      title: "Descalibração Crônica da Impressora IMP-02 (CD1)",
      subtitle: "Gocase personalizados saindo com falha de impressão em ~7x a média",
      severity: "critica",
      area: "Produção CD1",
      affectedOrdersCount: imp02Failures.length,
      concentrationMetric: `${imp02Pct}% das falhas de personalização (${imp02Failures.length}/${allPersonalizationFailures.length}) ocorrem na IMP-02 vs ~10-11 nas demais`,
      financialExposureBRL: imp02Exposure,
      avoidableCostBRL: imp02Avoidable,
      rootCauseEvidence:
        "Enquanto IMP-01 e IMP-03 a IMP-06 registram ~10–11 falhas cada, a IMP-02 sozinha gera 77 refugos. Reenviar sem bloquear a máquina faz a reimpressão cair novamente na IMP-02.",
      recommendedContainmentRule:
        "Interditar imediatamente fila de produção da IMP-02 para manutenção preventiva e redistribuir jobs do CD1 entre IMP-01 e IMP-03.",
      targetEntity: "Impressora UV IMP-02 (CD1)",
      replacementTarget: "Balanceamento IMP-01 + IMP-03 (CD1)",
      isContained: activeContainmentIds.has("imp_02_gocase"),
    },
    {
      id: "lote_l2607b_apice",
      title: "Vazamento Químico/Tampa no Lote L2607-B (Ápice APC-1067)",
      subtitle: "Defeito de envase concentrado em único lote e SKU no estoque",
      severity: "critica",
      area: "Qualidade / Estoque",
      affectedOrdersCount: loteBLeaks.length,
      concentrationMetric: `${loteBPct}% de todos os vazamentos da operação (${loteBLeaks.length}/${allLeaks.length}) pertencem ao Lote L2607-B`,
      financialExposureBRL: loteBExposure,
      avoidableCostBRL: loteBAvoidable,
      rootCauseEvidence:
        "O lote L2607-B (concentrado no SKU APC-1067 da marca Ápice) apresenta falha de vedação no transporte. Reenviar puxando a mesma posição de picking repete o vazamento.",
      recommendedContainmentRule:
        "Quarentena imediata do lote L2607-B no WMS (CD1 e CD2) para recall junto à fábrica e liberação de reenvios apenas de lotes auditados (L2608-A/C).",
      targetEntity: "Lote L2607-B (SKU APC-1067)",
      replacementTarget: "Lotes Íntegros L2608-A / L2608-C",
      isContained: activeContainmentIds.has("lote_l2607b_apice"),
    },
    {
      id: "carga_norte_lescent_kokeshi",
      title: "Avaria Carga Norte (Vidro Lescent) & Ruptura Kokeshi",
      subtitle: "Quebra física no transporte + venda sem estoque real nos SKUs KSH-1009/10/11",
      severity: "alta",
      area: "Embalagem & Catálogo",
      affectedOrdersCount: combined6Orders.length,
      concentrationMetric: `${damagePct}% das avarias na Carga Norte (${lescentDamage.length} em vidro Lescent) + ${kokeshiRupture.length} rupturas nos 3 SKUs Kokeshi`,
      financialExposureBRL: combined6Exposure,
      avoidableCostBRL: combined6Avoidable,
      rootCauseEvidence:
        "Frascos de vidro Lescent despachados via Carga Norte sofrem alto índice de quebra (passível de ressarcimento), enquanto KSH-1010/1011/1009 seguem vendendo sem saldo físico.",
      recommendedContainmentRule:
        "Bloquear Carga Norte p/ marca Lescent (migrar p/ Veloz Log c/ colmeia dupla + abrir lote de sinistros) e pausar venda de KSH-1009/1010/1011 no e-commerce.",
      targetEntity: "Carga Norte (Lescent) + SKUs KSH-1009/10/11",
      replacementTarget: "Veloz Log c/ Embalagem Dupla + Trava Estoque Segurança",
      isContained: activeContainmentIds.has("carga_norte_lescent_kokeshi"),
    },
    {
      id: "bug_dias_corridos",
      title: "Bug de Checkout: Prazo Prometido em Dias Corridos",
      subtitle: "Sistema soma SLA sem pular fins de semana e feriados (07/09)",
      severity: "alta",
      area: "TI / Checkout",
      affectedOrdersCount: calendarBugOrders.length,
      concentrationMetric: `${calendarBugPct}% da base (${calendarBugOrders.length} pedidos) recebeu data_prometida menor que 1d útil + SLA útil (${falseDelayOrders.length} falsos atrasos ativos)`,
      financialExposureBRL: calendarBugExposure,
      avoidableCostBRL: calendarBugAvoidable,
      rootCauseEvidence:
        "O checkout prometeu datas em dias corridos (ignorando sábados, domingos e 07/09/2026), abrindo tickets de atraso prematuros quando o pacote ainda está dentro do SLA contratado.",
      recommendedContainmentRule:
        "Hotfix no cálculo de checkout para calendário de dias úteis nacionais + supressão automática de tickets antes do realDueDate.",
      targetEntity: "Calculadora de Prazo Checkout (Dias Corridos)",
      replacementTarget: "Motor Calendário Útil (1d Separação + SLA Útil)",
      isContained: activeContainmentIds.has("bug_dias_corridos"),
    },
  ];
}

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  buildOrderRecordFromRaw,
  calculateFreightConsolidationSavings,
  checkTripleFreightLock,
  countBusinessDaysBetween,
  enrichOrderRecord,
  normalizeIsoDate,
} from "../business-rules";
import { parseOrdersCsv, serializeEnrichedOrdersCsv } from "../csv-io";
import { buildCustomerPortfolios, compareAiFirstVsFifo } from "../priority-engine";
import { detectSystemicAnomalies } from "../anomalies";
import { CarrierRoute, Customer, RawOrder } from "../types";

const seedPath = path.resolve(__dirname, "../../../.local-seed.json");
const hasLocalSeed = fs.existsSync(seedPath);

describe("Motor Determinístico Opera Gogroup", () => {
  it("calcula dias úteis pulando fins de semana e feriados nacionais (07/09 e 12/10)", () => {
    // Sexta-feira 2026-09-04 -> Sáb(05), Dom(06), Seg Feriado(07) -> Terça(08) é o dia útil 1!
    expect(addBusinessDays("2026-09-04", 1)).toBe("2026-09-08");
    // Mais 3 dias úteis de SLA: Qua(09), Qui(10), Sex(11) -> 2026-09-11
    expect(addBusinessDays("2026-09-04", 4)).toBe("2026-09-11");

    // Feriado 12/10/2026 (Segunda-feira): pedido na Sexta 09/10 -> 1 dia útil = Terça 13/10
    expect(addBusinessDays("2026-10-09", 1)).toBe("2026-10-13");

    // Contagem de atraso útil entre 2026-09-04 e 2026-09-10 (pula 05, 06 e feriado 07) = 3 dias úteis (08, 09, 10)
    expect(countBusinessDaysBetween("2026-09-04", "2026-09-10")).toBe(3);
  });

  it("valida a Trava Tripla de Consolidação de Frete (mesmo CD + mesma UF/cidade + reenvio físico)", () => {
    const carriersByUf = new Map<string, CarrierRoute[]>([
      [
        "CE",
        [
          {
            transportadora: "Veloz Log",
            uf_atendida: "CE",
            sla_contratado_dias_uteis: 6,
            custo_medio_frete: 23.0,
          },
        ],
      ],
    ]);
    const carrierMap = new Map<string, CarrierRoute>([
      ["Veloz Log|CE", carriersByUf.get("CE")![0]],
    ]);
    const baseRaw: RawOrder = {
      order_id: "GB1",
      customer_id: "CL1",
      marca: "Ápice",
      data_pedido: "2026-09-15",
      valor: 180,
      sku: "APC-1067",
      descricao_produto: "Máscara",
      qtd_itens: 1,
      brinde_no_pedido: false,
      tipo_excecao: "vazamento_produto",
      status: "aberta",
      transportadora: "Veloz Log",
      uf: "CE",
      cidade: "Fortaleza",
      data_prometida: "2026-09-20",
      data_entrega: "2026-09-21",
      maquina: null,
      turno: "manhã",
      cd: "CD1",
      lote_produto: "L2607-B",
      data_abertura_excecao: "2026-09-22",
    };

    const o1 = enrichOrderRecord(
      buildOrderRecordFromRaw(baseRaw, carrierMap),
      undefined,
      carriersByUf
    );
    const o2Same = enrichOrderRecord(
      buildOrderRecordFromRaw({ ...baseRaw, order_id: "GB2" }, carrierMap),
      undefined,
      carriersByUf
    );
    const o3DiffCd = enrichOrderRecord(
      buildOrderRecordFromRaw({ ...baseRaw, order_id: "GB3", cd: "CD2" }, carrierMap),
      undefined,
      carriersByUf
    );

    expect(checkTripleFreightLock([o1, o2Same])).toBe(true);
    expect(checkTripleFreightLock([o1, o3DiffCd])).toBe(false);
    // Com 2 pedidos no CD1 + 1 no CD2, consolida os 2 do CD1 (economiza R$ 23,00) e mantém CD2 separado
    expect(calculateFreightConsolidationSavings([o1, o3DiffCd])).toBe(0);
    expect(calculateFreightConsolidationSavings([o1, o2Same, o3DiffCd])).toBe(23);

    // Ao mudar um dos pedidos para ação digital (voucher_credito), desfaz a caixa única física
    expect(
      checkTripleFreightLock([o1, o2Same], { GB2: "voucher_credito" })
    ).toBe(false);
    expect(
      calculateFreightConsolidationSavings([o1, o2Same], {
        GB2: "voucher_credito",
      })
    ).toBe(0);
  });

  it("normaliza datas inválidas ou em formato BR no CSV sem estourar RangeError", () => {
    expect(normalizeIsoDate("25/09/2026")).toBe("2026-09-25");
    expect(normalizeIsoDate("2026-09-25T14:30:00Z")).toBe("2026-09-25");
    expect(normalizeIsoDate("2026-02-31", "2026-09-30")).toBe("2026-09-30");
    expect(addBusinessDays("invalido", 1)).toBe("2026-10-01");

    const parsed = parseOrdersCsv(
      "order_id,customer_id,valor,data_pedido,data_entrega\nPED-A,CL9,149.90,25/09/2026,\n"
    );
    expect(parsed[0].data_pedido).toBe("2026-09-25");
    expect(parsed[0].data_entrega).toBeNull();
  });

  it.skipIf(!hasLocalSeed)(
    "particiona sem sobreposição os 456 casos de Auto-Triagem (241 + 142 + 73) e valida os 61 pedidos reship > valor na base real",
    () => {
      const seed = JSON.parse(fs.readFileSync(seedPath, "utf8")) as {
        orders: RawOrder[];
        customers: Customer[];
        carriers: CarrierRoute[];
      };

      expect(seed.orders.length).toBe(2042);

      const carrierMap = new Map<string, CarrierRoute>();
      const carriersByUf = new Map<string, CarrierRoute[]>();
      for (const c of seed.carriers) {
        carrierMap.set(`${c.transportadora}|${c.uf_atendida}`, c);
        const list = carriersByUf.get(c.uf_atendida) ?? [];
        list.push(c);
        carriersByUf.set(c.uf_atendida, list);
      }

      const customerMap = new Map<string, Customer>();
      for (const c of seed.customers) {
        customerMap.set(c.customer_id, c);
      }

      const records = seed.orders.map((raw) =>
        buildOrderRecordFromRaw(raw, carrierMap, "seed")
      );
      const enriched = records.map((rec) =>
        enrichOrderRecord(rec, customerMap.get(rec.customer_id), carriersByUf)
      );

      const ruleA = enriched.filter(
        (o) => o.autoTriageCategory === "auto_encerrado_entregue"
      );
      const ruleB = enriched.filter(
        (o) => o.autoTriageCategory === "auto_cobranca_pix"
      );
      const ruleC = enriched.filter(
        (o) => o.autoTriageCategory === "auto_aviso_falso_atraso"
      );

      expect(ruleA.length).toBe(241);
      expect(ruleB.length).toBe(142);
      expect(ruleC.length).toBe(73);
      expect(ruleA.length + ruleB.length + ruleC.length).toBe(456);

      // 61 pedidos onde CMV (24%) + frete atual > valor pago
      const gtVal = enriched.filter((o) => o.economics.reshipExceedsOrderValue);
      expect(gtVal.length).toBe(61);

      // Devolvidos Gocase usam reexpedição sem novo CMV (0% CMV)
      const gocaseReturned = enriched.filter(
        (o) =>
          o.tipo_excecao === "devolvido_transportadora" && o.marca === "Gocase"
      );
      expect(gocaseReturned.length).toBe(65);
      expect(
        gocaseReturned.every(
          (o) => o.economics.recommendedOption.action === "reexpedicao_sem_cmv"
        )
      ).toBe(true);

      // Comparativo AI-First Top 150 Carteiras vs FIFO 150 mais antigos
      const portfolios = buildCustomerPortfolios(enriched, customerMap);
      const sim = compareAiFirstVsFifo(enriched, portfolios, 150);

      expect(sim.autoTriagedTotal).toBe(456);
      expect(sim.aiFirstOrdersUnlocked).toBeGreaterThan(250);
      expect(sim.fifoActiveOrdersUnlocked).toBeLessThan(150);
      expect(sim.aiFirstRiskProtectedBRL).toBeGreaterThan(
        sim.fifoRiskProtectedBRL * 2
      );

      // 6 anomalias sistêmicas detectadas
      const anomalies = detectSystemicAnomalies(enriched);
      expect(anomalies.length).toBe(6);

      // Exportação e re-importação CSV
      const subset = enriched.slice(0, 10);
      const csvOut = serializeEnrichedOrdersCsv(subset);
      expect(csvOut).toContain("prazo_real_dias_uteis");
      expect(csvOut).toContain("risco_financeiro_brl");
      const reimported = parseOrdersCsv(csvOut);
      expect(reimported.length).toBe(10);
      expect(reimported[0].order_id).toBe(subset[0].order_id);
    }
  );
});

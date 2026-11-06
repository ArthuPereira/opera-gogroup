import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import Papa from "papaparse";
import { CarrierRoute, Customer, RawOrder } from "@/lib/types";

export const dynamic = "force-dynamic";

interface SeedPayload {
  generatedAt: string;
  referenceDate: string;
  orders: RawOrder[];
  customers: Customer[];
  carriers: CarrierRoute[];
  sourceMode: "remote_gist" | "local_seed_file" | "local_csv_dir";
}

function parseCsvFile<T = Record<string, string>>(filePath: string): T[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse<T>(raw, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data;
}

export async function GET() {
  try {
    // 1. Produção Vercel: busca do GitHub Gist Secreto no servidor (sem expor a URL privada ao cliente)
    const remoteUrl = process.env.SEED_DATA_URL?.trim();
    if (remoteUrl) {
      const response = await fetch(remoteUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          `Falha ao buscar SEED_DATA_URL (HTTP ${response.status})`
        );
      }
      const data = await response.json();
      return NextResponse.json({
        ...data,
        sourceMode: "remote_gist",
      } satisfies SeedPayload);
    }

    // 2. Fallback rápido local (.local-seed.json gerado por npm run generate:seed)
    const localSeedJson = path.resolve(process.cwd(), ".local-seed.json");
    if (fs.existsSync(localSeedJson)) {
      const raw = fs.readFileSync(localSeedJson, "utf8");
      const data = JSON.parse(raw);
      return NextResponse.json({
        ...data,
        sourceMode: "local_seed_file",
      } satisfies SeedPayload);
    }

    // 3. Leitura direta de ../dados-csv/case_operacoes em desenvolvimento local
    const csvDir = path.resolve(process.cwd(), "../dados-csv/case_operacoes");
    if (fs.existsSync(csvDir)) {
      const ordersRaw = parseCsvFile<Record<string, string>>(
        path.join(csvDir, "pedidos_excecao.csv")
      );
      const customersRaw = parseCsvFile<Record<string, string>>(
        path.join(csvDir, "clientes.csv")
      );
      const carriersRaw = parseCsvFile<Record<string, string>>(
        path.join(csvDir, "transportadoras.csv")
      );

      const orders: RawOrder[] = ordersRaw.map((row) => ({
        order_id: String(row.order_id ?? "").trim(),
        customer_id: String(row.customer_id ?? "").trim(),
        marca: String(row.marca ?? "").trim(),
        data_pedido: String(row.data_pedido ?? "").trim(),
        valor: Number(row.valor ?? 0),
        sku: String(row.sku ?? "").trim(),
        descricao_produto: String(row.descricao_produto ?? "").trim(),
        qtd_itens: Number(row.qtd_itens ?? 1),
        brinde_no_pedido:
          String(row.brinde_no_pedido ?? "").toLowerCase() === "true",
        tipo_excecao: String(row.tipo_excecao ?? "atraso_entrega").trim() as RawOrder["tipo_excecao"],
        status: String(row.status ?? "").trim(),
        transportadora: String(row.transportadora ?? "").trim(),
        uf: String(row.uf ?? "").trim(),
        cidade: String(row.cidade ?? "").trim(),
        data_prometida: String(row.data_prometida ?? "").trim(),
        data_entrega: String(row.data_entrega ?? "").trim() || null,
        maquina: String(row.maquina ?? "").trim() || null,
        turno: String(row.turno ?? "").trim(),
        cd: String(row.cd ?? "").trim(),
        lote_produto: String(row.lote_produto ?? "").trim(),
        data_abertura_excecao: String(row.data_abertura_excecao ?? "").trim(),
      }));

      const customers: Customer[] = customersRaw.map((row) => ({
        customer_id: String(row.customer_id ?? "").trim(),
        n_pedidos: Number(row.n_pedidos ?? 1),
        receita_acumulada: Number(row.receita_acumulada ?? 0),
        data_primeiro_pedido: String(row.data_primeiro_pedido ?? "").trim(),
        n_contatos_atendimento: Number(row.n_contatos_atendimento ?? 0),
      }));

      const carriers: CarrierRoute[] = carriersRaw.map((row) => ({
        transportadora: String(row.transportadora ?? "").trim(),
        uf_atendida: String(row.uf_atendida ?? "").trim(),
        sla_contratado_dias_uteis: Number(row.sla_contratado_dias_uteis ?? 5),
        custo_medio_frete: Number(row.custo_medio_frete ?? 18),
      }));

      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        referenceDate: "2026-09-30",
        orders,
        customers,
        carriers,
        sourceMode: "local_csv_dir",
      } satisfies SeedPayload);
    }

    return NextResponse.json(
      {
        error:
          "Nenhuma fonte de seed configurada. Defina SEED_DATA_URL na Vercel ou disponibilize ../dados-csv/case_operacoes localmente.",
      },
      { status: 404 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro interno ao carregar seed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

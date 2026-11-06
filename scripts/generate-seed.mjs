import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const csvDir = path.resolve(rootDir, "../dados-csv/case_operacoes");
const outPath = path.resolve(rootDir, ".local-seed.json");

function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(raw, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data;
}

if (!fs.existsSync(csvDir)) {
  console.error(`❌ Diretório não encontrado: ${csvDir}`);
  process.exit(1);
}

const ordersRaw = parseCsvFile(path.join(csvDir, "pedidos_excecao.csv"));
const customersRaw = parseCsvFile(path.join(csvDir, "clientes.csv"));
const carriersRaw = parseCsvFile(path.join(csvDir, "transportadoras.csv"));

const orders = ordersRaw.map((row) => ({
  order_id: String(row.order_id ?? "").trim(),
  customer_id: String(row.customer_id ?? "").trim(),
  marca: String(row.marca ?? "").trim(),
  data_pedido: String(row.data_pedido ?? "").trim(),
  valor: Number(row.valor ?? 0),
  sku: String(row.sku ?? "").trim(),
  descricao_produto: String(row.descricao_produto ?? "").trim(),
  qtd_itens: Number(row.qtd_itens ?? 1),
  brinde_no_pedido:
    String(row.brinde_no_pedido ?? "").toLowerCase() === "true" ||
    row.brinde_no_pedido === true,
  tipo_excecao: String(row.tipo_excecao ?? "").trim(),
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

const customers = customersRaw.map((row) => ({
  customer_id: String(row.customer_id ?? "").trim(),
  n_pedidos: Number(row.n_pedidos ?? 1),
  receita_acumulada: Number(row.receita_acumulada ?? 0),
  data_primeiro_pedido: String(row.data_primeiro_pedido ?? "").trim(),
  n_contatos_atendimento: Number(row.n_contatos_atendimento ?? 0),
}));

const carriers = carriersRaw.map((row) => ({
  transportadora: String(row.transportadora ?? "").trim(),
  uf_atendida: String(row.uf_atendida ?? "").trim(),
  sla_contratado_dias_uteis: Number(row.sla_contratado_dias_uteis ?? 5),
  custo_medio_frete: Number(row.custo_medio_frete ?? 18),
}));

const payload = {
  generatedAt: new Date().toISOString(),
  referenceDate: "2026-09-30",
  orders,
  customers,
  carriers,
};

fs.writeFileSync(outPath, JSON.stringify(payload), "utf8");

console.log(`✅ .local-seed.json gerado com sucesso (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
console.log(`   - Pedidos: ${orders.length}`);
console.log(`   - Clientes: ${customers.length}`);
console.log(`   - Rotas de transportadoras: ${carriers.length}`);
console.log(`🔒 Arquivo ignorado pelo Git (.gitignore). Pronto para upload em GitHub Gist Secreto (SEED_DATA_URL).`);

# Opera Gogroup — Central AI-First de Exceções Operacionais

Plataforma **IPA (Intelligent Process Automation)** construída para transformar a gestão reativa de exceções operacionais de e-commerce (Gocase & GoBeauté) em uma central orientada por **R$ em Risco**, **Auto-Triagem Determinística Zero-Toque** e **Agente de IA Operacional com Tool Calling (Groq + Vercel AI SDK)**.

## Arquitetura da Solução

1. **Camada de Auto-Triagem Sem Fila Humana (Determinística & Auditável):**
   - **Regra A (`auto_encerrado_entregue`):** Exceções de atraso cujo pedido já consta entregue;
   - **Regra B (`auto_cobranca_pix`):** Pedidos com pagamento pendente (disparo automático de link Pix 24h + liberação de estoque + bloqueio de expedição inconsistente);
   - **Regra C (`auto_aviso_falso_atraso`):** Chamados abertos antes do prazo real contratado (`1 dia útil de separação + SLA útil da transportadora`, descontando fins de semana e feriados nacionais) devido ao cálculo legado em dias corridos.
   - Todas as ações automáticas ficam registradas na aba de governança com **reversão em 1 clique** para a fila humana.

2. **Motor de Priorização Financeira por Carteira (Top 150 Tratativas/Dia):**
   - Agrupa múltiplos pedidos abertos por `customer_id`, resolvendo toda a carteira num único atendimento;
   - Score em Reais: `Risco Direto do Pedido + Urgência Marginal de Mudança de Faixa (Cliff SLA) + LTV 12m em Risco (1x por cliente) + Economia de Contatos SAC`;
   - **Trava Tripla de Consolidação Física:** Só consolida reenvios na mesma caixa se `mesmo CD + mesma UF/cidade + >= 2 reenvios físicos`.

3. **Agente Operacional Groq (`POST /api/agent`):**
   - Executa `openai/gpt-oss-120b` na Groq (com cascata de fallback automático para `openai/gpt-oss-20b` e `qwen/qwen3.8-27b`) orquestrando *tools* determinísticas (`inspectPortfolioContext`, `checkRecurrenceAnomalies`, `simulateOptimalEconomics`, `submitResolutionPlan`);
   - Aplica travas anti-reincidência automáticas (bloqueio de máquina descalibrada, lote com falha de vedação, redirecionamento logístico regional, proteção de itens frágeis, reexpedição 0% CMV em itens personalizados e protocolo de ressarcimento contra transportadoras);
   - No **Radar Sistêmico**, emite **Ordens de Contenção Operacional** que passam a reger imediatamente as próximas decisões da fila.

4. **Workspace Isolado por Visitante (`IndexedDB` / `Dexie`):**
   - Cada avaliador interage em seu próprio banco no navegador (aprovações em 1 clique, ingestão manual com *presets*, upload de lote `.csv`, exportação `.csv` filtrada e botão de *Reset*).

---

## Como Rodar Localmente

```bash
npm install
cp .env.example .env # Preencha GROQ_KEY_API
npm run test         # Executa a suíte Vitest do motor matemático
npm run dev          # Inicia em http://localhost:3000
```

## Deploy Seguro (GitHub Público + Vercel)

Nenhum arquivo `.csv`, `.env` ou `.local-seed.json` é versionado no Git (`.gitignore` configurado):

1. Gere localmente o JSON de seed ignorado pelo Git:
   ```bash
   npm run generate:seed
   ```
2. Crie um **GitHub Gist Secreto** com o conteúdo de `.local-seed.json` e copie a URL **Raw**;
3. Na **Vercel**, configure as variáveis de ambiente:
   - `GROQ_KEY_API`: sua chave da Groq
   - `SEED_DATA_URL`: URL Raw do seu Gist Secreto

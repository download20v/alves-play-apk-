"use strict";
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { Pool } = require("pg");
const { createSupportRouter } = require("./support");
const { createBotAdminRouter } = require("./bot-admin");

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const providerUrl = process.env.BOT_PROVIDER_URL;
const providerKey = process.env.BOT_PROVIDER_API_KEY || "";
const renewalUrl = process.env.RENEW_URL || "";
const trialHours = Number(process.env.TRIAL_DURATION_HOURS || 4);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map(v => v.trim()).filter(Boolean);

if (!databaseUrl) throw new Error("DATABASE_URL não configurada");
if (providerUrl) {
  let parsedProvider;
  try { parsedProvider = new URL(providerUrl); } catch { throw new Error("BOT_PROVIDER_URL inválida"); }
  if (parsedProvider.protocol !== "https:") throw new Error("BOT_PROVIDER_URL deve usar HTTPS");
}
if (!Number.isFinite(trialHours) || trialHours <= 0 || trialHours > 720) throw new Error("TRIAL_DURATION_HOURS deve estar entre 0 e 720");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000
});

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origem não autorizada"));
  }
}));
app.use(express.json({ limit: "24kb" }));

app.get("/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true, service: "alves-play-api" }); }
  catch { res.status(503).json({ ok: false, error: "database_unavailable" }); }
});

// Atendimento cliente <-> administrador; rotas administrativas exigem SUPPORT_ADMIN_TOKEN.
app.use(createSupportRouter(pool));
app.use(createBotAdminRouter(pool));

app.post("/bot/test", async (req, res) => {
  const { app: appName, client_id: clientId, command = "chat", message = "" } = req.body || {};
  if (appName !== "ALVES PLAY") return res.status(400).json({ allowed: false, message: "Aplicativo inválido." });
  if (typeof clientId !== "string" || !/^[a-zA-Z0-9_-]{12,128}$/.test(clientId)) return res.status(400).json({ allowed: false, message: "Identificação do aparelho inválida." });
  if (typeof command !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(command)) return res.status(400).json({ allowed: false, message: "Comando inválido." });
  if (typeof message !== "string" || message.length > 4000) return res.status(400).json({ allowed: false, message: "Mensagem inválida ou muito longa." });

  if (!providerUrl) return res.status(503).json({ allowed: false, message: "O serviço do bot ainda está sendo configurado. Seu teste não foi iniciado." });

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO app_clients (app_name, client_id) VALUES ($1, $2) ON CONFLICT (app_name, client_id) DO NOTHING", ["ALVES PLAY", clientId]);
    const result = await db.query("SELECT trial_started_at, trial_ends_at FROM app_clients WHERE app_name = $1 AND client_id = $2 FOR UPDATE", ["ALVES PLAY", clientId]);
    let client = result.rows[0];

    if (!client.trial_started_at) {
      const started = await db.query(
        "UPDATE app_clients SET trial_started_at = NOW(), trial_ends_at = NOW() + ($3 * INTERVAL '1 hour'), updated_at = NOW() WHERE app_name = $1 AND client_id = $2 RETURNING trial_started_at, trial_ends_at",
        ["ALVES PLAY", clientId, trialHours]
      );
      client = started.rows[0];
    }

    if (new Date(client.trial_ends_at).getTime() <= Date.now()) {
      await db.query("COMMIT");
      return res.status(403).json({ allowed: false, used: true, message: "Seu período de teste já foi utilizado ou expirou. Renove para continuar.", renew_url: renewalUrl || undefined });
    }
    const upstream = await fetch(providerUrl, {
      signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: { "content-type": "application/json", ...(providerKey ? { authorization: `Bearer ${providerKey}` } : {}) },
      body: JSON.stringify({ app: appName, client_id: clientId, command, message })
    });
    if (!upstream.ok) {
      await db.query("ROLLBACK");
      return res.status(502).json({ allowed: false, message: "O bot está temporariamente indisponível. Seu teste não foi iniciado. Tente novamente." });
    }
    const payload = await upstream.json();
    const reply = typeof payload.reply === "string" ? payload.reply.slice(0, 12000) : "";
    if (!reply) {
      await db.query("ROLLBACK");
      return res.status(502).json({ allowed: false, message: "O provedor do bot retornou uma resposta inválida. Seu teste não foi iniciado." });
    }
    await db.query("COMMIT");
    return res.json({ allowed: true, reply, trial_ends_at: client.trial_ends_at, renew_url: renewalUrl || payload.renew_url || undefined });
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch {}
    console.error("bot_test_error", error.message);
    return res.status(500).json({ allowed: false, message: "Não foi possível processar sua solicitação." });
  } finally { db.release(); }
});

app.use((err, _req, res, _next) => {
  if (err.message === "Origem não autorizada") return res.status(403).json({ error: "origin_not_allowed" });
  return res.status(400).json({ error: "invalid_request" });
});
async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_clients (
      id BIGSERIAL PRIMARY KEY,
      app_name TEXT NOT NULL,
      client_id VARCHAR(128) NOT NULL,
      trial_started_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT app_clients_app_client_unique UNIQUE (app_name, client_id)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS app_clients_trial_ends_idx ON app_clients (trial_ends_at)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_mode TEXT NOT NULL DEFAULT 'sem_adulto' CHECK (active_mode IN ('sem_adulto','completo')),
      sem_adulto_url TEXT NOT NULL DEFAULT '',
      completo_url TEXT NOT NULL DEFAULT '',
      request_method TEXT NOT NULL DEFAULT 'POST' CHECK (request_method IN ('GET','POST')),
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_m3u_lists (
      id BIGSERIAL PRIMARY KEY,
      client_id VARCHAR(128) NOT NULL,
      client_name VARCHAR(120) NOT NULL,
      list_name VARCHAR(120) NOT NULL,
      m3u_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS client_m3u_lists_client_idx ON client_m3u_lists (client_id)");
  await pool.query(`INSERT INTO bot_settings(id,active_mode,sem_adulto_url,completo_url,request_method,enabled)
    VALUES(1,'sem_adulto',$1,$2,'POST',FALSE) ON CONFLICT(id) DO NOTHING`,
    ["https://painelblackbr.com/api/chatbot/KjLMarxL04/Yxl1jEBWMj","https://painelblackbr.com/api/chatbot/KjLMarxL04/b8K1x0K1vG"]);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_conversations (
      id BIGSERIAL PRIMARY KEY,
      app_name TEXT NOT NULL DEFAULT 'ALVES PLAY',
      client_id VARCHAR(128) NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT support_app_client_unique UNIQUE (app_name, client_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('client', 'admin')),
      message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS support_conversations_updated_idx ON support_conversations (updated_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS support_messages_conversation_idx ON support_messages (conversation_id, id)");
  app.listen(port, "0.0.0.0", () => console.log(`ALVES PLAY API ouvindo na porta ${port}`));
}
start().catch(error => {
  console.error("startup_error", error.message);
  process.exit(1);
});

"use strict";
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const providerUrl = process.env.BOT_PROVIDER_URL;
const providerKey = process.env.BOT_PROVIDER_API_KEY || "";
const renewalUrl = process.env.RENEW_URL || "";
const trialHours = Number(process.env.TRIAL_DURATION_HOURS || 4);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map(v => v.trim()).filter(Boolean);

if (!databaseUrl) throw new Error("DATABASE_URL não configurada");
if (!Number.isFinite(trialHours) || trialHours <= 0 || trialHours > 720) throw new Error("TRIAL_DURATION_HOURS deve estar entre 0 e 720");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000
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

app.post("/bot/test", async (req, res) => {
  const { app: appName, client_id: clientId, command = "chat", message = "" } = req.body || {};
  if (appName !== "ALVES PLAY") return res.status(400).json({ allowed: false, message: "Aplicativo inválido." });
  if (typeof clientId !== "string" || !/^[a-zA-Z0-9_-]{12,128}$/.test(clientId)) return res.status(400).json({ allowed: false, message: "Identificação do aparelho inválida." });
  if (typeof message !== "string" || message.length > 4000) return res.status(400).json({ allowed: false, message: "Mensagem inválida ou muito longa." });

  // Não iniciar/consumir o teste antes da configuração do provedor.
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
app.listen(port, "0.0.0.0", () => console.log(`ALVES PLAY API ouvindo na porta ${port}`));

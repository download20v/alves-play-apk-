"use strict";
const crypto = require("node:crypto");
const express = require("express");

function createSupportRouter(pool) {
  const router = express.Router();
  const adminToken = process.env.SUPPORT_ADMIN_TOKEN || "";

  function validClientId(value) {
    return typeof value === "string" && /^[a-zA-Z0-9_-]{12,128}$/.test(value);
  }
  function adminOnly(req, res, next) {
    if (!adminToken) return res.status(503).json({ error: "admin_support_not_configured" });
    const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(supplied);
    const b = Buffer.from(adminToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  }
  async function ensureConversation(clientId) {
    await pool.query(
      "INSERT INTO app_clients (app_name, client_id) VALUES ('ALVES PLAY', $1) ON CONFLICT (app_name, client_id) DO NOTHING",
      [clientId]
    );
    const result = await pool.query(
      `INSERT INTO support_conversations (app_name, client_id)
       VALUES ('ALVES PLAY', $1)
       ON CONFLICT (app_name, client_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, status, created_at, updated_at`,
      [clientId]
    );
    return result.rows[0];
  }
  router.post("/support/messages", async (req, res) => {
    const { client_id: clientId, message } = req.body || {};
    if (!validClientId(clientId)) return res.status(400).json({ error: "invalid_device_id" });
    if (typeof message !== "string" || !message.trim() || message.trim().length > 4000) {
      return res.status(400).json({ error: "invalid_message", message: "A mensagem deve ter entre 1 e 4000 caracteres." });
    }
    try {
      const conversation = await ensureConversation(clientId);
      const saved = await pool.query(
        `INSERT INTO support_messages (conversation_id, sender, message)
         VALUES ($1, 'client', $2)
         RETURNING id, sender, message, created_at, read_at`,
        [conversation.id, message.trim()]
      );
      await pool.query(
        "UPDATE support_conversations SET status = 'open', updated_at = NOW() WHERE id = $1",
        [conversation.id]
      );
      return res.status(201).json({ ok: true, conversation_id: conversation.id, message: saved.rows[0] });
    } catch (error) {
      console.error("support_client_send_error", error.message);
      return res.status(500).json({ error: "support_unavailable" });
    }
  });
  router.get("/support/messages", async (req, res) => {
    const clientId = req.query.client_id;
    if (!validClientId(clientId)) return res.status(400).json({ error: "invalid_device_id" });
    try {
      const conversation = await pool.query(
        "SELECT id, status FROM support_conversations WHERE app_name = 'ALVES PLAY' AND client_id = $1",
        [clientId]
      );
      if (!conversation.rowCount) return res.json({ conversation_id: null, status: "new", messages: [] });
      const id = conversation.rows[0].id;
      const messages = await pool.query(
        `SELECT id, sender, message, created_at, read_at FROM support_messages
         WHERE conversation_id = $1 ORDER BY id ASC LIMIT 300`,
        [id]
      );
      await pool.query(
        "UPDATE support_messages SET read_at = NOW() WHERE conversation_id = $1 AND sender = 'admin' AND read_at IS NULL",
        [id]
      );
      return res.json({ conversation_id: id, status: conversation.rows[0].status, messages: messages.rows });
    } catch (error) {
      console.error("support_client_read_error", error.message);
      return res.status(500).json({ error: "support_unavailable" });
    }
  });
  router.get("/admin/support/conversations", adminOnly, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT c.id, c.client_id, c.status, c.created_at, c.updated_at,
          (SELECT message FROM support_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
          (SELECT sender FROM support_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
          (SELECT COUNT(*)::int FROM support_messages m WHERE m.conversation_id = c.id AND m.sender = 'client' AND m.read_at IS NULL) AS unread_client
         FROM support_conversations c WHERE c.app_name = 'ALVES PLAY'
         ORDER BY c.updated_at DESC LIMIT 500`
      );
      return res.json({ conversations: result.rows });
    } catch (error) {
      console.error("support_admin_list_error", error.message);
      return res.status(500).json({ error: "support_unavailable" });
    }
  });
  router.get("/admin/support/conversations/:id/messages", adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_conversation_id" });
    try {
      const exists = await pool.query("SELECT id, client_id, status FROM support_conversations WHERE id = $1", [id]);
      if (!exists.rowCount) return res.status(404).json({ error: "conversation_not_found" });
      const messages = await pool.query(
        "SELECT id, sender, message, created_at, read_at FROM support_messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT 500",
        [id]
      );
      await pool.query(
        "UPDATE support_messages SET read_at = NOW() WHERE conversation_id = $1 AND sender = 'client' AND read_at IS NULL",
        [id]
      );
      return res.json({ conversation: exists.rows[0], messages: messages.rows });
    } catch (error) {
      console.error("support_admin_read_error", error.message);
      return res.status(500).json({ error: "support_unavailable" });
    }
  });
  router.post("/admin/support/conversations/:id/messages", adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const { message } = req.body || {};
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_conversation_id" });
    if (typeof message !== "string" || !message.trim() || message.trim().length > 4000) {
      return res.status(400).json({ error: "invalid_message" });
    }
    try {
      const exists = await pool.query("SELECT id FROM support_conversations WHERE id = $1", [id]);
      if (!exists.rowCount) return res.status(404).json({ error: "conversation_not_found" });
      const saved = await pool.query(
        "INSERT INTO support_messages (conversation_id, sender, message) VALUES ($1, 'admin', $2) RETURNING id, sender, message, created_at, read_at",
        [id, message.trim()]
      );
      await pool.query("UPDATE support_conversations SET status = 'open', updated_at = NOW() WHERE id = $1", [id]);
      return res.status(201).json({ ok: true, message: saved.rows[0] });
    } catch (error) {
      console.error("support_admin_send_error", error.message);
      return res.status(500).json({ error: "support_unavailable" });
    }
  });
  router.patch("/admin/support/conversations/:id", adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_conversation_id" });
    if (!["open", "closed"].includes(status)) return res.status(400).json({ error: "invalid_status" });
    try {
      const result = await pool.query(
        "UPDATE support_conversations SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id, client_id, status, updated_at",
        [id, status]
      );
      if (!result.rowCount) return res.status(404).json({ error: "conversation_not_found" });
      return res.json({ ok: true, conversation: result.rows[0] });
    } catch (error) {
      console.error("support_admin_status_error", error.message);
      return res.status(500).json({ error: "support_unavailable" });
    }
  });
  return router;
}
module.exports = { createSupportRouter };

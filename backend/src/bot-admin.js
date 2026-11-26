"use strict";
const crypto = require("node:crypto");
const express = require("express");

function createBotAdminRouter(pool) {
  const router = express.Router();
  const token = process.env.SUPPORT_ADMIN_TOKEN || "";
  function adminOnly(req,res,next) {
    if (!token) return res.status(503).json({error:"admin_token_not_configured"});
    const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    const a=Buffer.from(supplied), b=Buffer.from(token);
    if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({error:"unauthorized"});
    next();
  }
  const validId=v=>typeof v==="string" && /^[a-zA-Z0-9_-]{12,128}$/.test(v);
  const validHttps=v=>typeof v==="string" && v.length<=2048 && (()=>{try{return new URL(v).protocol==="https:"}catch{return false}})();

  router.get("/admin/bot/config",adminOnly,async(_req,res)=>{
    try {
      const r=await pool.query("SELECT active_mode, sem_adulto_url, completo_url, request_method, enabled, updated_at FROM bot_settings WHERE id=1");
      res.json({config:r.rows[0]||{active_mode:"sem_adulto",sem_adulto_url:"",completo_url:"",request_method:"POST",enabled:false}});
    } catch(e){console.error("bot_config_read",e.message);res.status(500).json({error:"database_error"});}
  });
  router.put("/admin/bot/config",adminOnly,async(req,res)=>{
    const {active_mode,sem_adulto_url,completo_url,request_method,enabled}=req.body||{};
    if(!["sem_adulto","completo"].includes(active_mode)) return res.status(400).json({error:"invalid_active_mode"});
    if(!validHttps(sem_adulto_url)||!validHttps(completo_url)) return res.status(400).json({error:"bot_urls_must_be_https"});
    if(!["GET","POST"].includes(request_method)) return res.status(400).json({error:"invalid_request_method"});
    if(typeof enabled!=="boolean") return res.status(400).json({error:"invalid_enabled"});
    try{
      const r=await pool.query(`INSERT INTO bot_settings(id,active_mode,sem_adulto_url,completo_url,request_method,enabled,updated_at)
        VALUES(1,$1,$2,$3,$4,$5,NOW()) ON CONFLICT(id) DO UPDATE SET active_mode=EXCLUDED.active_mode,
        sem_adulto_url=EXCLUDED.sem_adulto_url,completo_url=EXCLUDED.completo_url,request_method=EXCLUDED.request_method,
        enabled=EXCLUDED.enabled,updated_at=NOW()
        RETURNING active_mode,sem_adulto_url,completo_url,request_method,enabled,updated_at`,
      [active_mode,sem_adulto_url,completo_url,request_method,enabled]);
      res.json({ok:true,config:r.rows[0]});
    }catch(e){console.error("bot_config_save",e.message);res.status(500).json({error:"database_error"});}
  });
  router.get("/admin/client-lists",adminOnly,async(req,res)=>{
    const q=String(req.query.q||"").slice(0,128);
    try{
      const r=await pool.query(`SELECT id,client_id,client_name,list_name,m3u_url,created_at,updated_at
        FROM client_m3u_lists WHERE ($1='' OR client_id ILIKE '%'||$1||'%' OR client_name ILIKE '%'||$1||'%')
        ORDER BY updated_at DESC LIMIT 500`,[q]);
      res.json({lists:r.rows});
    }catch(e){console.error("client_lists_read",e.message);res.status(500).json({error:"database_error"});}
  });
  router.post("/admin/client-lists",adminOnly,async(req,res)=>{
    const {client_id,client_name,list_name,m3u_url}=req.body||{};
    if(!validId(client_id)||typeof client_name!=="string"||!client_name.trim()||client_name.length>120||
       typeof list_name!=="string"||!list_name.trim()||list_name.length>120||!validHttps(m3u_url))
      return res.status(400).json({error:"invalid_client_list"});
    try{
      const r=await pool.query(`INSERT INTO client_m3u_lists(client_id,client_name,list_name,m3u_url)
        VALUES($1,$2,$3,$4) RETURNING id,client_id,client_name,list_name,m3u_url,created_at,updated_at`,
      [client_id,client_name.trim(),list_name.trim(),m3u_url]);
      res.status(201).json({ok:true,list:r.rows[0]});
    }catch(e){console.error("client_list_create",e.message);res.status(500).json({error:"database_error"});}
  });
  router.put("/admin/client-lists/:id",adminOnly,async(req,res)=>{
    const id=Number(req.params.id),{client_id,client_name,list_name,m3u_url}=req.body||{};
    if(!Number.isSafeInteger(id)||id<=0||!validId(client_id)||typeof client_name!=="string"||!client_name.trim()||client_name.length>120||
       typeof list_name!=="string"||!list_name.trim()||list_name.length>120||!validHttps(m3u_url))
      return res.status(400).json({error:"invalid_client_list"});
    try{
      const r=await pool.query(`UPDATE client_m3u_lists SET client_id=$2,client_name=$3,list_name=$4,m3u_url=$5,updated_at=NOW()
        WHERE id=$1 RETURNING id,client_id,client_name,list_name,m3u_url,created_at,updated_at`,
      [id,client_id,client_name.trim(),list_name.trim(),m3u_url]);
      if(!r.rowCount)return res.status(404).json({error:"list_not_found"});
      res.json({ok:true,list:r.rows[0]});
    }catch(e){console.error("client_list_update",e.message);res.status(500).json({error:"database_error"});}
  });
  router.delete("/admin/client-lists/:id",adminOnly,async(req,res)=>{
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"invalid_id"});
    try{
      const r=await pool.query("DELETE FROM client_m3u_lists WHERE id=$1 RETURNING id",[id]);
      if(!r.rowCount)return res.status(404).json({error:"list_not_found"});
      res.json({ok:true,deleted_id:r.rows[0].id});
    }catch(e){console.error("client_list_delete",e.message);res.status(500).json({error:"database_error"});}
  });
  return router;
}
module.exports={createBotAdminRouter};

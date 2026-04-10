// api/hubproxy.js — Hub Crédito API proxy
const https = require("https");

const HUB_BASE  = "api.hubcredito.com.br";

function httpsRequest(hostname, path, method, headers, bodyData) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method, headers };
    const req  = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end",  () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Timeout 30s")));
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function extractMsg(j) {
  if (Array.isArray(j?.errors) && j.errors.length) return j.errors.join("; ");
  if (typeof j?.message === "string" && j.message) return j.message;
  if (typeof j?.error   === "string" && j.error)   return j.error;
  try { return JSON.stringify(j).slice(0, 300); } catch { return "Erro desconhecido"; }
}

function tryParse(body, status) {
  try { return { ok: true, data: JSON.parse(body) }; }
  catch {
    return { ok: false, hint: body.trim().startsWith("<")
      ? `API retornou HTML (status ${status}). Credenciais inválidas ou IP bloqueado.`
      : `Resposta não-JSON (status ${status}).`, preview: body.slice(0,400) };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { action, userName, password, path, method, token, body } = req.body || {};

  // ── Auth ─────────────────────────────────────────────────────
  if (action === "auth") {
    if (!userName || !password)
      return res.status(400).json({ error: "userName e password obrigatórios." });
    try {
      const payload = JSON.stringify({ userName, password, grantTypes: "password" });
      const hdrs = {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent":     "NexpConsultas/2.0",
      };
      const r      = await httpsRequest(HUB_BASE, "/api/Login", "POST", hdrs, payload);
      const parsed = tryParse(r.body, r.status);
      if (!parsed.ok) return res.status(502).json({ error: parsed.hint, preview: parsed.preview });
      if (r.status >= 400 || parsed.data.hasError)
        return res.status(r.status||400).json({ error: extractMsg(parsed.data), hasError: true, errors: parsed.data.errors||[] });
      return res.status(200).json(parsed.data);
    } catch(e) { return res.status(500).json({ error: "Erro de rede: " + e.message }); }
  }

  // ── BFF ──────────────────────────────────────────────────────
  if (action === "bff") {
    if (!token) return res.status(400).json({ error: "token obrigatório." });
    if (!path)  return res.status(400).json({ error: "path obrigatório." });
    try {
      const bodyStr   = body ? JSON.stringify(body) : null;
      const reqMethod = (method || "GET").toUpperCase();
      const hdrs      = {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
        "User-Agent":    "NexpConsultas/2.0",
      };
      if (bodyStr) hdrs["Content-Length"] = Buffer.byteLength(bodyStr);

      // Support different base hosts
      const baseHost = (req.body.base||"").replace("https://","").split("/")[0] || HUB_BASE;
      const apiPath  = "/api" + (path.startsWith("/api") ? path.slice(4) : path);

      const r      = await httpsRequest(baseHost, apiPath, reqMethod, hdrs, bodyStr);
      const parsed = tryParse(r.body, r.status);
      if (!parsed.ok) return res.status(502).json({ error: parsed.hint, preview: parsed.preview });
      if (r.status >= 400 || parsed.data?.hasError)
        return res.status(r.status||400).json({ error: extractMsg(parsed.data), hasError: true, errors: parsed.data?.errors||[] });
      return res.status(200).json(parsed.data);
    } catch(e) { return res.status(500).json({ error: "Erro de rede: " + e.message }); }
  }

  return res.status(400).json({ error: `action inválida: "${action}"` });
};

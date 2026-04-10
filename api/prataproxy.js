// api/prataproxy.js
const https = require("https");

const PRATA_BASE = "api.bancoprata.com.br";

function httpsRequest(path, method, headers, bodyData) {
  return new Promise((resolve, reject) => {
    const options = { hostname: PRATA_BASE, path, method, headers };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
        contentType: res.headers["content-type"] || "",
      }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("Timeout 30s")); });
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function parseOrRaw(body, status, contentType) {
  try { return { ok: true, data: JSON.parse(body) }; }
  catch {
    const preview = body.slice(0, 400);
    let hint = body.trim().startsWith("<")
      ? "A API retornou HTML. Causas prováveis: (1) x-prata-client inválido/ausente, (2) IP bloqueado, (3) endpoint incorreto."
      : status === 401 ? "Credenciais inválidas (email/senha incorretos)."
      : status === 403 ? "Acesso negado. Verifique o x-prata-client e permissões da conta parceiro."
      : `Status ${status} — resposta não é JSON.`;
    return { ok: false, hint, preview, contentType, status };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { action, email, password, prataClient, path, method, token, body } = req.body || {};

  // ── Auth ─────────────────────────────────────────────────────
  if (action === "auth") {
    if (!email || !password)
      return res.status(400).json({ error: "email e password obrigatórios." });
    if (!prataClient)
      return res.status(400).json({ error: "x-prata-client não informado. Configure nas credenciais Prata Digital." });
    try {
      const payload = JSON.stringify({ email, password });
      const headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-prata-client": prataClient,
        "User-Agent": "NexpConsultas/1.0",
      };
      const r = await httpsRequest("/v1/users/login", "POST", headers, payload);
      const parsed = parseOrRaw(r.body, r.status, r.contentType);
      if (!parsed.ok) {
        return res.status(502).json({
          error: parsed.hint,
          diagnostico: { httpStatus: r.status, contentType: r.contentType, respostaPreview: parsed.preview,
            dica: "Verifique: e-mail/senha corretos, x-prata-client correto, conta parceiro ativa na Prata Digital." }
        });
      }
      if (r.status >= 400) {
        const msg = parsed.data?.message || parsed.data?.error ||
          (Array.isArray(parsed.data?.errors) ? parsed.data.errors.map(e=>e.message||e).join("; ") : null) ||
          `Erro ${r.status}`;
        return res.status(r.status).json({ error: msg, raw: parsed.data });
      }
      return res.status(200).json(parsed.data);
    } catch(e) { return res.status(500).json({ error: "Erro de rede: " + e.message }); }
  }

  // ── BFF ──────────────────────────────────────────────────────
  if (action === "bff") {
    if (!token)       return res.status(400).json({ error: "token obrigatório." });
    if (!path)        return res.status(400).json({ error: "path obrigatório." });
    if (!prataClient) return res.status(400).json({ error: "x-prata-client obrigatório." });
    try {
      const bodyStr   = body ? JSON.stringify(body) : null;
      const reqMethod = (method || "GET").toUpperCase();
      const headers   = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-prata-client": prataClient,
        "User-Agent": "NexpConsultas/1.0",
      };
      if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);
      const r = await httpsRequest(path, reqMethod, headers, bodyStr);
      const parsed = parseOrRaw(r.body, r.status, r.contentType);
      if (!parsed.ok) {
        return res.status(502).json({
          error: parsed.hint,
          diagnostico: { path, method: reqMethod, httpStatus: r.status, contentType: r.contentType, respostaPreview: parsed.preview }
        });
      }
      if (r.status >= 400) {
        const msg = parsed.data?.message || parsed.data?.error ||
          (Array.isArray(parsed.data?.errors) ? parsed.data.errors.map(e=>e.message||e).join("; ") : null) ||
          `Erro ${r.status}`;
        return res.status(r.status).json({ error: msg, raw: parsed.data });
      }
      return res.status(200).json(parsed.data);
    } catch(e) { return res.status(500).json({ error: "Erro de rede: " + e.message }); }
  }

  return res.status(400).json({ error: `action inválida: "${action}"` });
};

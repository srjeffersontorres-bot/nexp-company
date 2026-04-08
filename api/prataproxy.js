// api/prataproxy.js
// Proxy Vercel para Prata Digital API — sintaxe CommonJS (igual ao v8proxy.js)
const https = require("https");

const PRATA_BASE = "https://api.bancoprata.com.br";

async function fetchJson(url, options, bodyData) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = https.request(reqOptions, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on("error", reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, email, password, path, method, token, body } = req.body || {};

  // ── Autenticação ────────────────────────────────────────────
  if (action === "auth") {
    if (!email || !password)
      return res.status(400).json({ error: "email e password obrigatórios." });
    try {
      const payload = JSON.stringify({ email, password });
      const r = await fetchJson(`${PRATA_BASE}/v1/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, payload);
      let data;
      try { data = JSON.parse(r.body); } catch { return res.status(500).json({ error: "Resposta inválida da API Prata." }); }
      return res.status(r.status).json(data);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Chamadas autenticadas ───────────────────────────────────
  if (action === "bff") {
    if (!token || !path)
      return res.status(400).json({ error: "token e path obrigatórios." });
    try {
      const bodyStr = body ? JSON.stringify(body) : null;
      const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);
      const r = await fetchJson(`${PRATA_BASE}${path}`, {
        method: method || "GET",
        headers,
      }, bodyStr);
      let data;
      try { data = JSON.parse(r.body); } catch { return res.status(500).json({ error: "Resposta inválida da API Prata." }); }
      return res.status(r.status).json(data);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "action inválida." });
};

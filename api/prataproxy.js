// api/prataproxy.js — CommonJS (igual ao v8proxy.js)
const https = require("https");

const PRATA_BASE = "api.bancoprata.com.br";

function httpsRequest(path, method, headers, bodyData) {
  return new Promise((resolve, reject) => {
    const options = { hostname: PRATA_BASE, path, method, headers };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
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

  const { action, email, password, prataClient, path, method, token, body } = req.body || {};

  // ── Autenticação ────────────────────────────────────────────
  if (action === "auth") {
    if (!email || !password)
      return res.status(400).json({ error: "email e password obrigatórios." });
    try {
      const payload = JSON.stringify({ email, password });
      const headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      };
      if (prataClient) headers["x-prata-client"] = prataClient;

      const r = await httpsRequest("/v1/users/login", "POST", headers, payload);
      let data;
      try { data = JSON.parse(r.body); }
      catch { return res.status(500).json({ error: "API Prata retornou resposta inválida.", raw: r.body.slice(0,200) }); }
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
      if (prataClient) headers["x-prata-client"] = prataClient;
      if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);

      const r = await httpsRequest(path, method || "GET", headers, bodyStr);
      let data;
      try { data = JSON.parse(r.body); }
      catch { return res.status(500).json({ error: "API Prata retornou resposta inválida.", raw: r.body.slice(0,200) }); }
      return res.status(r.status).json(data);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "action inválida." });
};

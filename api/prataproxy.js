// api/prataproxy.js  — coloque em: /api/prataproxy.js no seu projeto
// Proxy Vercel para a Prata Digital API (api.bancoprata.com.br)
// Resolve CORS e mantém as credenciais seguras no servidor.

const PRATA_BASE = "https://api.bancoprata.com.br";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const { action, email, password, prataClient, path, method, token, body } = req.body || {};

  // ── 1. Autenticação ──────────────────────────────────────────
  if (action === "auth") {
    if (!email || !password || !prataClient)
      return res.status(400).json({ error: "email, password e prataClient são obrigatórios." });
    try {
      const r = await fetch(`${PRATA_BASE}/v1/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-prata-client": prataClient },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 2. Chamadas autenticadas (BFF) ───────────────────────────
  if (action === "bff") {
    if (!token || !path)
      return res.status(400).json({ error: "token e path são obrigatórios." });

    const url     = `${PRATA_BASE}${path}`;
    const headers = {
      "Authorization":  `Bearer ${token}`,
      "x-prata-client": prataClient || "",
      "Content-Type":   "application/json",
    };

    try {
      const fetchOpts = { method: method || "GET", headers };
      if (body && method !== "GET") fetchOpts.body = JSON.stringify(body);

      const r    = await fetch(url, fetchOpts);
      const data = await r.json();
      return res.status(r.ok ? 200 : r.status).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "action inválida." });
}

// api/prataproxy.js
// Defina PRATA_CLIENT nas Environment Variables do Vercel
const https = require("https");

const PRATA_BASE   = "api.bancoprata.com.br";
const PRATA_CLIENT = process.env.PRATA_CLIENT || ""; // Vercel env var

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
    req.setTimeout(30000, () => req.destroy(new Error("Timeout 30s")));
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function extractMsg(j) {
  if (j?.error?.message) return j.error.message;
  if (typeof j?.message === "string") return j.message;
  if (typeof j?.error   === "string") return j.error;
  if (Array.isArray(j?.errors))
    return j.errors.map(x => x?.message || x?.detail || JSON.stringify(x)).join("; ");
  try { return JSON.stringify(j).slice(0, 300); } catch { return "Erro desconhecido"; }
}

function parseBody(body, status) {
  try { return { ok: true, data: JSON.parse(body) }; }
  catch {
    const preview = body.slice(0, 400);
    const hint = body.trim().startsWith("<")
      ? `A API Prata retornou HTML (não JSON). Status ${status}. Possível causa: x-prata-client inválido ou acesso não liberado.`
      : `Resposta não-JSON da API. Status ${status}.`;
    return { ok: false, hint, preview };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { action, email, password, path, method, token, body } = req.body || {};
  // Usa o x-prata-client do request, ou fallback da env var
  const prataClient = req.body?.prataClient || PRATA_CLIENT;

  // ── Auth ─────────────────────────────────────────────────────
  if (action === "auth") {
    if (!email || !password)
      return res.status(400).json({ error: "email e password obrigatórios." });
    if (!prataClient)
      return res.status(400).json({ error: "x-prata-client não informado. Configure a variável PRATA_CLIENT no Vercel." });

    try {
      const payload = JSON.stringify({ email, password });
      const hdrs = {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-prata-client": prataClient,
        "User-Agent":     "NexpConsultas/2.0",
      };
      const r      = await httpsRequest("/v1/users/login", "POST", hdrs, payload);
      const parsed = parseBody(r.body, r.status);

      if (!parsed.ok)
        return res.status(502).json({ error: parsed.hint, respostaRaw: parsed.preview });

      if (r.status >= 400)
        return res.status(r.status).json({ error: extractMsg(parsed.data), raw: parsed.data });

      return res.status(200).json(parsed.data);
    } catch(e) {
      return res.status(500).json({ error: "Erro de rede: " + e.message });
    }
  }

  // ── BFF ──────────────────────────────────────────────────────
  if (action === "bff") {
    if (!token)       return res.status(400).json({ error: "token obrigatório." });
    if (!path)        return res.status(400).json({ error: "path obrigatório." });
    if (!prataClient) return res.status(400).json({ error: "x-prata-client não informado." });

    try {
      const bodyStr   = body ? JSON.stringify(body) : null;
      const reqMethod = (method || "GET").toUpperCase();
      const hdrs      = {
        "Authorization":  `Bearer ${token}`,
        "Content-Type":   "application/json",
        "x-prata-client": prataClient,
        "User-Agent":     "NexpConsultas/2.0",
      };
      if (bodyStr) hdrs["Content-Length"] = Buffer.byteLength(bodyStr);

      const r      = await httpsRequest(path, reqMethod, hdrs, bodyStr);
      const parsed = parseBody(r.body, r.status);

      if (!parsed.ok)
        return res.status(502).json({ error: parsed.hint, respostaRaw: parsed.preview });

      if (r.status >= 400)
        return res.status(r.status).json({ error: extractMsg(parsed.data), raw: parsed.data });

      return res.status(200).json(parsed.data);
    } catch(e) {
      return res.status(500).json({ error: "Erro de rede: " + e.message });
    }
  }

  return res.status(400).json({ error: `action inválida: "${action}"` });
};

// api/v8proxy.js — Proxy Vercel para API V8 Digital (resolve CORS)
const AUTH_URL  = "https://auth.v8sistema.com/oauth/token";
const BFF_URL   = "https://bff.v8sistema.com";
const CLIENT_ID = "DHWogdaYmEI8n5bwwxPDzulMlSK7dwIn";
const AUDIENCE  = "https://bff.v8sistema.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, payload } = req.body || {};

  try {
    // ── AUTH ─────────────────────────────────────────────────────
    if (action === "auth") {
      const { username, password } = payload;
      const body = new URLSearchParams({
        grant_type: "password",
        client_id:  CLIENT_ID,
        audience:   AUDIENCE,
        scope:      "openid profile email offline_access",
        username,
        password,
      });
      const r    = await fetch(AUTH_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    body.toString(),
      });
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({
          error: data.error || "auth_error",
          error_description: data.error_description || data.message || "Falha na autenticação",
        });
      }
      return res.status(200).json(data);
    }

    // ── BFF ──────────────────────────────────────────────────────
    if (action === "bff") {
      const { path, method = "GET", token, body: reqBody } = payload;

      if (!token) return res.status(401).json({ error: "Token ausente" });
      if (!path)  return res.status(400).json({ error: "Path ausente" });

      const url = `${BFF_URL}${path}`;

      const fetchOpts = {
        method: method.toUpperCase(),
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type":  "application/json",
          "Accept":        "application/json",
        },
      };

      if (reqBody && method.toUpperCase() !== "GET") {
        fetchOpts.body = JSON.stringify(reqBody);
      }

      const r    = await fetch(url, fetchOpts);
      const text = await r.text();

      let data;
      try   { data = JSON.parse(text); }
      catch { data = { raw: text }; }

      // Log completo no Vercel para debug
      console.log(`[V8 BFF] ${method.toUpperCase()} ${url} → ${r.status}`);
      if (!r.ok) {
        console.error(`[V8 BFF] ERRO ${r.status}:`, JSON.stringify(data).slice(0, 500));
      }

      // Sempre devolve o status real da V8 + corpo completo normalizado
      return res.status(r.ok ? 200 : r.status).json(
        r.ok ? data : {
          ...data,
          message: data.message
            || data.error_description
            || data.error
            || (Array.isArray(data.errors) ? data.errors.map(e => e.message || e).join("; ") : null)
            || data.statusInfo
            || data.errorMessage
            || (typeof data.raw === "string" ? data.raw : null)
            || `Erro ${r.status} — ${url}`,
          _v8status: r.status,
          _v8raw: data,
        }
      );
    }

    return res.status(400).json({ error: "Action inválida. Use 'auth' ou 'bff'." });

  } catch (err) {
    console.error("[v8proxy] Erro interno:", err.message);
    return res.status(500).json({ error: "Erro interno no proxy", detail: err.message });
  }
}

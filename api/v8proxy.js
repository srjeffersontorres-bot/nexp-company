// api/v8proxy.js — Proxy Vercel para API V8 Digital
const AUTH_URL  = "https://auth.v8sistema.com/oauth/token";
const BFF_URL   = "https://bff.v8sistema.com";
const CLIENT_ID = "DHWogdaYmEI8n5bwwxPDzulMlSK7dwIn";
const AUDIENCE  = "https://bff.v8sistema.com";

function extractMsg(d) {
  if (!d) return null;
  if (typeof d === "string") return d;
  const candidates = [
    d.message, d.error_description, d.error,
    d.statusInfo, d.errorMessage, d.detail, d.details, d.description, d.msg,
    Array.isArray(d.errors) ? d.errors.map(e => e.message || e.msg || String(e)).join("; ") : null,
    Array.isArray(d.messages) ? d.messages.join("; ") : null,
    d.error?.message, d.data?.message,
    typeof d.raw === "string" ? d.raw : null,
  ];
  return candidates.find(c => c && typeof c === "string" && c.trim()) || null;
}

function paymentVariants(payment) {
  if (!payment) return [null];
  const d = payment.data || payment;
  const isPix = !!(d.pix || d.pixKey);
  if (isPix) {
    const key = d.pix || d.pixKey;
    return [
      { type: "pix",  data: { pix: key } },
      { type: "PIX",  data: { pix: key } },
      { type: "pix",  data: { pixKey: key } },
      { type: "PIX",  data: { pixKey: key } },
    ];
  }
  const base = { bankId: d.bankId, bankAccountNumber: d.bankAccountNumber, bankAccountBranch: d.bankAccountBranch, bankAccountDigit: d.bankAccountDigit, bankAccountType: d.bankAccountType };
  return [
    { type: "ted",      data: base },
    { type: "TED",      data: base },
    { type: "transfer", data: base },
    { type: "TRANSFER", data: base },
  ];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { action, payload } = req.body || {};

  try {
    if (action === "auth") {
      const { username, password } = payload || {};
      const body = new URLSearchParams({ grant_type: "password", client_id: CLIENT_ID, audience: AUDIENCE, scope: "openid profile email offline_access", username, password });
      const r = await fetch(AUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error || "auth_error", error_description: data.error_description || data.message || "Falha na autenticação" });
      return res.status(200).json(data);
    }

    if (action === "bff") {
      const { path, method = "GET", token, body: reqBody } = payload || {};
      if (!token) return res.status(401).json({ error: "Token ausente" });
      if (!path)  return res.status(400).json({ error: "Path ausente" });

      const url = `${BFF_URL}${path}`;
      const meth = method.toUpperCase();
      const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/json" };

      if (path === "/fgts/proposal" && meth === "POST" && reqBody?.payment) {
        const variants = paymentVariants(reqBody.payment);
        console.log(`[V8] proposal variants=${variants.length} payment=${JSON.stringify(reqBody.payment)}`);
        let lastErr = "";
        for (let i = 0; i < variants.length; i++) {
          const testBody = { ...reqBody, payment: variants[i] };
          console.log(`[V8] v${i+1}: ${JSON.stringify(variants[i])}`);
          const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(testBody) });
          const text = await r.text();
          let data; try { data = JSON.parse(text); } catch { data = { raw: text, message: text.slice(0,200) }; }
          console.log(`[V8] v${i+1} -> ${r.status}`);
          if (r.ok) { console.log(`[V8] SUCCESS v${i+1}`); return res.status(200).json(data); }
          lastErr = extractMsg(data) || "";
          const isPayErr = lastErr.includes("payment") || lastErr.includes("anyOf") || lastErr.includes("type");
          if (!isPayErr) return res.status(r.status).json({ ...data, message: lastErr });
        }
        return res.status(400).json({ message: `Formato de pagamento não aceito. ${lastErr}` });
      }

      const r = await fetch(url, { method: meth, headers, ...(reqBody && meth !== "GET" ? { body: JSON.stringify(reqBody) } : {}) });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text, message: text.slice(0,300) }; }
      console.log(`[V8 BFF] ${meth} ${url} -> ${r.status}`);
      if (!r.ok) { const msg = extractMsg(data) || `Erro ${r.status}`; console.error(`[V8] ERR: ${msg}`); return res.status(r.status).json({ ...data, message: msg }); }
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Action invalida" });

  } catch (err) {
    console.error("[v8proxy] Erro interno:", err.message);
    return res.status(500).json({ error: "Erro interno no proxy", detail: err.message });
  }
}

// api/v8proxy.js — Vercel Serverless Function
// Coloque este arquivo em: /api/v8proxy.js na raiz do projeto
// Resolve o problema de CORS para a API V8 Digital

export default async function handler(req, res) {
  // Permitir apenas POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, payload } = req.body;

  // Headers CORS para o frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    let response, data;

    if (action === "auth") {
      // Autenticação OAuth2
      const body = new URLSearchParams({
        grant_type: "password",
        username:   payload.username,
        password:   payload.password,
        audience:   "https://bff.v8sistema.com",
        scope:      "openid profile email offline_access",
        client_id:  "DHWogdaYmEI8n5bwwxPDzulMlSK7dwIn",
      });

      response = await fetch("https://auth.v8sistema.com/oauth/token", {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      data = await response.json();

    } else if (action === "bff") {
      // Chamadas ao BFF da V8
      const { path, method = "GET", token, body: reqBody } = payload;

      const opts = {
        method,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type":  "application/json",
        },
      };
      if (reqBody) opts.body = JSON.stringify(reqBody);

      response = await fetch(`https://bff.v8sistema.com${path}`, opts);
      data = await response.json();

    } else {
      return res.status(400).json({ error: "action inválida" });
    }

    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

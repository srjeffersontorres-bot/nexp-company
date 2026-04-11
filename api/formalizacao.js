/**
 * POST /api/formalizacao
 * Etapa B — Cria termo de consentimento oficial no provedor V8.
 *
 * Fluxo:
 * 1. Recebe consultaId + dados do cliente + token V8
 * 2. Busca pré-consulta no Firestore
 * 3. Cria termo via V8 /private-consignment/consult (POST)
 * 4. Persiste formalização em Firestore (formalizacoes)
 * 5. Retorna signUrl para o frontend exibir ao operador
 *
 * IMPORTANTE: O sistema NUNCA assina em nome do cliente.
 * O signUrl deve ser aberto pelo cliente no link oficial do provedor.
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : null;

if (!getApps().length && serviceAccount) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = serviceAccount ? getFirestore() : null;

function erro(res, status, msg) {
  return res.status(status).json({ ok: false, erro: msg });
}

/** Normaliza data para YYYY-MM-DD (formato "date" exigido pela V8) */
function toDateOnly(d) {
  if (!d) return "";
  return String(d).split("T")[0]; // remove parte de hora se houver
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return erro(res, 405, "Método não permitido");

  const {
    consultaId,
    cpf,
    nome,
    email,
    telefone,
    dataNascimento,
    genero = "male",
    banco = "QI",
    token,
  } = req.body || {};

  // ── Validações ─────────────────────────────────────────────────────────
  if (!token) return erro(res, 401, "Token V8 obrigatório");
  if (!cpf || !nome || !email || !dataNascimento || !telefone)
    return erro(res, 400, "Campos obrigatórios: cpf, nome, email, telefone, dataNascimento");

  const cpfLimpo = cpf.replace(/\D/g, "").padStart(11, "0");
  const tel = telefone.replace(/\D/g, "");

  const proxyUrl = `${
    process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "http://localhost:3000"
  }/api/v8proxy`;

  try {
    // ── Etapa B.1: Criar termo de consentimento no provedor ────────────
    const bodyV8 = {
      borrowerDocumentNumber: cpfLimpo,
      gender: genero,
      birthDate: toDateOnly(dataNascimento), // YYYY-MM-DD — formato "date" exigido
      signerName: nome,
      signerEmail: email,
      signerPhone: {
        phoneNumber: tel.slice(-9),
        countryCode: "55",
        areaCode: tel.length >= 11 ? tel.slice(0, 2) : "11",
      },
      provider: banco.toUpperCase() === "CELCOIN" ? "celcoin" : "QI",
    };

    const r = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "bff",
        payload: {
          path: "/private-consignment/consult",
          method: "POST",
          token,
          body: bodyV8,
        },
      }),
    });

    const txt = await r.text();
    let v8Resp;
    try {
      v8Resp = JSON.parse(txt);
    } catch {
      return erro(res, 502, "Resposta inválida do proxy V8");
    }

    if (!r.ok) {
      const msg =
        v8Resp?.message ||
        v8Resp?.detail ||
        v8Resp?.error ||
        `Erro V8 ${r.status}`;
      console.error("[formalizacao] V8 error:", msg, "| body sent:", JSON.stringify(bodyV8));
      return erro(res, 422, msg);
    }

    const providerDocumentId = v8Resp.id;
    const signUrl =
      v8Resp.consent_url ||
      v8Resp.url ||
      `https://app.v8sistema.com/termos-de-autorizacao/${providerDocumentId}`;

    // ── Etapa B.2: Persistir formalização ─────────────────────────────
    const formalizacaoId = `fml_${cpfLimpo}_${banco}_${Date.now()}`;
    const registro = {
      id: formalizacaoId,
      consulta_id: consultaId || null,
      cpf: cpfLimpo,
      banco,
      provider_document_id: providerDocumentId,
      sign_url: signUrl,
      status: "pending_consent",   // Cliente ainda não assinou
      signed_at: null,
      proposta_status: null,
      margem_final: null,
      raw_payload: v8Resp,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (db) {
      await db.collection("formalizacoes").doc(formalizacaoId).set(registro);
      // Atualiza pré-consulta se houver consultaId
      if (consultaId) {
        await db.collection("pre_consultas").doc(consultaId).update({
          status: "formalizacao_criada",
          formalizacao_id: formalizacaoId,
          updated_at: new Date().toISOString(),
        });
      }
    }

    console.log(
      `[formalizacao] CPF=${cpfLimpo} banco=${banco} formalizacaoId=${formalizacaoId} providerDocumentId=${providerDocumentId}`
    );

    return res.status(200).json({
      ok: true,
      formalizacaoId,
      providerDocumentId,
      signUrl,
      status: "pending_consent",
      mensagem:
        "Termo criado com sucesso. Envie o link ao cliente para assinatura.",
    });
  } catch (e) {
    console.error("[formalizacao] Erro:", e.message);
    return erro(res, 500, e.message);
  }
}

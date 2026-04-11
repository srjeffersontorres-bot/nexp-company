/**
 * POST /api/formalizacaostatus
 * Verifica status atual de uma formalização (polling do frontend).
 *
 * Recebe: { formalizacaoId, cpf, banco, providerDocumentId, token }
 * Retorna: { status, signedAt, margemFinal, propostaStatus, detalhes }
 *
 * Lógica:
 * - Consulta Firestore para obter registro local
 * - Consulta V8 para obter status atualizado do provedor
 * - Atualiza Firestore se status mudou
 * - Se status = signed → dispara criação de proposta
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

// Mapeamento de status V8 → status interno
const STATUS_MAP = {
  WAITING_CONSENT:          "pending_consent",
  CONSENT_APPROVED:         "awaiting_signature",
  WAITING_CONSULT:          "processing",
  WAITING_CREDIT_ANALYSIS:  "processing",
  SUCCESS:                  "signed",
  FAILED:                   "rejected",
  REJECTED:                 "rejected",
};

function erro(res, status, msg) {
  return res.status(status).json({ ok: false, erro: msg });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return erro(res, 405, "Método não permitido");

  const { formalizacaoId, cpf, banco = "QI", token } = req.body || {};

  if (!token) return erro(res, 401, "Token V8 obrigatório");
  if (!cpf) return erro(res, 400, "CPF obrigatório");

  const cpfLimpo = cpf.replace(/\D/g, "").padStart(11, "0");
  const proxyUrl = `${
    process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "http://localhost:3000"
  }/api/v8proxy`;

  try {
    // ── 1. Buscar estado local no Firestore ───────────────────────────
    let localStatus = null;
    let localDoc = null;
    if (db && formalizacaoId) {
      const snap = await db.collection("formalizacoes").doc(formalizacaoId).get();
      if (snap.exists) {
        localDoc = snap.data();
        localStatus = localDoc.status;
        // Se já finalizado, retorna sem chamar V8
        if (["signed", "rejected", "finalizado"].includes(localStatus)) {
          return res.status(200).json({
            ok: true,
            status: localStatus,
            signedAt: localDoc.signed_at,
            margemFinal: localDoc.margem_final,
            propostaStatus: localDoc.proposta_status,
            detalhes: localDoc.raw_payload,
            fromCache: true,
          });
        }
      }
    }

    // ── 2. Consultar V8 para status atualizado ─────────────────────────
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 365 * 86400000).toISOString();
    const url = `/private-consignment/consult?search=${cpfLimpo}&page=1&limit=10&provider=${banco}&startDate=${start}&endDate=${end}`;

    const r = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "bff",
        payload: { path: url, method: "GET", token, body: null },
      }),
    });

    const txt = await r.text();
    let v8Data;
    try { v8Data = JSON.parse(txt); } catch { return erro(res, 502, "Resposta inválida do proxy V8"); }

    const itens = (v8Data?.data || []).sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    // Filtra pelo providerDocumentId se disponível
    const provDocId = localDoc?.provider_document_id;
    const item = provDocId
      ? itens.find((x) => x.id === provDocId) || itens[0]
      : itens[0];

    if (!item) {
      return res.status(200).json({
        ok: true,
        status: localStatus || "sem_registro",
        margemFinal: null,
        propostaStatus: null,
        detalhes: null,
      });
    }

    const novoStatus = STATUS_MAP[item.status] || "processing";
    const margemFinal = parseFloat(item.availableMarginValue || 0) || null;
    const signedAt = novoStatus === "signed" ? new Date().toISOString() : null;

    // ── 3. Atualizar Firestore se mudou ───────────────────────────────
    if (db && formalizacaoId && novoStatus !== localStatus) {
      const update = {
        status: novoStatus,
        margem_final: margemFinal,
        updated_at: new Date().toISOString(),
        raw_payload: item,
      };
      if (signedAt) update.signed_at = signedAt;

      await db.collection("formalizacoes").doc(formalizacaoId).update(update);

      // Se assinado → dispara criação de proposta (async, não bloqueia resposta)
      if (novoStatus === "signed") {
        console.log(`[formalizacaostatus] Assinado! CPF=${cpfLimpo} margem=${margemFinal}`);
        // proposalService seria chamado aqui em produção
        // proposalService.criar({ cpf: cpfLimpo, margemFinal, banco, formalizacaoId });
        db.collection("formalizacoes").doc(formalizacaoId).update({
          proposta_status: "pendente_criacao",
          updated_at: new Date().toISOString(),
        });
      }
    }

    return res.status(200).json({
      ok: true,
      status: novoStatus,
      statusV8: item.status,
      signedAt,
      margemFinal,
      propostaStatus: novoStatus === "signed" ? "pendente_criacao" : null,
      detalhes: item,
    });
  } catch (e) {
    console.error("[formalizacaostatus] Erro:", e.message);
    return erro(res, 500, e.message);
  }
}

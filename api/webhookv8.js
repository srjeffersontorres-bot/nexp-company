/**
 * POST /api/webhookv8
 * Receptor de webhooks enviados pelo provedor V8 Digital.
 *
 * Eventos tratados:
 *   consent_created       → pending_consent
 *   consent_viewed        → awaiting_signature
 *   signed                → signed (dispara criação de proposta)
 *   rejected / expired    → rejected
 *
 * IMPORTANTE: Não automatiza assinatura. Apenas registra o evento
 * e atualiza o status no banco conforme confirmação oficial do provedor.
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

// Mapeamento de eventos do webhook para status interno
const EVENTO_STATUS = {
  consent_created:  "pending_consent",
  consent_viewed:   "awaiting_signature",
  signed:           "signed",
  rejected:         "rejected",
  expired:          "rejected",
  SUCCESS:          "signed",
  FAILED:           "rejected",
  REJECTED:         "rejected",
};

export default async function handler(req, res) {
  // Sempre responde 200 rapidamente para o provedor não retentar
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET") {
    // Health check do webhook
    return res.status(200).json({ ok: true, mensagem: "Webhook V8 ativo" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, erro: "Método não permitido" });
  }

  const payload = req.body;
  const evento = payload?.event || payload?.type || payload?.status || "";
  const providerDocumentId =
    payload?.documentId ||
    payload?.id ||
    payload?.consentId ||
    payload?.data?.id || "";

  console.log(`[webhookv8] Evento recebido: ${evento} | docId: ${providerDocumentId}`);
  console.log("[webhookv8] Payload:", JSON.stringify(payload).slice(0, 500));

  // Responde imediatamente (provedor não deve aguardar processamento)
  res.status(200).json({ ok: true, recebido: true });

  // ── Processamento assíncrono ───────────────────────────────────────
  if (!db || !providerDocumentId) return;

  try {
    const novoStatus = EVENTO_STATUS[evento];
    if (!novoStatus) {
      console.log(`[webhookv8] Evento não mapeado: ${evento}`);
      return;
    }

    // Busca a formalização pelo provider_document_id
    const snap = await db
      .collection("formalizacoes")
      .where("provider_document_id", "==", providerDocumentId)
      .limit(1)
      .get();

    if (snap.empty) {
      console.warn(`[webhookv8] Formalização não encontrada para docId=${providerDocumentId}`);
      // Salva o webhook recebido para auditoria mesmo sem encontrar o registro
      await db.collection("webhooks_recebidos").add({
        evento,
        provider_document_id: providerDocumentId,
        payload,
        processado: false,
        motivo: "formalizacao_nao_encontrada",
        created_at: new Date().toISOString(),
      });
      return;
    }

    const docRef = snap.docs[0].ref;
    const docData = snap.docs[0].data();

    // Não regride status (ex: não volta de "signed" para "pending")
    const statusOrder = ["pending_consent","awaiting_signature","processing","signed","rejected"];
    const currentIdx = statusOrder.indexOf(docData.status || "pending_consent");
    const newIdx = statusOrder.indexOf(novoStatus);
    if (newIdx < currentIdx && novoStatus !== "rejected") {
      console.log(`[webhookv8] Status não regredido: ${docData.status} → ${novoStatus}`);
      return;
    }

    const update = {
      status: novoStatus,
      updated_at: new Date().toISOString(),
      ultimo_evento: evento,
      raw_webhook: payload,
    };

    // Se assinado → registra data e dispara proposta
    if (novoStatus === "signed") {
      update.signed_at = payload?.signedAt || payload?.signed_at || new Date().toISOString();
      update.margem_final = parseFloat(payload?.availableMarginValue || payload?.margin || 0) || null;
      update.proposta_status = "pendente_criacao";

      console.log(`[webhookv8] ✅ ASSINADO! CPF=${docData.cpf} margem=${update.margem_final}`);

      // Aqui seria chamado proposalService.criar() em produção
      // Por enquanto registra a intenção
      await db.collection("propostas_pendentes").add({
        formalizacao_id: docRef.id,
        cpf: docData.cpf,
        banco: docData.banco,
        margem_final: update.margem_final,
        provider_document_id: providerDocumentId,
        status: "aguardando_processamento",
        created_at: new Date().toISOString(),
      });
    }

    // Atualiza formalização
    await docRef.update(update);

    // Registra webhook recebido para auditoria
    await db.collection("webhooks_recebidos").add({
      evento,
      provider_document_id: providerDocumentId,
      formalizacao_id: docRef.id,
      payload,
      processado: true,
      created_at: new Date().toISOString(),
    });

    console.log(`[webhookv8] Status atualizado: ${docData.status} → ${novoStatus} (formalizacaoId=${docRef.id})`);
  } catch (e) {
    console.error("[webhookv8] Erro no processamento:", e.message);
  }
}

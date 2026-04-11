/**
 * POST /api/preconsulta
 * Etapa A — Consulta preliminar de margem CLT via V8 Digital.
 *
 * Fluxo:
 * 1. Valida CPF
 * 2. Busca termos existentes para o CPF no provedor (V8)
 * 3. Se houver termo com status SUCCESS → retorna margem diretamente
 * 4. Caso contrário → retorna elegivel=false, indica necessidade de formalização
 * 5. Persiste resultado em Firestore (pre_consultas)
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ── Firebase Admin init ────────────────────────────────────────────────────
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : null;

if (!getApps().length && serviceAccount) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = serviceAccount ? getFirestore() : null;

// ── Helpers ────────────────────────────────────────────────────────────────
/** Valida CPF — algoritmo oficial */
function validarCPF(cpf) {
  const c = cpf.replace(/\D/g, "").padStart(11, "0");
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) =>
    11 -
    (c
      .slice(0, n)
      .split("")
      .reduce((s, d, i) => s + parseInt(d) * (n + 1 - i), 0) *
      10 %
      11);
  const d1 = calc(9) > 9 ? 0 : calc(9);
  const d2 = calc(10) > 9 ? 0 : calc(10);
  return d1 === parseInt(c[9]) && d2 === parseInt(c[10]);
}

/** Resposta padronizada de erro */
function erro(res, status, msg, detalhes = {}) {
  return res.status(status).json({ ok: false, erro: msg, ...detalhes });
}

// ── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return erro(res, 405, "Método não permitido");

  const { cpf, banco, token } = req.body || {};

  // ── Validações ─────────────────────────────────────────────────────────
  if (!cpf) return erro(res, 400, "CPF obrigatório");
  const cpfLimpo = cpf.replace(/\D/g, "").padStart(11, "0");
  if (!validarCPF(cpfLimpo)) return erro(res, 400, "CPF inválido");
  if (!token) return erro(res, 401, "Token V8 obrigatório");
  if (!banco) return erro(res, 400, "Banco obrigatório (ex: QI, celcoin)");

  const v8BaseUrl = "https://api.v8digital.com.br"; // via proxy interno
  const proxyUrl = `${process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "http://localhost:3000"}/api/v8proxy`;

  try {
    // ── Etapa A.1: Buscar termos existentes ────────────────────────────
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 365 * 86400000).toISOString();
    const consultaUrl = `/private-consignment/consult?search=${cpfLimpo}&page=1&limit=20&provider=${banco}&startDate=${start}&endDate=${end}`;

    const r = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "bff",
        payload: { path: consultaUrl, method: "GET", token, body: null },
      }),
    });

    let v8Data = null;
    try {
      const txt = await r.text();
      v8Data = JSON.parse(txt);
    } catch {
      return erro(res, 502, "Resposta inválida do proxy V8");
    }

    const itens = v8Data?.data || [];

    // ── Etapa A.2: Avaliar resultado ───────────────────────────────────
    // Ordena por data mais recente
    itens.sort(
      (a, b) =>
        new Date(b.createdAt || b.created_at || 0) -
        new Date(a.createdAt || a.created_at || 0)
    );

    const termSucesso = itens.find((x) => x.status === "SUCCESS");
    const termAtivo = itens.find((x) =>
      [
        "WAITING_CONSENT",
        "CONSENT_APPROVED",
        "WAITING_CONSULT",
        "WAITING_CREDIT_ANALYSIS",
      ].includes(x.status)
    );

    let elegivel = false;
    let margemPreliminar = null;
    let status = "sem_consulta";
    let observacoes = "Nenhum termo encontrado. Iniciar formalização.";
    let termoExistenteId = null;
    let termoLink = null;

    if (termSucesso) {
      // Já tem margem disponível
      elegivel = true;
      margemPreliminar = parseFloat(termSucesso.availableMarginValue || 0);
      status = "margem_disponivel";
      observacoes = margemPreliminar > 0
        ? `Margem disponível: R$ ${margemPreliminar.toFixed(2)}`
        : "Aprovado sem margem disponível no momento.";
      termoExistenteId = termSucesso.id;
    } else if (termAtivo) {
      // Termo criado mas aguardando assinatura/processamento
      elegivel = false;
      status = "aguardando_assinatura";
      observacoes = "Termo criado. Cliente precisa assinar para liberar margem.";
      termoExistenteId = termAtivo.id;
      termoLink =
        termAtivo.consent_url ||
        termAtivo.link ||
        `https://app.v8sistema.com/termos-de-autorizacao/${termAtivo.id}`;
    } else {
      // Nenhum termo — precisa criar
      elegivel = false;
      status = "necessita_formalizacao";
      observacoes = "Cliente nunca passou pelo fluxo CLT. Iniciar formalização.";
    }

    // ── Etapa A.3: Persistir em Firestore ──────────────────────────────
    const consultaId = `pc_${cpfLimpo}_${banco}_${Date.now()}`;
    const payload = {
      id: consultaId,
      cpf: cpfLimpo,
      banco,
      elegivel,
      margem_preliminar: margemPreliminar,
      observacoes,
      status,
      termo_existente_id: termoExistenteId,
      termo_link: termoLink,
      raw_v8: itens.slice(0, 3), // guarda os 3 primeiros para auditoria
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (db) {
      await db.collection("pre_consultas").doc(consultaId).set(payload);
    }

    console.log(`[pre_consulta] CPF=${cpfLimpo} banco=${banco} status=${status}`);

    return res.status(200).json({
      ok: true,
      consultaId,
      elegivel,
      margemPreliminar,
      status,
      observacoes,
      termoExistenteId,
      termoLink,
    });
  } catch (e) {
    console.error("[pre_consulta] Erro:", e.message);
    return erro(res, 500, e.message);
  }
}

// src/security.js
// ─────────────────────────────────────────────────────────────────
// Segurança e hierarquia de usuários.
// NUNCA coloque senha hardcoded aqui — toda autenticação
// passa pelo Firebase Auth.
// ─────────────────────────────────────────────────────────────────

import { db } from "./firebase";
import { collection, getDocs, doc, setDoc, writeBatch } from "firebase/firestore";

// ─── Roles canônicos (4 níveis) ──────────────────────────────────
// 0 = mais alto, 3 = mais baixo
export const ROLES = {
  administrador: 0,
  gerente:       1,
  supervisor:    2,
  operador:      3,
};

// Mapa de roles legados → role canônico
export const ROLE_MIGRATION_MAP = {
  mestre:    "administrador",
  master:    "gerente",
  indicado:  "operador",
  visitante: "operador",
  digitador: "operador",
  // já canônicos — passam direto
  administrador: "administrador",
  gerente:       "gerente",
  supervisor:    "supervisor",
  operador:      "operador",
};

export const ROLE_LABEL = {
  administrador: "Administrador",
  gerente:       "Gerente Comercial",
  supervisor:    "Supervisor",
  operador:      "Operador",
};

export const ROLE_COLOR = {
  administrador: "#C084FC",
  gerente:       "#4F8EF7",
  supervisor:    "#FBBF24",
  operador:      "#34D399",
};

// Resolve role legado → canônico
export function resolveRole(role) {
  return ROLE_MIGRATION_MAP[role] || "operador";
}

// Retorna o nível numérico (0=admin, 3=operador)
export function roleLevel(role) {
  return ROLES[resolveRole(role)] ?? 99;
}

// Quais roles um usuário pode criar (só abaixo do seu nível)
export function getRolesCanCreate(myRole) {
  const lvl = roleLevel(myRole);
  return Object.entries(ROLES)
    .filter(([, v]) => v > lvl)
    .map(([k]) => k);
}

// Pode ver/editar outro usuário?
export function canManageUser(myRole, targetRole) {
  return roleLevel(myRole) < roleLevel(targetRole);
}

// Pode ver senha de usuários abaixo?
// Apenas administrador (lvl 0) e gerente (lvl 1) podem ver senhas de níveis abaixo
export function canSeePassword(myRole, targetRole) {
  return roleLevel(myRole) <= 1 && roleLevel(myRole) < roleLevel(targetRole);
}

// ─── Migração de roles legados no Firestore ───────────────────────
// Execute UMA VEZ no console do app (botão só para administrador).
// Converte: mestre→administrador, master→gerente, indicado/visitante/digitador→operador
export async function migrarRolesLegados(dry = false) {
  const snap = await getDocs(collection(db, "users"));
  const updates = [];

  snap.docs.forEach((d) => {
    const data = d.data();
    const roleAtual = data.role || "operador";
    const roleNovo = resolveRole(roleAtual);
    if (roleNovo !== roleAtual) {
      updates.push({ id: d.id, roleAtual, roleNovo });
    }
  });

  if (dry) {
    console.table(updates);
    console.log(`[migrarRoles] ${updates.length} usuários seriam migrados.`);
    return updates;
  }

  if (updates.length === 0) {
    console.log("[migrarRoles] Nenhuma migração necessária.");
    return [];
  }

  // Atualiza em lote (máx 500 por batch)
  const chunks = [];
  for (let i = 0; i < updates.length; i += 500) {
    chunks.push(updates.slice(i, i + 500));
  }
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(({ id, roleNovo }) => {
      batch.update(doc(db, "users", id), { role: roleNovo });
    });
    await batch.commit();
  }

  console.log(`[migrarRoles] ${updates.length} usuários migrados com sucesso.`);
  return updates;
}

// ─── Upload seguro ────────────────────────────────────────────────
export const UPLOAD_CONFIG = {
  maxSizeMB: 10,
  tiposPermitidos: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

export function validarArquivo(file) {
  if (!file) return "Nenhum arquivo selecionado.";
  if (!UPLOAD_CONFIG.tiposPermitidos.includes(file.type)) {
    return `Tipo não permitido: ${file.type || "desconhecido"}. Use: imagens, PDF ou DOCX.`;
  }
  const maxBytes = UPLOAD_CONFIG.maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: ${UPLOAD_CONFIG.maxSizeMB}MB.`;
  }
  return null; // ok
}

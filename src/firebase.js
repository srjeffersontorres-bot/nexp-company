// src/firebase.js
// ─────────────────────────────────────────────────────────────────
// PASSO 1: Substitua os valores abaixo pelos do SEU projeto Firebase
// (Você encontra em: Firebase Console → Configurações do projeto → Seus apps)
// ─────────────────────────────────────────────────────────────────

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

// ── Substitua aqui com suas credenciais ──────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAnYyVIb5AxUd1qkQuXVEpEw7COzW2nvDw",
  authDomain: "nexpcompany-9a7ba.firebaseapp.com",
  projectId: "nexpcompany-9a7ba",
  storageBucket: "nexpcompany-9a7ba.firebasestorage.app",
  messagingSenderId: "1043432853586",
  appId: "1:1043432853586:web:10d443d6757420fe01cf8b",
};
// ────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// ── Mantém a sessão do usuário após recarregar a página ──────────
setPersistence(auth, browserLocalPersistence);

// ── Storage — Upload de mídia para stories ───────────────────────
export function uploadMedia(file, path, onProgress) {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        if (onProgress) onProgress(pct);
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });
}

export async function deleteMedia(storagePath) {
  try { await deleteObject(ref(storage, storagePath)); } catch(e) {}
}

// ── Contacts (Leads) ─────────────────────────────────────────────

/** Ouve todos os contatos em tempo real. Chame onSnapshot e retorna unsub. */
export function listenContacts(callback) {
  const q = collection(db, "contacts");
  return onSnapshot(q, (snap) => {
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Ordena localmente por updatedAt decrescente
    docs.sort((a, b) => {
      const ta = a.updatedAt?.seconds ?? 0;
      const tb = b.updatedAt?.seconds ?? 0;
      return tb - ta;
    });
    callback(docs);
  });
}

/** Salva (cria ou atualiza) um contato no Firestore. */
export async function saveContact(contact) {
  const id = contact.id ? String(contact.id) : String(Date.now());
  const ref = doc(db, "contacts", id);
  await setDoc(
    ref,
    { ...contact, id, updatedAt: serverTimestamp() },
    { merge: true },
  );
  return id;
}

/** Remove um contato do Firestore. */
export async function deleteContact(id) {
  await deleteDoc(doc(db, "contacts", String(id)));
}

/** Remove múltiplos contatos de uma vez usando batch (máx 500 por lote). */
export async function deleteContacts(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach((id) => batch.delete(doc(db, "contacts", String(id))));
    await batch.commit();
  }
}

// ── Presença Online ───────────────────────────────────────────

/** Atualiza presença online do usuário. */
export async function setPresence(uid, name, role) {
  await setDoc(doc(db, "presence", uid), {
    uid, name, role, online: true, lastSeen: serverTimestamp(),
  }, { merge: true });
}

/** Remove presença online. */
export async function removePresence(uid) {
  await setDoc(doc(db, "presence", uid), { online: false, lastSeen: serverTimestamp() }, { merge: true });
}

/** Ouve presenças online em tempo real. */
export function listenPresence(callback) {
  return onSnapshot(collection(db, "presence"), (snap) => {
    const data = {};
    snap.docs.forEach(d => { data[d.id] = d.data(); });
    callback(data);
  });
}

// ── Chat ─────────────────────────────────────────────────────────

/** Ouve mensagens do chat em tempo real. */
export function listenChat(callback) {
  return onSnapshot(collection(db, "chat"), (snap) => {
    const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    msgs.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
    callback(msgs);
  });
}

/** Envia uma mensagem no chat. */
export async function sendChatMessage(msg) {
  const id = String(Date.now());
  await setDoc(doc(db, "chat", id), { ...msg, id, createdAt: serverTimestamp() });
}

// ── Users (Profiles) ─────────────────────────────────────────────

/** Ouve todos os perfis de usuário em tempo real. */
export function listenUsers(callback) {
  return onSnapshot(collection(db, "users"), (snap) => {
    callback(snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => !u.deleted));
  });
}

/** Salva (cria ou atualiza) o perfil de um usuário. */
export async function saveUserProfile(uid, data) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, data, { merge: true });
}

/** Lê o perfil de um usuário pelo UID. */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

// ── Auth ─────────────────────────────────────────────────────────

/** Login com email + senha. Retorna o Firebase User. */
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Logout. */
export async function logout() {
  await signOut(auth);
}

/** Cria uma conta Firebase Auth para um novo operador. */
export async function createOperator(email, password) {
  // Usa uma instância secundária temporária para não deslogar o admin
  const secondApp = initializeApp(firebaseConfig, "secondary_" + Date.now());
  const secondAuth = getAuth(secondApp);
  const cred = await createUserWithEmailAndPassword(
    secondAuth,
    email,
    password,
  );
  await signOut(secondAuth);
  return cred.user.uid;
}

/** Redefine a senha de um usuário (requer reautenticação recente do admin). */
export async function resetUserPassword(newPassword) {
  if (auth.currentUser) {
    await updatePassword(auth.currentUser, newPassword);
  }
}

export {
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  createUserWithEmailAndPassword,
};

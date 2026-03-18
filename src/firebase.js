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
  onSnapshot,
  query,
  orderBy,
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

// ── Mantém a sessão do usuário após recarregar a página ──────────
setPersistence(auth, browserLocalPersistence);

// ── Contacts (Leads) ─────────────────────────────────────────────

/** Ouve todos os contatos em tempo real. Chame onSnapshot e retorna unsub. */
export function listenContacts(callback) {
  const q = query(collection(db, "contacts"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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

// ── Users (Profiles) ─────────────────────────────────────────────

/** Ouve todos os perfis de usuário em tempo real. */
export function listenUsers(callback) {
  return onSnapshot(collection(db, "users"), (snap) => {
    callback(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
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

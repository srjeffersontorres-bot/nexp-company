// src/hooks.js
// ─────────────────────────────────────────────────────────────────
// Hooks customizados — centralizam acesso a dados e estado global.
// Nunca deixam senha ou dado sensível hardcoded.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { onSnapshot, collection } from "firebase/firestore";
import {
  auth,
  db,
  listenContacts,
  listenUsers,
  listenPresence,
  listenChat,
  listenCalendarNotes,
  getUserProfile,
  setPresence,
  removePresence,
} from "./firebase";

// ─── useAuthUser ─────────────────────────────────────────────────
// Observa autenticação Firebase e carrega perfil do Firestore.
// Nunca expõe senha — a senha fica só no Firebase Auth.
export function useAuthUser() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const profile = await getUserProfile(firebaseUser.uid);
        if (profile && profile.active !== false) {
          setCurrentUser({ ...profile, uid: firebaseUser.uid });
        } else {
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  return { currentUser, setCurrentUser, authLoading };
}

// ─── useContacts ─────────────────────────────────────────────────
// Ouve contatos em tempo real. Memoiza lista filtrada.
export function useContacts(currentUser) {
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    if (!currentUser) return;
    const unsub = listenContacts((data) => setContacts(data));
    return () => unsub();
  }, [currentUser]);

  return { contacts, setContacts };
}

// ─── useUsers ────────────────────────────────────────────────────
// Ouve perfis de usuários — sem campo password no Firestore.
export function useUsers(currentUser) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (!currentUser) return;
    const unsub = listenUsers((data) => {
      // Garantia extra: nunca repassa campo 'password' para o estado
      setUsers(data.map(({ password: _pw, ...u }) => u));
    });
    return () => unsub();
  }, [currentUser]);

  return { users, setUsers };
}

// ─── usePresence ─────────────────────────────────────────────────
// Mantém presença online e ouve outros usuários.
export function usePresence(currentUser) {
  const [presence, setPresenceData] = useState({});

  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;
    setPresence(myId, currentUser.name || currentUser.email, currentUser.role);
    const interval = setInterval(() => {
      setPresence(myId, currentUser.name || currentUser.email, currentUser.role);
    }, 30000);
    const handleUnload = () => removePresence(myId);
    window.addEventListener("beforeunload", handleUnload);
    const unsub = listenPresence((data) => setPresenceData(data));
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleUnload);
      unsub();
    };
  }, [currentUser]); // eslint-disable-line

  return { presence };
}

// ─── useChat ─────────────────────────────────────────────────────
// Ouve mensagens do chat e conta não lidas.
export function useChat(currentUser) {
  const [unreadChat, setUnreadChat] = useState(0);
  const lastChatCount = useRef(0);

  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;
    const unsub = listenChat((msgs) => {
      const myUnread = msgs.filter(
        (m) => m.uid !== myId && !m.readBy?.includes(myId)
      ).length;
      if (myUnread > lastChatCount.current) {
        // novo badge
      }
      lastChatCount.current = myUnread;
      setUnreadChat(myUnread);
    });
    return () => unsub();
  }, [currentUser]); // eslint-disable-line

  return { unreadChat };
}

// ─── useCalendarNotes ─────────────────────────────────────────────
export function useCalendarNotes(currentUser) {
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;
    const unsub = listenCalendarNotes(myId, (data) => setNotes(data));
    return () => unsub();
  }, [currentUser]); // eslint-disable-line

  return { notes, setNotes };
}

// ─── useTheme ────────────────────────────────────────────────────
export function useTheme() {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem("nexp_theme") || "Padrão"
  );

  const setTheme = useCallback((t) => {
    setThemeState(t);
    localStorage.setItem("nexp_theme", t);
  }, []);

  return { theme, setTheme };
}

// ─── useUnreadCounters ───────────────────────────────────────────
// Agrega todos os contadores de badge numa chamada só.
export function useUnreadCounters(currentUser) {
  const [unreadNotif,    setUnreadNotif]    = useState(0);
  const [unreadStories,  setUnreadStories]  = useState(0);
  const [unreadPropostas,setUnreadPropostas]= useState(0);
  const [unreadDigitacao,setUnreadDigitacao]= useState(0);
  const [chatStories,    setChatStories]    = useState([]);

  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;

    // Stories
    const unsubStories = onSnapshot(collection(db, "stories"), (snap) => {
      const now = Date.now();
      const live = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.expiresAt > now);
      setChatStories(live);
      const othersWithUnseen = new Set(
        live
          .filter((s) => s.authorId !== myId && !(s.views || []).includes(myId))
          .map((s) => s.authorId)
      ).size;
      setUnreadStories(othersWithUnseen);
    });

    // Propostas
    const unsubPropostas = onSnapshot(collection(db, "propostas"), (snap) => {
      const all = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      const isMestreOrMaster = ["mestre", "master", "administrador"].includes(currentUser.role);
      const isDigitador = ["digitador", "operador"].includes(currentUser.role);
      const unread = all.filter((p) => {
        if (isMestreOrMaster) return !p.viewedBy?.includes(myId);
        return (
          p.criadoPor === myId &&
          p.hasNewInteraction &&
          !p.viewedByDigitador?.includes(myId)
        );
      }).length;
      setUnreadPropostas(unread);
      if (isDigitador) {
        setUnreadDigitacao(
          all.filter(
            (p) =>
              p.criadoPor === myId &&
              p.hasNewInteraction &&
              !p.viewedByDigitador?.includes(myId)
          ).length
        );
      }
    });

    // Notificações
    const unsubNotif = onSnapshot(collection(db, "notifications"), (snap) => {
      const TIPOS_PROPOSTA = [
        "proposta_editada","proposta_atualizada","edicao_liberada",
        "pendente_documentacao","documentos_enviados","lembrete_evidencia",
      ];
      const notifs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const mine = notifs.filter(
        (n) => !TIPOS_PROPOSTA.includes(n.type) &&
          (n.toId === myId || n.broadcast === true)
      );
      const unread = mine.filter((n) =>
        n.broadcast ? !(n.readBy || []).includes(myId) : !n.readAt
      ).length;
      setUnreadNotif(unread);
    });

    return () => {
      unsubStories();
      unsubPropostas();
      unsubNotif();
    };
  }, [currentUser]); // eslint-disable-line

  return {
    unreadNotif,
    unreadStories,
    unreadPropostas,
    unreadDigitacao,
    chatStories,
  };
}

// ─── useFilteredContacts ─────────────────────────────────────────
// Memoiza lista filtrada de contatos para evitar re-renders pesados.
export function useFilteredContacts(contacts, query = "", filters = {}) {
  return useMemo(() => {
    let list = contacts;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.cpf?.includes(q) ||
          c.phone?.includes(q)
      );
    }
    if (filters.status) {
      list = list.filter((c) => c.status === filters.status);
    }
    if (filters.leadType) {
      list = list.filter((c) => c.leadType === filters.leadType);
    }
    return list;
  }, [contacts, query, filters]);
}

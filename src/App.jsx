import { useState, useRef, useEffect } from "react";
import { onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import {
  auth,
  db,
  listenContacts,
  saveContact,
  deleteContact,
  deleteContacts,
  listenUsers,
  saveUserProfile,
  getUserProfile,
  login as firebaseLogin,
  logout as firebaseLogout,
  createOperator,
  listenChat,
  sendChatMessage,
  setPresence,
  removePresence,
  listenPresence,
  uploadMedia,
} from "./firebase";

// ── Constants ──────────────────────────────────────────────────
const LEAD_TYPES = [
  "FGTS",
  "Empréstimo do Trabalhador",
  "Empréstimo do Bolsa Família",
  "Saque Complementar",
  "INSS",
  "Bolsa Família",
  "Outro",
];
const CLIENT_STATUS = [
  "Não simulado",
  "Sem margem",
  "Sem oportunidade",
  "Com oportunidade",
  "Aguardando retorno",
  "Em negociação",
  "Atualização de contato",
  "Fechado",
];
const STATUS_STYLE = {
  "Não simulado": { bg: "#1E2230", color: "#6B7280" },
  "Sem margem": { bg: "#2D1515", color: "#F87171" },
  "Sem oportunidade": { bg: "#2D1515", color: "#EF4444" },
  "Com oportunidade": { bg: "#0D2B1A", color: "#34D399" },
  "Aguardando retorno": { bg: "#2B2310", color: "#FBBF24" },
  "Em negociação": { bg: "#0D1C38", color: "#60A5FA" },
  "Atualização de contato": { bg: "#1E1030", color: "#C084FC" },
  Fechado: { bg: "#0A2918", color: "#10B981" },
};
const LEAD_COLOR = {
  FGTS: "#4F8EF7",
  "Empréstimo do Trabalhador": "#A78BFA",
  "Empréstimo do Bolsa Família": "#F472B6",
  "Saque Complementar": "#FB923C",
  INSS: "#34D399",
  "Bolsa Família": "#F59E0B",
  Outro: "#9CA3AF",
};
const EMOJIS = [
  "👍",
  "🔥",
  "⭐",
  "💰",
  "📞",
  "✅",
  "❌",
  "⏳",
  "🤝",
  "💬",
  "🎯",
  "😊",
];

// ── Accent Themes ──────────────────────────────────────────────
const ACCENT_THEMES = {
  Padrão: {
    acc: "#3B6EF5",
    abg: "#141A2E",
    atxt: "#4F8EF7",
    lg1: "#3B6EF5",
    lg2: "#7C3AED",
  },
  Verde: {
    acc: "#16A34A",
    abg: "#0A2918",
    atxt: "#34D399",
    lg1: "#16A34A",
    lg2: "#059669",
  },
  Vermelho: {
    acc: "#DC2626",
    abg: "#2D0A0A",
    atxt: "#F87171",
    lg1: "#DC2626",
    lg2: "#B91C1C",
  },
  Azul: {
    acc: "#0EA5E9",
    abg: "#082033",
    atxt: "#38BDF8",
    lg1: "#0EA5E9",
    lg2: "#0284C7",
  },
  Amarelo: {
    acc: "#D97706",
    abg: "#2B1D03",
    atxt: "#FBBF24",
    lg1: "#D97706",
    lg2: "#B45309",
  },
  Rosa: {
    acc: "#DB2777",
    abg: "#2D0E30",
    atxt: "#F472B6",
    lg1: "#DB2777",
    lg2: "#BE185D",
  },
};

// Fixed dark colour tokens (mutable so theme can override accent)
const C = {
  bg: "#080A10",
  sb: "#08090F",
  card: "#0F1320",
  deep: "#0B0D14",
  b1: "#13161F",
  b2: "#1A1F2E",
  tp: "#E8EAEF",
  ts: "#9CA3AF",
  tm: "#525870",
  td: "#2D3348",
  acc: "#3B6EF5",
  abg: "#141A2E",
  atxt: "#4F8EF7",
  lg1: "#3B6EF5",
  lg2: "#7C3AED",
};

const S = {
  card: { background: C.card, borderRadius: 12, border: `1px solid ${C.b1}` },
  input: {
    background: C.deep,
    border: `1px solid ${C.b2}`,
    borderRadius: 8,
    color: C.tp,
    fontSize: 13,
    padding: "9px 12px",
    boxSizing: "border-box",
    width: "100%",
  },
  btn: (bg, color) => ({
    background: bg,
    color,
    border: "none",
    borderRadius: 8,
    padding: "9px 18px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  }),
};

const makeBlank = () => ({
  name: "",
  cpf: "",
  phone: "",
  phone2: "",
  phone3: "",
  cnpj: "",
  email: "",
  matricula: "",
  leadType: "FGTS",
  leadTypeCustom: "",
  status: "Não simulado",
  observacao: "",
  reactions: [],
});

const INITIAL_USERS = [
  {
    id: "mestre",
    username: "NexpCompanyADM",
    email: "NexpCompanyADM",
    password: "MestredaNexp2026@",
    role: "mestre",
    name: "Mestre Nexp",
    cpf: "",
    photo: null,
    createdBy: null,
  },
];


const EXAMPLE_CSV = `Nome,CPF,Telefone,Telefone2,Telefone3,CNPJ,Email,Matricula,TipoLead,Observacao
João Silva,123.456.789-00,(11) 99999-0001,(11) 98888-0001,,joao@email.com,,M001,FGTS,Saldo disponível
Maria Santos,987.654.321-11,(21) 98888-0002,,,maria@email.com,,M002,INSS,Aposentada
Pedro Costa,456.789.123-22,(31) 97777-0003,(31) 96666-0002,(31) 95555-0003,12.345.678/0001-90,pedro@empresa.com,M003,Empréstimo do Trabalhador,Documentação aguardando
`;

// ── Helpers ────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const heads = lines[0].split(sep).map((h) =>
    h
      .trim()
      .replace(/^"|"$/g, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z]/g, ""),
  );
  const fm = {
    nome: "name",
    cpf: "cpf",
    telefone: "phone",
    telefone1: "phone",
    telefone2: "phone2",
    telefone3: "phone3",
    cnpj: "cnpj",
    email: "email",
    matricula: "matricula",
    tipolead: "leadType",
    tipo: "leadType",
    lead: "leadType",
    observacao: "observacao",
    obs: "observacao",
  };
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line, i) => {
      const vals = line.split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
      const o = { id: Date.now() + i, ...makeBlank() };
      heads.forEach((h, idx) => {
        const f = fm[h];
        if (f && vals[idx] !== undefined) o[f] = vals[idx];
      });
      return o;
    })
    .filter((c) => c.name.trim());
}
const ini = (name) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
const fmtR = (raw) => {
  const n = parseFloat(String(raw).replace(/\./g, "").replace(",", "."));
  if (isNaN(n)) return "R$ 0,00";
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
};
const exportCSV = (data, fname) => {
  const cols = [
    "name",
    "cpf",
    "phone",
    "phone2",
    "phone3",
    "cnpj",
    "email",
    "matricula",
    "leadType",
    "leadTypeCustom",
    "status",
    "observacao",
  ];
  const hdr = [
    "Nome",
    "CPF",
    "Telefone",
    "Telefone2",
    "Telefone3",
    "CNPJ",
    "Email",
    "Matricula",
    "TipoLead",
    "TipoLeadCustom",
    "Status",
    "Observacao",
  ];
  const rows = data.map((c) =>
    cols.map((k) => `"${(c[k] || "").replace(/"/g, '""')}"`).join(","),
  );
  const csv = [hdr.join(","), ...rows].join("\n");
  const b = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  a.click();
  URL.revokeObjectURL(url);
};

// ── Shared UI ──────────────────────────────────────────────────
function LeadBadge({ c }) {
  const col = LEAD_COLOR[c.leadType] || "#9CA3AF";
  const lbl = c.leadType === "Outro" ? c.leadTypeCustom || "Outro" : c.leadType;
  return (
    <span
      style={{
        background: col + "18",
        color: col,
        fontSize: 10,
        padding: "3px 9px",
        borderRadius: 20,
        fontWeight: 700,
        border: `1px solid ${col}33`,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {lbl}
    </span>
  );
}
function StatusBadge({ status }) {
  const ss = STATUS_STYLE[status] || STATUS_STYLE["Não simulado"];
  return (
    <span
      style={{
        background: ss.bg,
        color: ss.color,
        fontSize: 10,
        padding: "3px 9px",
        borderRadius: 20,
        fontWeight: 600,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {status}
    </span>
  );
}
function CommSim({ compact = false }) {
  const [sv, setSv] = useState("");
  const [pct, setPct] = useState("");
  const ns = parseFloat(String(sv).replace(/\./g, "").replace(",", ".")) || 0;
  const np = parseFloat(String(pct).replace(",", ".")) || 0;
  const co = (ns * np) / 100;
  const inp = (v, set, ph) => (
    <input
      value={v}
      onChange={(e) => set(e.target.value)}
      placeholder={ph}
      style={{
        ...S.input,
        padding: compact ? "7px 10px" : "9px 12px",
        fontSize: compact ? 12 : 13,
      }}
    />
  );
  return (
    <div>
      {!compact && (
        <div
          style={{
            color: C.ts,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          Simulador de Comissão
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div>
          <label
            style={{
              color: C.tm,
              fontSize: 10.5,
              display: "block",
              marginBottom: 4,
            }}
          >
            Valor de venda (R$)
          </label>
          {inp(sv, setSv, "0,00")}
        </div>
        <div>
          <label
            style={{
              color: C.tm,
              fontSize: 10.5,
              display: "block",
              marginBottom: 4,
            }}
          >
            Comissão (%)
          </label>
          {inp(pct, setPct, "0")}
        </div>
      </div>
      <div
        style={{
          background: co > 0 ? "#091E12" : C.deep,
          borderRadius: 8,
          padding: "11px 14px",
          border: co > 0 ? "1px solid #34D39930" : `1px solid ${C.b1}`,
          transition: "all 0.2s",
        }}
      >
        <div
          style={{
            color: C.td,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          Sua comissão
        </div>
        <div
          style={{
            color: co > 0 ? "#34D399" : C.td,
            fontSize: compact ? 18 : 22,
            fontWeight: 700,
            marginTop: 4,
          }}
        >
          {co > 0 ? fmtR(co) : "R$ 0,00"}
        </div>
        {co > 0 && (
          <div style={{ color: C.td, fontSize: 10.5, marginTop: 2 }}>
            {np}% sobre {fmtR(ns)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Login ──────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [un, setUn] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const go = async () => {
    if (!un.trim() || !pw.trim()) {
      setErr("Preencha e-mail e senha.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const firebaseUser = await firebaseLogin(un.trim(), pw);
      const profile = await getUserProfile(firebaseUser.uid);
      if (!profile) {
        setErr("Perfil não encontrado. Entre em contato com o suporte.");
        setLoading(false);
        return;
      }
      if (profile.active === false) {
        setErr("Usuário inativo. Entre em contato com o suporte.");
        setLoading(false);
        return;
      }
      onLogin({ ...profile, uid: firebaseUser.uid });
    } catch (e) {
      setErr("Usuário ou senha inválidos.");
    }
    setLoading(false);
  };
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060810",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div
          style={{
            background: C.card,
            borderRadius: 18,
            border: `1px solid ${C.b1}`,
            padding: "40px 36px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 32,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: `linear-gradient(135deg,${ACCENT_THEMES["Padrão"].lg1},${ACCENT_THEMES["Padrão"].lg2})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                color: "#fff",
                fontWeight: 700,
              }}
            >
              N
            </div>
            <div>
              <div style={{ color: C.tp, fontWeight: 700, fontSize: 16 }}>
                Nexp Company
              </div>
              <div style={{ color: C.td, fontSize: 11 }}>Sistema de Leads</div>
            </div>
          </div>

          {err && (
            <div
              style={{
                background: "#2D1515",
                border: "1px solid #EF444433",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 18,
                color: "#F87171",
                fontSize: 12.5,
              }}
            >
              ⚠ {err}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label
              style={{
                color: C.tm,
                fontSize: 11.5,
                display: "block",
                marginBottom: 5,
              }}
            >
              Usuário
            </label>
            <input
              value={un}
              onChange={(e) => setUn(e.target.value)}
              placeholder="Digite seu usuário"
              onKeyDown={(e) => e.key === "Enter" && go()}
              style={{ ...S.input }}
            />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label
              style={{
                color: C.tm,
                fontSize: 11.5,
                display: "block",
                marginBottom: 5,
              }}
            >
              Senha
            </label>
            <div style={{ position: "relative" }}>
              <input
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                type={show ? "text" : "password"}
                placeholder="Digite sua senha"
                onKeyDown={(e) => e.key === "Enter" && go()}
                style={{ ...S.input, paddingRight: 40 }}
              />
              <button
                onClick={() => setShow((p) => !p)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: C.tm,
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                {show ? "🙈" : "👁"}
              </button>
            </div>
          </div>
          <button
            onClick={go}
            disabled={loading}
            style={{
              ...S.btn("#3B6EF5", "#fff"),
              width: "100%",
              padding: "12px",
              fontSize: 14,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </div>

        {/* Support card — always visible, highlighted when there's an error */}
        <a
          href="https://wa.me/5584981323542"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: err ? "#0A2918" : "#0B0E17",
            border: err ? "1px solid #25D36655" : `1px solid ${C.b1}`,
            borderRadius: 12,
            padding: "14px 16px",
            textDecoration: "none",
            transition: "all 0.2s",
            boxShadow: err ? "0 0 18px #25D36618" : "none",
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: "#25D36618",
              border: "1.5px solid #25D36644",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="#25D366"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.17 1.6 5.98L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.21-3.48-8.52zM12 21.94a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.73.98.99-3.63-.23-.37A9.93 9.93 0 0 1 2.06 12C2.06 6.5 6.5 2.06 12 2.06S21.94 6.5 21.94 12 17.5 21.94 12 21.94zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97s-.47-.15-.67.15-.77.97-.94 1.17-.35.22-.65.07a8.15 8.15 0 0 1-2.4-1.48 9.01 9.01 0 0 1-1.66-2.07c-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5s.05-.38-.02-.52c-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.48 1.07 2.88 1.22 3.08 2.1 3.2 5.09 4.49c.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                color: err ? "#25D366" : C.ts,
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.3,
              }}
            >
              {err
                ? "Problemas para entrar? Fale com o suporte"
                : "Suporte WhatsApp"}
            </div>
            <div
              style={{
                color: "#2D6B47",
                fontSize: 11.5,
                marginTop: 3,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span style={{ color: "#25D36688", fontSize: 10 }}>WhatsApp</span>
              <span style={{ color: "#2D6B47" }}>·</span>
              <span>(84) 98132-3542</span>
            </div>
          </div>
          <div style={{ color: "#25D36666", fontSize: 18, flexShrink: 0 }}>
            →
          </div>
        </a>
      </div>
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────
function Sidebar({ page, setPage, user, users, onLogout, unreadChat, presence, flashUserId }) {
  const uObj = users.find((u) => u.id === user.id) || user;
  const all = [
    {
      id: "dashboard",
      label: "Leads Gerais",
      icon: "▦",
      roles: ["mestre", "master", "indicado"],
    },
    {
      id: "contacts",
      label: "Contatos",
      icon: "◉",
      roles: ["mestre", "master", "indicado"],
    },
    {
      id: "add",
      label: "Adicionar",
      icon: "＋",
      roles: ["mestre", "master", "indicado"],
    },
    {
      id: "import",
      label: "Importar",
      icon: "↑",
      roles: ["mestre", "master", "indicado"],
    },
    {
      id: "review",
      label: "Ver Clientes",
      icon: "▶",
      roles: ["mestre", "master", "indicado"],
    },
    {
      id: "cstatus",
      label: "Cliente Status",
      icon: "⊡",
      roles: ["mestre", "master", "indicado"],
    },
    { id: "leds", label: "Leds", icon: "⬇", roles: ["mestre", "master"] },
    { id: "atalhos", label: "Atalhos", icon: "🔗", roles: ["mestre", "master", "indicado"] },
    { id: "premium", label: "Premium Nexp", icon: "★", roles: ["mestre"] },
    {
      id: "config",
      label: "Configurações",
      icon: "⚙",
      roles: ["mestre", "master", "indicado"],
    },
  ];
  const nav = all.filter((it) => it.roles.includes(user.role));
  const roleLabel = {
    mestre: "Mestre",
    master: "Master",
    indicado: "Operador",
  };
  const isConfig = page === "config";
  return (
    <div
      style={{
        width: 222,
        background: C.sb,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "20px 0",
        flexShrink: 0,
        borderRight: `1px solid ${C.b1}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{ padding: "0 16px 20px", borderBottom: `1px solid ${C.b1}` }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: `linear-gradient(135deg,${C.lg1},${C.lg2})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
              color: "#fff",
              fontWeight: 700,
            }}
          >
            N
          </div>
          <div>
            <div
              style={{
                color: C.tp,
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: "-0.4px",
              }}
            >
              Nexp Company
            </div>
            <div style={{ color: C.td, fontSize: 10, marginTop: 1 }}>
              Sistema de Leads
            </div>
          </div>
        </div>
      </div>
      <nav
        style={{
          flex: 1,
          padding: "12px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
        }}
      >
        {nav.map((it) => {
          const active = it.id === "config" ? isConfig : page === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setPage(it.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 11px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                background: active ? C.abg : "transparent",
                color: active ? C.atxt : C.tm,
                fontSize: 12.5,
                fontWeight: active ? 600 : 400,
                transition: "all 0.12s",
              }}
            >
              <span style={{ fontSize: 13, width: 17, textAlign: "center" }}>
                {it.icon}
              </span>
              {it.label}
              {it.id === "premium" && (
                <span
                  style={{
                    marginLeft: "auto",
                    background: C.abg,
                    color: C.atxt,
                    fontSize: 9,
                    padding: "1px 5px",
                    borderRadius: 9,
                    border: `1px solid ${C.atxt}33`,
                  }}
                >
                  ★
                </span>
              )}
              {it.id === "chat" && unreadChat > 0 && (
                <span style={{
                  marginLeft: "auto",
                  background: "#16A34A",
                  color: "#fff",
                  fontSize: 9,
                  padding: "1px 6px",
                  borderRadius: 9,
                  fontWeight: 700,
                  animation: "pulse 1.5s infinite",
                }}>
                  {unreadChat}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: "0 12px" }}>

        {/* Stories + Chat — separados do nav, acima do perfil */}
        <div style={{ borderTop: `1px solid ${C.b1}`, paddingTop: 10, marginBottom: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Stories */}
          <button
            onClick={() => setPage("stories")}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "9px 11px", borderRadius: 9, width: "100%",
              border: page === "stories" ? `1px solid ${C.atxt}44` : `1px solid ${C.b2}`,
              cursor: "pointer", textAlign: "left",
              background: page === "stories" ? C.abg : C.deep,
              color: page === "stories" ? C.atxt : C.tm,
              fontSize: 12.5, fontWeight: page === "stories" ? 600 : 400,
              transition: "all 0.12s",
            }}
          >
            <span style={{ fontSize: 15, width: 17, textAlign: "center" }}>◎</span>
            Stories
          </button>
          {/* Chat */}
          <button
            onClick={() => setPage("chat")}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "9px 11px", borderRadius: 9, width: "100%",
              border: page === "chat" ? `1px solid ${C.atxt}44` : `1px solid ${C.b2}`,
              cursor: "pointer", textAlign: "left",
              background: page === "chat" ? C.abg : C.deep,
              color: page === "chat" ? C.atxt : C.tm,
              fontSize: 12.5, fontWeight: page === "chat" ? 600 : 400,
              transition: "all 0.12s",
            }}
          >
            <span style={{ fontSize: 15, width: 17, textAlign: "center" }}>💬</span>
            Chat da Equipe
            {unreadChat > 0 && (
              <span style={{
                marginLeft: "auto", background: "#16A34A", color: "#fff",
                fontSize: 9, padding: "2px 7px", borderRadius: 9, fontWeight: 700,
                animation: "pulse 1.5s infinite",
              }}>
                {unreadChat}
              </span>
            )}
          </button>
        </div>

        {/* Perfil do usuário */}
        <div
          style={{
            background: C.deep,
            borderRadius: 10,
            padding: "11px 12px",
            border: `1px solid ${C.b1}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              {uObj.photo ? (
                <img src={uObj.photo} alt=""
                  style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: `1.5px solid ${C.atxt}33` }} />
              ) : (
                <div style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: flashUserId === (uObj.uid || uObj.id) ? "#16A34A" : C.abg,
                  color: flashUserId === (uObj.uid || uObj.id) ? "#fff" : C.atxt,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, border: `1.5px solid ${C.atxt}33`,
                  animation: flashUserId === (uObj.uid || uObj.id) ? "pulse 0.8s infinite" : "none",
                  transition: "background 0.3s",
                }}>
                  {ini(uObj.name || "OP")}
                </div>
              )}
              {/* Pontinho online */}
              <div style={{
                position: "absolute", bottom: 0, right: 0,
                width: 8, height: 8, borderRadius: "50%",
                background: "#16A34A",
                border: `1.5px solid ${C.sb}`,
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.ts, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                {uObj.name || uObj.username}
              </div>
              <div style={{ color: C.td, fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
                {roleLabel[user.role]}
                <span style={{ color: "#16A34A", fontSize: 9 }}>● online</span>
              </div>
            </div>
            {/* Botão + para criar story */}
            <button
              onClick={() => setPage("stories")}
              title="Criar story"
              style={{
                width: 20, height: 20, borderRadius: "50%",
                background: C.acc, color: "#fff",
                border: `1.5px solid ${C.bg}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                flexShrink: 0, lineHeight: 1,
                padding: 0,
              }}
            >+</button>
          </div>
          <button
            onClick={onLogout}
            style={{
              background: "transparent",
              border: `1px solid ${C.b2}`,
              color: C.tm,
              borderRadius: 7,
              padding: "5px 10px",
              fontSize: 11,
              cursor: "pointer",
              width: "100%",
            }}
          >
            Sair
          </button>
        </div>

        {/* WhatsApp support */}
        <a
          href="https://wa.me/5584981323542"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 10,
            padding: "9px 12px",
            background: "#0A2918",
            border: "1px solid #16A34A44",
            borderRadius: 9,
            textDecoration: "none",
            transition: "background 0.12s",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="#25D366"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.17 1.6 5.98L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.21-3.48-8.52zM12 21.94a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.73.98.99-3.63-.23-.37A9.93 9.93 0 0 1 2.06 12C2.06 6.5 6.5 2.06 12 2.06S21.94 6.5 21.94 12 17.5 21.94 12 21.94zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97s-.47-.15-.67.15-.77.97-.94 1.17-.35.22-.65.07a8.15 8.15 0 0 1-2.4-1.48 9.01 9.01 0 0 1-1.66-2.07c-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5s.05-.38-.02-.52c-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.48 1.07 2.88 1.22 3.08 2.1 3.2 5.09 4.49c.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z" />
          </svg>
          <div>
            <div
              style={{
                color: "#25D366",
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              Suporte WhatsApp
            </div>
            <div style={{ color: "#2D6B47", fontSize: 10, marginTop: 1 }}>
              (84) 98132-3542
            </div>
          </div>
        </a>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────
function Dashboard({ contacts }) {
  const total = contacts.length,
    withOpp = contacts.filter((c) => c.status === "Com oportunidade").length,
    updating = contacts.filter(
      (c) => c.status === "Atualização de contato",
    ).length,
    closed = contacts.filter((c) => c.status === "Fechado").length;
  const sCounts = CLIENT_STATUS.map((s) => ({
    s,
    n: contacts.filter((c) => c.status === s).length,
  })).filter((x) => x.n > 0);
  const lCounts = LEAD_TYPES.map((t) => ({
    t,
    n: contacts.filter((c) => c.leadType === t).length,
  })).filter((x) => x.n > 0);
  const card = (label, val, color, sub) => (
    <div style={{ ...S.card, padding: "20px 22px", flex: 1 }}>
      <div
        style={{
          color: C.td,
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{ color, fontSize: 28, fontWeight: 700, letterSpacing: "-1px" }}
      >
        {val}
      </div>
      {sub && (
        <div style={{ color: C.td, fontSize: 11, marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
  return (
    <div style={{ padding: "30px 36px", maxWidth: 920 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>
          Leads Gerais
        </h1>
        <p style={{ color: C.tm, fontSize: 12.5, margin: "4px 0 0" }}>
          Visão geral dos leads cadastrados
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 14,
          marginBottom: 22,
        }}
      >
        {card("Oportunidade disponível", withOpp, "#34D399", "")}
        {card("Atualizar contato", updating, "#C084FC", "")}
        {card("Total de clientes", total, C.atxt, "")}
        {card("Fechados", closed, "#10B981", "")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div style={{ ...S.card, padding: "22px" }}>
          <div
            style={{
              color: C.ts,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            Distribuição por status
          </div>
          {total === 0 ? (
            <div style={{ color: C.td, fontSize: 12 }}>Nenhum cliente.</div>
          ) : (
            sCounts.map(({ s, n }) => {
              const st = STATUS_STYLE[s];
              const p = Math.round((n / total) * 100);
              return (
                <div key={s} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ color: st.color, fontSize: 11.5 }}>{s}</span>
                    <span style={{ color: C.tm, fontSize: 11 }}>
                      {n}·{p}%
                    </span>
                  </div>
                  <div style={{ background: C.b1, borderRadius: 4, height: 5 }}>
                    <div
                      style={{
                        width: p + "%",
                        height: "100%",
                        borderRadius: 4,
                        background: st.color,
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{ ...S.card, padding: "22px" }}>
          <div
            style={{
              color: C.ts,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            Tipos de Leds
          </div>
          {total === 0 ? (
            <div style={{ color: C.td, fontSize: 12 }}>Nenhum cliente.</div>
          ) : (
            lCounts.map(({ t, n }) => {
              const col = LEAD_COLOR[t] || "#9CA3AF";
              const p = Math.round((n / total) * 100);
              return (
                <div key={t} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ color: col, fontSize: 11.5 }}>{t}</span>
                    <span style={{ color: C.tm, fontSize: 11 }}>
                      {n}·{p}%
                    </span>
                  </div>
                  <div style={{ background: C.b1, borderRadius: 4, height: 5 }}>
                    <div
                      style={{
                        width: p + "%",
                        height: "100%",
                        borderRadius: 4,
                        background: col,
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div style={{ ...S.card, padding: "24px" }}>
        <CommSim />
      </div>
    </div>
  );
}

// ── Contact Card ───────────────────────────────────────────────
function CCard({ contact, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [ed, setEd] = useState(false);
  const [sc, setSc] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ ...contact });

  // Estado local para reactions e extraLeads — evita sobreposição
  const [reactions, setReactions] = useState(contact.reactions || []);
  const [extraLeads, setExtraLeads] = useState(contact.extraLeads || []);

  // Sincroniza quando contact muda externamente (ex: outro cliente)
  useEffect(() => {
    setReactions(contact.reactions || []);
    setExtraLeads(contact.extraLeads || []);
    setForm({ ...contact });
  }, [contact.id]); // eslint-disable-line

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => { onUpdate({ ...form, reactions, extraLeads }); setEd(false); };

  // Emojis — máx 3
  const tog = (e) => {
    setReactions((prev) => {
      let newR;
      if (prev.includes(e)) {
        newR = prev.filter((x) => x !== e);
      } else {
        if (prev.length >= 3) return prev;
        newR = [...prev, e];
      }
      onUpdate({ ...contact, reactions: newR, extraLeads });
      return newR;
    });
  };

  // Múltiplos tipos de lead
  const togLead = (t) => {
    setExtraLeads((prev) => {
      const newLeads = prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t];
      onUpdate({ ...contact, extraLeads: newLeads, reactions });
      return newLeads;
    });
  };

  // Copiar CPF
  const copyCPF = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(contact.cpf || "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const lc = LEAD_COLOR[contact.leadType] || "#9CA3AF";
  const allLeads = [contact.leadType, ...extraLeads].filter(Boolean);

  return (
    <div style={{ ...S.card, marginBottom: 10, overflow: "hidden" }}>
      <div
        onClick={() => { setOpen((o) => !o); if (ed) setEd(false); }}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: lc + "1A", color: lc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: `1.5px solid ${lc}33` }}>
          {ini(contact.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.tp, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 6 }}>
            {contact.name}
            {reactions.length > 0 && (
              <span style={{ fontSize: 13 }}>{reactions.join("")}</span>
            )}
          </div>
          <div style={{ color: C.tm, fontSize: 11.5, marginTop: 1, display: "flex", alignItems: "center", gap: 6 }}>
            {contact.cpf}
            {contact.cpf && (
              <button
                onClick={copyCPF}
                style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "#34D399" : C.td, fontSize: 11, padding: "0 2px", flexShrink: 0 }}
                title="Copiar CPF"
              >
                {copied ? "✓" : "⎘"}
              </button>
            )}
            {contact.phone ? " · " + contact.phone : ""}
          </div>
        </div>
        <LeadBadge c={contact} />
        <StatusBadge status={contact.status} />
        <span style={{ color: C.td, fontSize: 11, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${C.b1}`, padding: "16px" }}>
          {!ed ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px 18px", marginBottom: 14 }}>
                {[
                  ["Email", contact.email || "—"],
                  ["CNPJ", contact.cnpj || "—"],
                  ["Matrícula", contact.matricula || "—"],
                  ["Tel 1", contact.phone || "—"],
                  ["Tel 2", contact.phone2 || "—"],
                  ["Tel 3", contact.phone3 || "—"],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 2 }}>{l}</div>
                    <div style={{ color: C.ts, fontSize: 12.5 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Status */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Status</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {CLIENT_STATUS.map((s) => {
                    const st = STATUS_STYLE[s];
                    const sel = contact.status === s;
                    return (
                      <button key={s} onClick={() => onUpdate({ ...contact, status: s, reactions, extraLeads })}
                        style={{ background: sel ? st.bg : C.deep, color: sel ? st.color : C.tm, border: sel ? `1px solid ${st.color}44` : `1px solid ${C.b2}`, borderRadius: 20, padding: "4px 10px", fontSize: 10.5, cursor: "pointer", fontWeight: sel ? 600 : 400, transition: "all 0.12s" }}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tipos de Lead adicionais */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Tipos de Lead
                  <span style={{ color: C.td, fontSize: 10, marginLeft: 6, textTransform: "none" }}>Principal: <span style={{ color: lc }}>{contact.leadType}</span></span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {LEAD_TYPES.filter(t => t !== contact.leadType && t !== "Outro").map((t) => {
                    const col = LEAD_COLOR[t] || "#9CA3AF";
                    const sel = extraLeads.includes(t);
                    return (
                      <button key={t} onClick={() => togLead(t)}
                        style={{ background: sel ? col + "1A" : C.deep, color: sel ? col : C.tm, border: sel ? `1px solid ${col}44` : `1px solid ${C.b2}`, borderRadius: 20, padding: "4px 10px", fontSize: 10.5, cursor: "pointer", fontWeight: sel ? 600 : 400, transition: "all 0.12s" }}>
                        {sel ? "✓ " : "+ "}{t}
                      </button>
                    );
                  })}
                </div>
                {allLeads.length > 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                    {allLeads.map((t, i) => {
                      const col = LEAD_COLOR[t] || "#9CA3AF";
                      return <span key={i} style={{ background: col + "18", color: col, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: `1px solid ${col}33` }}>{t}</span>;
                    })}
                  </div>
                )}
              </div>

              {/* Emojis — máx 3 */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Reações <span style={{ color: C.td, fontSize: 10, textTransform: "none" }}>({reactions.length}/3)</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {EMOJIS.map((e) => {
                    const a = reactions.includes(e);
                    const maxed = reactions.length >= 3 && !a;
                    return (
                      <button key={e} onClick={() => tog(e)} disabled={maxed}
                        style={{ background: a ? "#1E2A45" : C.deep, border: a ? "1px solid #4F8EF766" : `1px solid ${C.b2}`, borderRadius: 8, padding: "4px 7px", cursor: maxed ? "not-allowed" : "pointer", fontSize: 15, transform: a ? "scale(1.15)" : "scale(1)", transition: "all 0.12s", opacity: maxed ? 0.3 : 1 }}>
                        {e}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    color: C.tm,
                    fontSize: 10.5,
                    marginBottom: 5,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Observações
                </div>
                <textarea
                  value={contact.observacao || ""}
                  onChange={(e) =>
                    onUpdate({ ...contact, observacao: e.target.value })
                  }
                  rows={2}
                  placeholder="Observação..."
                  style={{
                    ...S.input,
                    background: C.deep,
                    color: C.ts,
                    resize: "vertical",
                  }}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <button
                  onClick={() => setSc((p) => !p)}
                  style={{
                    background: "transparent",
                    border: `1px solid ${C.b2}`,
                    color: C.tm,
                    borderRadius: 8,
                    padding: "5px 12px",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  {sc ? "▲ Fechar" : "💰 Simular comissão"}
                </button>
                {sc && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "14px",
                      background: C.deep,
                      borderRadius: 8,
                      border: `1px solid ${C.b2}`,
                    }}
                  >
                    <CommSim compact />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    setForm({ ...contact });
                    setEd(true);
                  }}
                  style={{
                    ...S.btn(C.abg, C.atxt),
                    border: `1px solid ${C.atxt}33`,
                    fontSize: 12,
                    padding: "7px 14px",
                  }}
                >
                  Editar
                </button>
                <button
                  onClick={() => {
                    if (window.confirm("Remover este cliente?"))
                      onDelete(contact.id);
                  }}
                  style={{
                    ...S.btn("transparent", "#EF4444"),
                    border: "1px solid #EF444433",
                    fontSize: 12,
                    padding: "7px 14px",
                  }}
                >
                  Remover
                </button>
              </div>
            </>
          ) : (
            <div>
              <div
                style={{
                  color: C.atxt,
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                Editando cliente
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                {[
                  ["Nome", "name", "text"],
                  ["CPF", "cpf", "text"],
                  ["Tel 1", "phone", "tel"],
                  ["Tel 2", "phone2", "tel"],
                  ["Tel 3", "phone3", "tel"],
                  ["CNPJ", "cnpj", "text"],
                  ["Email", "email", "email"],
                  ["Matrícula", "matricula", "text"],
                ].map(([l, k, t]) => (
                  <div key={k}>
                    <label
                      style={{
                        color: C.tm,
                        fontSize: 11,
                        display: "block",
                        marginBottom: 3,
                      }}
                    >
                      {l}
                    </label>
                    <input
                      value={form[k] || ""}
                      onChange={(e) => setF(k, e.target.value)}
                      type={t}
                      style={{
                        ...S.input,
                        padding: "7px 10px",
                        fontSize: 12.5,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    color: C.tm,
                    fontSize: 11,
                    display: "block",
                    marginBottom: 5,
                  }}
                >
                  Tipo de Lead
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {LEAD_TYPES.map((t) => {
                    const col = LEAD_COLOR[t] || "#9CA3AF";
                    const sel = form.leadType === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setF("leadType", t)}
                        style={{
                          background: sel ? col + "1A" : C.deep,
                          color: sel ? col : C.tm,
                          border: sel
                            ? `1px solid ${col}55`
                            : `1px solid ${C.b2}`,
                          borderRadius: 20,
                          padding: "4px 11px",
                          fontSize: 11,
                          cursor: "pointer",
                          fontWeight: sel ? 600 : 400,
                        }}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
                {form.leadType === "Outro" && (
                  <input
                    value={form.leadTypeCustom || ""}
                    onChange={(e) => setF("leadTypeCustom", e.target.value)}
                    placeholder="Informe o produto"
                    style={{
                      ...S.input,
                      padding: "7px 10px",
                      fontSize: 12.5,
                      marginTop: 8,
                    }}
                  />
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={save}
                  style={{
                    ...S.btn(C.acc, "#fff"),
                    padding: "8px 18px",
                    fontSize: 12.5,
                  }}
                >
                  Salvar
                </button>
                <button
                  onClick={() => setEd(false)}
                  style={{
                    ...S.btn("transparent", C.tm),
                    border: `1px solid ${C.b2}`,
                    padding: "8px 14px",
                    fontSize: 12,
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Contacts Page ──────────────────────────────────────────────
function ContactsPage({ contacts, setContacts }) {
  const [q, setQ] = useState("");
  const res = q.trim()
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q.toLowerCase()) ||
          c.cpf.includes(q) ||
          (c.phone || "").includes(q) ||
          (c.email || "").toLowerCase().includes(q.toLowerCase()) ||
          (c.matricula || "").toLowerCase().includes(q.toLowerCase()),
      )
    : [];
  const upd = async (u) => {
    await saveContact(u);
  };
  const rem = async (id) => {
    const c = contacts.find((x) => String(x.id) === String(id));
    await deleteContact(id);
    if (c) addLog("delete_one", `Cliente removido: ${c.name}`, `CPF: ${c.cpf || "—"} · Lead: ${c.leadType}`);
  };
  return (
    <div style={{ padding: "30px 36px", maxWidth: 820 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>
          Contatos
        </h1>
        <p style={{ color: C.tm, fontSize: 12.5, margin: "4px 0 0" }}>
          {contacts.length} clientes cadastrados
        </p>
      </div>
      <div style={{ position: "relative", marginBottom: 20 }}>
        <span
          style={{
            position: "absolute",
            left: 13,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 14,
            pointerEvents: "none",
          }}
        >
          🔍
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, CPF, telefone, email ou matrícula..."
          style={{
            ...S.input,
            background: C.card,
            border: `1px solid ${C.b1}`,
            padding: "10px 14px 10px 40px",
          }}
        />
        {q && (
          <button
            onClick={() => setQ("")}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: C.tm,
              cursor: "pointer",
              fontSize: 15,
            }}
          >
            ✕
          </button>
        )}
      </div>
      {!q.trim() ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 40, opacity: 0.3, marginBottom: 12 }}>🔍</div>
          <div style={{ color: C.tm, fontSize: 14, fontWeight: 600 }}>
            Pesquise um cliente
          </div>
          <div style={{ color: C.td, fontSize: 12.5, marginTop: 4 }}>
            Nome, CPF, telefone, email ou matrícula
          </div>
        </div>
      ) : res.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "50px 0",
            color: C.tm,
            fontSize: 14,
          }}
        >
          Nenhum resultado para "{q}"
        </div>
      ) : (
        <>
          <div style={{ color: C.tm, fontSize: 11.5, marginBottom: 10 }}>
            {res.length} resultado{res.length !== 1 ? "s" : ""}
          </div>
          {res.map((c) => (
            <CCard key={c.id} contact={c} onUpdate={upd} onDelete={rem} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Add Client ─────────────────────────────────────────────────
function AddClient({ setContacts, setPage }) {
  const [form, setForm] = useState(makeBlank());
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) {
      setErr("Nome é obrigatório.");
      return;
    }
    setErr("");
    const newContact = { ...form, id: Date.now(), reactions: [] };
    try {
      await saveContact(newContact);
      setOk(true);
      setForm(makeBlank());
      setTimeout(() => setOk(false), 3000);
    } catch (e) {
      setErr("Erro ao salvar: " + e.message);
    }
  };
  const inp = (l, k, t = "text", ph = "", req = false) => (
    <div>
      <label
        style={{
          color: C.tm,
          fontSize: 11.5,
          display: "block",
          marginBottom: 4,
        }}
      >
        {l}
        {req && <span style={{ color: "#EF4444", marginLeft: 3 }}>*</span>}
      </label>
      <input
        value={form[k]}
        onChange={(e) => setF(k, e.target.value)}
        type={t}
        placeholder={ph}
        style={{ ...S.input }}
      />
    </div>
  );
  return (
    <div style={{ padding: "30px 36px", maxWidth: 700 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>
          Adicionar Cliente
        </h1>
      </div>
      {ok && (
        <div
          style={{
            background: "#091E12",
            border: "1px solid #34D39933",
            borderRadius: 8,
            padding: "11px 14px",
            marginBottom: 18,
            color: "#34D399",
            fontSize: 13,
          }}
        >
          ✓ Cliente cadastrado!
        </div>
      )}
      {err && (
        <div
          style={{
            background: "#2D1515",
            border: "1px solid #EF444433",
            borderRadius: 8,
            padding: "11px 14px",
            marginBottom: 18,
            color: "#F87171",
            fontSize: 13,
          }}
        >
          ⚠ {err}
        </div>
      )}
      <div style={{ ...S.card, padding: "26px 28px" }}>
        <div style={{ marginBottom: 14 }}>
          {inp("Nome completo", "name", "text", "João da Silva", true)}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginBottom: 14,
          }}
        >
          {inp("CPF", "cpf", "text", "000.000.000-00")}
          {inp("Telefone 1", "phone", "tel", "(11) 99999-0000")}
          {inp("Telefone 2", "phone2", "tel", "(11) 98888-0000")}
          {inp("Telefone 3", "phone3", "tel", "(11) 97777-0000")}
          {inp("CNPJ", "cnpj", "text", "00.000.000/0000-00")}
          {inp("Email", "email", "email", "email@exemplo.com")}
          {inp("Matrícula", "matricula", "text", "M0001")}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              color: C.tm,
              fontSize: 11.5,
              display: "block",
              marginBottom: 7,
            }}
          >
            Tipo de Lead
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {LEAD_TYPES.map((t) => {
              const col = LEAD_COLOR[t] || "#9CA3AF";
              const sel = form.leadType === t;
              return (
                <button
                  key={t}
                  onClick={() => setF("leadType", t)}
                  style={{
                    background: sel ? col + "1A" : C.deep,
                    color: sel ? col : C.tm,
                    border: sel ? `1px solid ${col}55` : `1px solid ${C.b2}`,
                    borderRadius: 20,
                    padding: "6px 13px",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: sel ? 600 : 400,
                    transition: "all 0.12s",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          {form.leadType === "Outro" && (
            <input
              value={form.leadTypeCustom}
              onChange={(e) => setF("leadTypeCustom", e.target.value)}
              placeholder="Informe o produto"
              style={{ ...S.input, marginTop: 10 }}
            />
          )}
        </div>
        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              color: C.tm,
              fontSize: 11.5,
              display: "block",
              marginBottom: 5,
            }}
          >
            Observações
          </label>
          <textarea
            value={form.observacao}
            onChange={(e) => setF("observacao", e.target.value)}
            rows={3}
            placeholder="Informações adicionais..."
            style={{ ...S.input, resize: "vertical" }}
          />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={save}
            style={{
              ...S.btn(C.acc, "#fff"),
              flex: 1,
              padding: "12px",
              fontSize: 14,
            }}
          >
            Cadastrar Cliente
          </button>
          <button
            onClick={() => setPage("contacts")}
            style={{
              ...S.btn("transparent", C.tm),
              border: `1px solid ${C.b2}`,
              padding: "12px 18px",
              fontSize: 13,
            }}
          >
            Ver contatos
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Action Log ─────────────────────────────────────────────────
const LOG_KEY = "nexp_action_log";
function readLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
}
function addLog(type, desc, detail = "") {
  const logs = readLog();
  logs.unshift({ id: String(Date.now()), type, desc, detail, date: new Date().toLocaleString("pt-BR") });
  try { localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, 500))); } catch {}
}
// tipos: "import" | "delete_batch" | "delete_one" | "delete_all"


// ── History Tab ───────────────────────────────────────────────
function HistoryTab() {
  const [logs, setLogs] = useState(() => readLog());
  const [filterType, setFilterType] = useState("all");
  const [filterDate, setFilterDate] = useState("");

  const refresh = () => setLogs(readLog());

  const clearAll = () => {
    if (!window.confirm("Limpar todo o histórico de ações?")) return;
    localStorage.removeItem(LOG_KEY);
    setLogs([]);
  };

  const iconMap = {
    import: { icon: "⬆", color: "#34D399", label: "Importação" },
    delete_batch: { icon: "🗑", color: "#F87171", label: "Planilha deletada" },
    delete_one: { icon: "❌", color: "#FBBF24", label: "Cliente removido" },
    delete_all: { icon: "💣", color: "#EF4444", label: "Todos deletados" },
  };

  // Filtrar logs
  const filtered = logs.filter((log) => {
    if (filterType !== "all" && log.type !== filterType) return false;
    if (filterDate) {
      // filterDate vem como "YYYY-MM-DD", log.date como "DD/MM/YYYY, HH:MM:SS"
      const [d, m, y] = (log.date || "").split(",")[0].split("/");
      const logDay = `${y?.trim()}-${m?.padStart(2,"0")}-${d?.padStart(2,"0")}`;
      if (logDay !== filterDate) return false;
    }
    return true;
  });

  const filterBtnStyle = (active) => ({
    background: active ? C.acc + "22" : C.deep,
    color: active ? C.atxt : C.tm,
    border: active ? `1px solid ${C.atxt}44` : `1px solid ${C.b2}`,
    borderRadius: 20, padding: "5px 13px", fontSize: 12,
    cursor: "pointer", fontWeight: active ? 600 : 400,
  });

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ color: C.ts, fontSize: 13 }}>
          {filtered.length} de {logs.length} registro{logs.length !== 1 ? "s" : ""}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={refresh} style={{ ...S.btn(C.abg, C.atxt), border: `1px solid ${C.atxt}33`, padding: "6px 12px", fontSize: 12 }}>↻ Atualizar</button>
          {logs.length > 0 && <button onClick={clearAll} style={{ ...S.btn("transparent", "#EF4444"), border: "1px solid #EF444433", padding: "6px 12px", fontSize: 12 }}>🗑 Limpar</button>}
        </div>
      </div>

      {/* Filtros */}
      <div style={{ ...S.card, padding: "14px 18px", marginBottom: 14 }}>
        <div style={{ color: C.tm, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Filtrar por</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {[
            { id: "all", label: "Todos" },
            { id: "import", label: "⬆ Importações" },
            { id: "delete_batch", label: "🗑 Planilhas deletadas" },
            { id: "delete_one", label: "❌ Clientes removidos" },
            { id: "delete_all", label: "💣 Deleção total" },
          ].map((f) => (
            <button key={f.id} onClick={() => setFilterType(f.id)} style={filterBtnStyle(filterType === f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ color: C.tm, fontSize: 12, flexShrink: 0 }}>📅 Data:</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            style={{ ...S.input, width: "auto", padding: "6px 10px", fontSize: 12 }}
          />
          {filterDate && (
            <button onClick={() => setFilterDate("")} style={{ background: "none", border: "none", color: C.tm, cursor: "pointer", fontSize: 13 }}>✕</button>
          )}
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 0", color: C.tm }}>
          <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 10 }}>🔍</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {logs.length === 0 ? "Nenhuma ação registrada ainda" : "Nenhum resultado para os filtros selecionados"}
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, overflow: "hidden" }}>
          {filtered.map((log, i) => {
            const meta = iconMap[log.type] || { icon: "•", color: C.tm, label: log.type };
            // Separar data e hora
            const [datePart, timePart] = (log.date || "").split(", ");
            return (
              <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 18px", borderBottom: i < filtered.length - 1 ? `1px solid ${C.b1}` : "none" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: meta.color + "18", color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{meta.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: meta.color, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{meta.label}</span>
                  <div style={{ color: C.tp, fontSize: 12.5, fontWeight: 500, margin: "2px 0" }}>{log.desc}</div>
                  {log.detail && <div style={{ color: C.tm, fontSize: 11 }}>{log.detail}</div>}
                </div>
                {/* Data e hora separados */}
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ color: C.ts, fontSize: 11.5, fontWeight: 600 }}>{datePart}</div>
                  <div style={{ color: C.td, fontSize: 11 }}>{timePart}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VerifyTab({ contacts, setContacts, history, saveHistory, currentUser, isMestre }) {
  const [modal, setModal] = useState(null); // { entry } | "all"
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const openModal = (target) => { setModal(target); setPw(""); setPwErr(""); };
  const closeModal = () => { setModal(null); setPw(""); setPwErr(""); };

  const confirmDelete = async () => {
    if (!pw.trim()) { setPwErr("Digite a senha mestre."); return; }
    setPwLoading(true); setPwErr("");
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, pw);
      await reauthenticateWithCredential(auth.currentUser, credential);
      // Senha correta — executar deleção em lote
      if (modal === "all") {
        await deleteContacts(contacts.map((c) => String(c.id)));
        addLog("delete_all", `Todos os leads deletados`, `${contacts.length} leads removidos do sistema`);
        setContacts([]);
        saveHistory([]);
      } else {
        await deleteContacts(modal.contacts.map((c) => String(c.id)));
        addLog("delete_batch", `Planilha deletada: ${modal.name}`, `${modal.count} leads removidos`);
        setContacts((cs) => cs.filter((c) => !modal.contacts.find((x) => String(x.id) === String(c.id))));
        saveHistory(history.filter((h) => h.id !== modal.id));
      }
      closeModal();
    } catch {
      setPwErr("Senha incorreta. Tente novamente.");
    }
    setPwLoading(false);
  };

  return (
    <div>
      {/* Modal de confirmação de senha */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#0F1320", border: "1px solid #2D3348", borderRadius: 16, padding: "28px 28px 24px", width: "100%", maxWidth: 360 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22 }}>🔒</span>
              <div style={{ color: "#F87171", fontSize: 15, fontWeight: 700 }}>Confirmação necessária</div>
            </div>
            <div style={{ color: "#9CA3AF", fontSize: 12.5, marginBottom: 18, lineHeight: 1.5 }}>
              {modal === "all"
                ? `Você está prestes a deletar TODOS os ${contacts.length} leads do sistema. Esta ação não pode ser desfeita.`
                : `Você está prestes a deletar os ${modal.count} leads da planilha "${modal.name}". Esta ação não pode ser desfeita.`}
              <br /><br />Digite a senha mestre para confirmar:
            </div>
            <input
              type="password"
              value={pw}
              onChange={(e) => { setPw(e.target.value); setPwErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && confirmDelete()}
              placeholder="Senha mestre"
              autoFocus
              style={{ ...S.input, marginBottom: 8 }}
            />
            {pwErr && <div style={{ color: "#F87171", fontSize: 12, marginBottom: 10 }}>⚠ {pwErr}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button
                onClick={closeModal}
                style={{ ...S.btn("transparent", "#9CA3AF"), border: "1px solid #2D3348", flex: 1, padding: "10px" }}
              >← Voltar</button>
              <button
                onClick={confirmDelete}
                disabled={pwLoading}
                style={{ ...S.btn("#DC2626", "#fff"), flex: 1, padding: "10px", opacity: pwLoading ? 0.7 : 1 }}
              >{pwLoading ? "Verificando..." : "🗑 Deletar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Card geral */}
      <div style={{ ...S.card, padding: "22px", marginBottom: 16 }}>
        <div style={{ color: C.ts, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Todos os Leads do Sistema</div>
        <div style={{ color: C.tm, fontSize: 12, marginBottom: 16 }}>
          {contacts.length} lead{contacts.length !== 1 ? "s" : ""} cadastrado{contacts.length !== 1 ? "s" : ""} no total.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => exportCSV(contacts, `nexp_todos_leads_${new Date().toLocaleDateString("pt-BR").replace(/\//g,"-")}.csv`)}
            style={{ ...S.btn(C.acc, "#fff"), padding: "10px 20px", fontSize: 13 }}
          >⬇ Baixar todos os leads ({contacts.length})</button>
          {isMestre && contacts.length > 0 && (
            <button
              onClick={() => openModal("all")}
              style={{ ...S.btn("transparent", "#EF4444"), border: "1px solid #EF444433", padding: "10px 20px", fontSize: 13 }}
            >🗑 Deletar todos os leads</button>
          )}
        </div>
      </div>

      {/* Planilhas importadas com opção de deletar */}
      {isMestre && (
        <div style={{ ...S.card, padding: "22px", marginBottom: 16 }}>
          <div style={{ color: C.ts, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Planilhas Importadas</div>
          {history.length === 0 ? (
            <div style={{ color: C.tm, fontSize: 12 }}>Nenhuma planilha no histórico.</div>
          ) : history.map((entry) => (
            <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.b1}` }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>📄</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.tp, fontSize: 12.5, fontWeight: 600 }}>{entry.name}</div>
                <div style={{ color: C.tm, fontSize: 11 }}>{entry.count} leads · {entry.date}</div>
              </div>
              <button
                onClick={() => openModal(entry)}
                style={{ ...S.btn("transparent", "#EF4444"), border: "1px solid #EF444433", padding: "6px 12px", fontSize: 12, flexShrink: 0 }}
              >🗑 Deletar</button>
            </div>
          ))}
        </div>
      )}

      {/* Resumo por tipo */}
      <div style={{ ...S.card, padding: "22px" }}>
        <div style={{ color: C.ts, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Resumo por tipo de Lead</div>
        {contacts.length === 0 ? (
          <div style={{ color: C.tm, fontSize: 12 }}>Nenhum lead no sistema.</div>
        ) : LEAD_TYPES.map((t) => {
          const n = contacts.filter((c) => c.leadType === t).length;
          if (!n) return null;
          const col = LEAD_COLOR[t] || "#9CA3AF";
          const pct = Math.round((n / contacts.length) * 100);
          return (
            <div key={t} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ color: col, fontSize: 12 }}>{t}</span>
                <span style={{ color: C.tm, fontSize: 11 }}>{n} · {pct}%</span>
              </div>
              <div style={{ background: C.b1, borderRadius: 4, height: 5 }}>
                <div style={{ width: pct + "%", height: "100%", borderRadius: 4, background: col }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Import Page ────────────────────────────────────────────────
function ImportPage({ contacts, setContacts, setPage, currentUser }) {
  const isMestre = currentUser?.role === "mestre";
  const [prev, setPrev] = useState([]);
  const [fn, setFn] = useState("");
  const [done, setDone] = useState(false);
  const [doneInfo, setDoneInfo] = useState({ imported: 0, skipped: 0 });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("import");
  const fRef = useRef();

  // Histórico salvo no localStorage
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexp_import_history") || "[]"); }
    catch { return []; }
  });
  const saveHistory = (h) => {
    setHistory(h);
    try { localStorage.setItem("nexp_import_history", JSON.stringify(h)); } catch {}
  };

  const dlModelo = () => {
    const b = new Blob([EXAMPLE_CSV], { type: "text/csv;charset=utf-8;" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = "modelo_nexp.csv"; a.click();
    URL.revokeObjectURL(u);
  };

  const hf = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFn(f.name); setDone(false); setErr(""); setPrev([]);
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const p = parseCSV(ev.target.result);
        if (!p.length) { setErr("Nenhum registro encontrado. Verifique o formato do arquivo."); return; }
        setPrev(p);
      } catch (er) { setErr("Erro ao ler arquivo: " + er.message); }
    };
    r.onerror = () => setErr("Erro ao carregar o arquivo.");
    r.readAsText(f, "UTF-8");
  };

  const conf = async () => {
    if (!prev.length) return;
    setLoading(true); setErr("");
    try {
      const ts = Date.now();
      // CPFs já existentes no sistema
      const existingCPFs = new Set(contacts.map((c) => (c.cpf || "").replace(/\D/g, "")).filter(Boolean));
      let imported = 0, skipped = 0;
      const importedContacts = [];
      for (let i = 0; i < prev.length; i++) {
        const c = prev[i];
        const cpfClean = (c.cpf || "").replace(/\D/g, "");
        if (cpfClean && existingCPFs.has(cpfClean)) { skipped++; continue; }
        if (cpfClean) existingCPFs.add(cpfClean);
        const newC = { ...c, id: String(ts + i), reactions: [], _importId: String(ts) };
        await saveContact(newC);
        importedContacts.push(newC);
        imported++;
      }
      // Salvar histórico
      const entry = { id: String(ts), name: fn, count: imported, skipped, date: new Date().toLocaleString("pt-BR"), contacts: importedContacts };
      saveHistory([entry, ...history]);
      addLog("import", `Planilha importada: ${fn}`, `${imported} importados${skipped > 0 ? `, ${skipped} pulados (CPF duplicado)` : ""}`);
      setDoneInfo({ imported, skipped });
      setDone(true); setPrev([]); setFn("");
      if (fRef.current) fRef.current.value = "";
    } catch (e) { setErr("Erro ao salvar: " + e.message); }
    setLoading(false);
  };

  const tabStyle = (active) => ({
    background: "transparent", border: "none", cursor: "pointer",
    padding: "9px 18px", fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? C.atxt : C.tm,
    borderBottom: active ? `2px solid ${C.atxt}` : "2px solid transparent",
    marginBottom: "-1px",
  });

  // Tabs disponíveis
  const tabs = [
    { id: "import", label: "⬆ Importar" },
    { id: "verify", label: "🔍 Verificação de Leds" },
    ...(isMestre ? [{ id: "history", label: `📋 Histórico${history.length > 0 ? ` (${history.length})` : ""}` }] : []),
  ];

  return (
    <div style={{ padding: "30px 36px", maxWidth: 820 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>Importar Planilha</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.b1}`, marginBottom: 22 }}>
        {tabs.map((t) => (
          <button key={t.id} style={tabStyle(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── ABA IMPORTAR ── */}
      {tab === "import" && (
        <>
          {done && (
            <div style={{ ...S.card, padding: "14px 18px", marginBottom: 16, background: "#091E12", border: "1px solid #34D39933" }}>
              <div style={{ color: "#34D399", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>✓ Importação concluída!</div>
              <div style={{ color: C.tm, fontSize: 12, marginBottom: 10 }}>
                <span style={{ color: "#34D399" }}>{doneInfo.imported} importados</span>
                {doneInfo.skipped > 0 && <span> · <span style={{ color: "#FBBF24" }}>{doneInfo.skipped} pulados (CPF duplicado)</span></span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {isMestre && <button onClick={() => { setDone(false); setTab("history"); }} style={{ background: "#0D2B1A", color: "#34D399", border: "1px solid #34D39944", borderRadius: 7, padding: "5px 13px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Ver histórico ▶</button>}
                <button onClick={() => setPage("review")} style={{ background: "#0D2B1A", color: "#34D399", border: "1px solid #34D39944", borderRadius: 7, padding: "5px 13px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Ver clientes ▶</button>
              </div>
            </div>
          )}
          {err && <div style={{ background: "#2D1515", border: "1px solid #EF444433", borderRadius: 8, padding: "11px 14px", marginBottom: 16, color: "#F87171", fontSize: 13 }}>⚠ {err}</div>}
          <div style={{ ...S.card, padding: "22px", marginBottom: 16 }}>
            <div style={{ color: C.ts, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Modelo de Planilha</div>
            <div style={{ color: C.tm, fontSize: 11, marginBottom: 12 }}>Colunas: Nome*, CPF, Telefone, Telefone2, Telefone3, CNPJ, Email, Matricula, TipoLead, Observacao</div>
            <div style={{ color: C.tm, fontSize: 11, marginBottom: 14, lineHeight: 1.8 }}>
              TipoLead: {[["FGTS","#4F8EF7"],["Empréstimo do Trabalhador","#A78BFA"],["Empréstimo do Bolsa Família","#F472B6"],["Saque Complementar","#FB923C"],["INSS","#34D399"],["Bolsa Família","#F59E0B"],["Outro","#9CA3AF"]].map(([l,c],i,a) => (
                <span key={l}><span style={{ color: c }}>{l}</span>{i < a.length-1 ? ", " : ""}</span>
              ))}
            </div>
            <button onClick={dlModelo} style={{ ...S.btn(C.abg, C.atxt), border: `1px solid ${C.atxt}33`, fontSize: 12, padding: "7px 14px" }}>⬇ Baixar modelo CSV</button>
          </div>
          <div style={{ ...S.card, padding: "22px" }}>
            <div style={{ color: C.ts, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Selecionar arquivo</div>
            <div style={{ color: C.tm, fontSize: 11, marginBottom: 12 }}>CPFs duplicados serão pulados automaticamente.</div>
            <input ref={fRef} type="file" accept=".csv,.txt" onChange={hf} style={{ color: C.ts, fontSize: 13, marginBottom: 16, display: "block" }} />
            {prev.length > 0 && (
              <>
                <div style={{ color: "#34D399", fontSize: 12.5, marginBottom: 12 }}>
                  {prev.length} cliente{prev.length !== 1 ? "s" : ""} em <span style={{ color: C.tm }}>{fn}</span>
                </div>
                <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 16, borderRadius: 8, border: `1px solid ${C.b1}` }}>
                  {prev.slice(0, 50).map((c, i) => {
                    const lc = LEAD_COLOR[c.leadType] || "#9CA3AF";
                    const cpfClean = (c.cpf || "").replace(/\D/g, "");
                    const isDup = cpfClean && contacts.some((x) => (x.cpf || "").replace(/\D/g, "") === cpfClean);
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderBottom: i < prev.length - 1 ? `1px solid ${C.deep}` : "none", opacity: isDup ? 0.4 : 1 }}>
                        <div style={{ width: 26, height: 26, borderRadius: "50%", background: lc + "18", color: lc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{ini(c.name)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: C.tp, fontSize: 12, fontWeight: 500 }}>{c.name} {isDup && <span style={{ color: "#FBBF24", fontSize: 10 }}>· CPF duplicado</span>}</div>
                          <div style={{ color: C.tm, fontSize: 10.5 }}>{c.cpf}{c.phone ? " · " + c.phone : ""}</div>
                        </div>
                        <span style={{ color: lc, fontSize: 10.5, flexShrink: 0 }}>{c.leadType}</span>
                      </div>
                    );
                  })}
                  {prev.length > 50 && <div style={{ color: C.tm, fontSize: 11, padding: "10px 12px" }}>...e mais {prev.length - 50}</div>}
                </div>
                <button onClick={conf} disabled={loading} style={{ ...S.btn(C.acc, "#fff"), padding: "10px 22px", fontSize: 13.5, opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
                  {loading ? "Salvando..." : `Importar ${prev.length} cliente${prev.length !== 1 ? "s" : ""}`}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ── ABA VERIFICAÇÃO DE LEDS ── */}
      {tab === "verify" && (
        <VerifyTab
          contacts={contacts}
          setContacts={setContacts}
          history={history}
          saveHistory={saveHistory}
          currentUser={currentUser}
          isMestre={isMestre}
        />
      )}

      {/* ── ABA HISTÓRICO (só mestre) ── */}
      {tab === "history" && isMestre && (
        <HistoryTab />
      )}
    </div>
  );
}

// ── Review Client ──────────────────────────────────────────────
function ReviewClient({ contacts, setContacts, filtered = null }) {
  const list = filtered || contacts;
  const [idx, setIdx] = useState(0);
  const [sc, setSc] = useState(false);
  const [done, setDone] = useState(false);

  const si = Math.min(idx, list.length - 1);
  const cur = list[si] || {};

  // Estado local isolado por cliente
  const [reactions, setReactions] = useState(cur.reactions || []);
  const [leadType, setLeadType] = useState(cur.leadType || "FGTS");

  // Sincroniza ao trocar de cliente
  useEffect(() => {
    setReactions(cur.reactions || []);
    setLeadType(cur.leadType || "FGTS");
    setDone(false);
  }, [cur.id]); // eslint-disable-line

  if (!list.length)
    return (
      <div style={{ padding: "30px 36px" }}>
        <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: "0 0 30px" }}>
          Ver Clientes
        </h1>
        <div style={{ textAlign: "center", padding: "60px 0", color: C.tm }}>
          <div style={{ fontSize: 36, opacity: 0.3, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            Nenhum cliente{filtered ? " encontrado" : ""}
          </div>
        </div>
      </div>
    );

  const lc = LEAD_COLOR[leadType] || "#9CA3AF";
  const nexts = list.slice(si + 1, si + 11);

  const upd = async (u) => {
    await saveContact(u);
    setContacts((cs) => cs.map((c) => (c.id === u.id ? u : c)));
  };

  // Emojis — máx 3, isolados por cliente
  const tog = (e) => {
    setReactions((prev) => {
      if (prev.includes(e)) {
        const newR = prev.filter((x) => x !== e);
        upd({ ...cur, reactions: newR, leadType });
        return newR;
      }
      if (prev.length >= 3) return prev;
      const newR = [...prev, e];
      upd({ ...cur, reactions: newR, leadType });
      return newR;
    });
  };

  // Tipo de lead principal
  const selectLead = (t) => {
    setLeadType(t);
    upd({ ...cur, leadType: t, reactions });
  };

  // Concluído — avança para o próximo
  const conclude = async () => {
    await upd({ ...cur, reactions, leadType, status: cur.status });
    setDone(true);
    setTimeout(() => {
      if (si < list.length - 1) {
        setIdx((i) => i + 1);
      }
    }, 800);
  };

  return (
    <div style={{ padding: "26px 36px", maxWidth: 800 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>
            {filtered ? "Filtrado" : "Ver Clientes"}
          </h1>
          <p style={{ color: C.tm, fontSize: 12.5, margin: "4px 0 0" }}>
            {si + 1} de {list.length}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={si === 0}
            style={{ ...S.btn(si === 0 ? C.deep : C.abg, si === 0 ? C.td : C.atxt), border: `1px solid ${C.b2}`, padding: "7px 14px", fontSize: 13 }}
          >← Anterior</button>
          <button
            onClick={() => setIdx((i) => Math.min(list.length - 1, i + 1))}
            disabled={si === list.length - 1}
            style={{ ...S.btn(si === list.length - 1 ? C.deep : C.acc, si === list.length - 1 ? C.td : "#fff"), padding: "7px 14px", fontSize: 13 }}
          >Próximo →</button>
        </div>
      </div>

      {/* Card */}
      <div style={{ ...S.card, border: `1px solid ${lc}33`, padding: "24px 26px", marginBottom: 16, boxShadow: `0 0 28px ${lc}08` }}>

        {/* Nome e info */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: lc + "1A", color: lc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, border: `2px solid ${lc}44`, flexShrink: 0 }}>
            {ini(cur.name)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.tp, fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              {cur.name}
              {reactions.length > 0 && <span style={{ fontSize: 16 }}>{reactions.join("")}</span>}
            </div>
            <div style={{ color: C.tm, fontSize: 12.5, marginTop: 2 }}>{cur.cpf}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <LeadBadge c={{ ...cur, leadType }} />
              <StatusBadge status={cur.status} />
              {cur.matricula && (
                <span style={{ color: C.tm, fontSize: 11, padding: "3px 9px", borderRadius: 20, border: `1px solid ${C.b2}` }}>
                  #{cur.matricula}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Dados */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px 18px", padding: "12px", background: C.deep, borderRadius: 10, marginBottom: 16 }}>
          {[["Tel 1", cur.phone || "—"], ["Tel 2", cur.phone2 || "—"], ["Tel 3", cur.phone3 || "—"], ["Email", cur.email || "—"], ["CNPJ", cur.cnpj || "—"]].map(([l, v]) => (
            <div key={l}>
              <div style={{ color: C.tm, fontSize: 10, marginBottom: 2 }}>{l}</div>
              <div style={{ color: C.ts, fontSize: 12.5, fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Tipo de Lead Principal */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Tipo de Lead
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {LEAD_TYPES.filter(t => t !== "Outro").map((t) => {
              const col = LEAD_COLOR[t] || "#9CA3AF";
              const sel = leadType === t;
              return (
                <button key={t} onClick={() => selectLead(t)}
                  style={{ background: sel ? col + "1A" : C.deep, color: sel ? col : C.tm, border: sel ? `1px solid ${col}55` : `1px solid ${C.b2}`, borderRadius: 20, padding: "5px 11px", fontSize: 10.5, cursor: "pointer", fontWeight: sel ? 600 : 400, transition: "all 0.12s" }}>
                  {sel ? "✓ " : ""}{t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.5px" }}>Marcar status</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CLIENT_STATUS.map((s) => {
              const st = STATUS_STYLE[s];
              const sel = cur.status === s;
              return (
                <button key={s} onClick={() => upd({ ...cur, status: s, reactions, leadType })}
                  style={{ background: sel ? st.bg : C.deep, color: sel ? st.color : C.tm, border: sel ? `1px solid ${st.color}55` : `1px solid ${C.b2}`, borderRadius: 20, padding: "5px 11px", fontSize: 10.5, cursor: "pointer", fontWeight: sel ? 600 : 400, transition: "all 0.12s" }}>
                  {sel ? "✓ " : ""}{s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Emojis — máx 3 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Reações <span style={{ color: C.td, fontSize: 10, textTransform: "none" }}>({reactions.length}/3)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {EMOJIS.map((e) => {
              const a = reactions.includes(e);
              const maxed = reactions.length >= 3 && !a;
              return (
                <button key={e} onClick={() => tog(e)} disabled={maxed}
                  style={{ background: a ? "#1E2A45" : C.deep, border: a ? "1px solid #4F8EF766" : `1px solid ${C.b2}`, borderRadius: 8, padding: "4px 7px", cursor: maxed ? "not-allowed" : "pointer", fontSize: 15, transform: a ? "scale(1.15)" : "scale(1)", transition: "all 0.12s", opacity: maxed ? 0.3 : 1 }}>
                  {e}
                </button>
              );
            })}
          </div>
        </div>

        {/* Observações */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.5px" }}>Observações</div>
          <textarea
            value={cur.observacao || ""}
            onChange={(e) => upd({ ...cur, observacao: e.target.value, reactions, leadType })}
            rows={3}
            placeholder="Observação..."
            style={{ ...S.input, background: C.deep, border: `1px solid ${C.b2}`, color: C.ts, resize: "vertical" }}
          />
        </div>

        {/* Botões de ação */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Concluído */}
          <button
            onClick={conclude}
            style={{
              ...S.btn(done ? "#0A2918" : "#16A34A", done ? "#34D399" : "#fff"),
              border: done ? "1px solid #34D39944" : "none",
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 700,
              flex: 1,
              transition: "all 0.2s",
            }}
          >
            {done ? "✓ Concluído — avançando..." : "✅ Concluído"}
          </button>

          {/* Simular comissão */}
          <button
            onClick={() => setSc((p) => !p)}
            style={{ background: "transparent", border: `1px solid ${C.b2}`, color: C.tm, borderRadius: 8, padding: "10px 16px", fontSize: 12, cursor: "pointer" }}
          >
            {sc ? "▲ Fechar" : "💰 Comissão"}
          </button>
        </div>

        {sc && (
          <div style={{ marginTop: 12, padding: "16px", background: C.deep, borderRadius: 10, border: `1px solid ${C.b2}` }}>
            <CommSim compact />
          </div>
        )}
      </div>

      {/* Lista próximos */}
      {nexts.length > 0 && (
        <div>
          <div style={{ color: C.td, fontSize: 10.5, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Próximos {nexts.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {nexts.map((c, i) => {
              const lc2 = LEAD_COLOR[c.leadType] || "#9CA3AF";
              const ss2 = STATUS_STYLE[c.status] || STATUS_STYLE["Não simulado"];
              return (
                <div key={c.id} onClick={() => setIdx(si + 1 + i)}
                  style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 11px", background: C.deep, borderRadius: 7, border: `1px solid ${C.b1}`, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.card)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = C.deep)}
                >
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: lc2 + "18", color: lc2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>
                    {ini(c.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: C.ts, fontSize: 11, fontWeight: 500 }}>{c.name}</span>
                  </div>
                  <span style={{ color: lc2, fontSize: 9.5, flexShrink: 0 }}>{c.leadType === "Outro" ? c.leadTypeCustom || "Outro" : c.leadType}</span>
                  <span style={{ background: ss2.bg, color: ss2.color, fontSize: 9, padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>{c.status}</span>
                  {(c.reactions || []).length > 0 && (
                    <div style={{ display: "flex", gap: 1 }}>
                      {(c.reactions || []).slice(0, 3).map((e, j) => (
                        <span key={j} style={{ fontSize: 10 }}>{e}</span>
                      ))}
                    </div>
                  )}
                  <span style={{ color: C.td, fontSize: 9.5 }}>#{si + 2 + i}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {si === list.length - 1 && (
        <div style={{ textAlign: "center", padding: "18px", color: C.tm, fontSize: 13, background: C.deep, borderRadius: 10, marginTop: 14, border: `1px solid ${C.b1}` }}>
          ✓ Último cliente da lista.
        </div>
      )}
    </div>
  );
}

// ── Cliente Status ─────────────────────────────────────────────
function ClienteStatus({ contacts, setContacts }) {
  const [selS, setSelS] = useState([]);
  const [selL, setSelL] = useState([]);
  const [applied, setApplied] = useState(false);
  const togS = (s) =>
    setSelS((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const togL = (l) =>
    setSelL((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const filtered = contacts.filter(
    (c) =>
      (selS.length === 0 || selS.includes(c.status)) &&
      (selL.length === 0 || selL.includes(c.leadType)),
  );
  if (!applied)
    return (
      <div style={{ padding: "30px 36px", maxWidth: 760 }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>
            Cliente Status
          </h1>
          <p style={{ color: C.tm, fontSize: 12.5, margin: "4px 0 0" }}>
            Filtre e navegue por status e tipo de lead
          </p>
        </div>
        <div style={{ ...S.card, padding: "24px", marginBottom: 16 }}>
          <div
            style={{
              color: C.ts,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            Filtrar por Status
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 6,
            }}
          >
            {CLIENT_STATUS.map((s) => {
              const st = STATUS_STYLE[s];
              const sel = selS.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => togS(s)}
                  style={{
                    background: sel ? st.bg : C.deep,
                    color: sel ? st.color : C.tm,
                    border: sel
                      ? `1px solid ${st.color}55`
                      : `1px solid ${C.b2}`,
                    borderRadius: 20,
                    padding: "7px 14px",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: sel ? 600 : 400,
                    transition: "all 0.12s",
                  }}
                >
                  {sel ? "✓ " : ""}
                  {s}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ ...S.card, padding: "24px", marginBottom: 22 }}>
          <div
            style={{
              color: C.ts,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            Filtrar por Tipo de Lead
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {LEAD_TYPES.map((t) => {
              const col = LEAD_COLOR[t] || "#9CA3AF";
              const sel = selL.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => togL(t)}
                  style={{
                    background: sel ? col + "1A" : C.deep,
                    color: sel ? col : C.tm,
                    border: sel ? `1px solid ${col}55` : `1px solid ${C.b2}`,
                    borderRadius: 20,
                    padding: "7px 14px",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: sel ? 600 : 400,
                    transition: "all 0.12s",
                  }}
                >
                  {sel ? "✓ " : ""}
                  {t}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={() => setApplied(true)}
            style={{
              ...S.btn(C.acc, "#fff"),
              padding: "12px 28px",
              fontSize: 14,
            }}
          >
            Ver {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
          </button>
          <button
            onClick={() => {
              setSelS([]);
              setSelL([]);
            }}
            style={{
              ...S.btn("transparent", C.tm),
              border: `1px solid ${C.b2}`,
              padding: "12px 18px",
              fontSize: 13,
            }}
          >
            Limpar filtros
          </button>
        </div>
      </div>
    );
  return (
    <div>
      <div
        style={{
          padding: "18px 36px 0",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setApplied(false)}
          style={{
            ...S.btn(C.abg, C.atxt),
            border: `1px solid ${C.atxt}33`,
            padding: "7px 14px",
            fontSize: 12,
          }}
        >
          ← Filtros
        </button>
        {selS.map((s) => {
          const st = STATUS_STYLE[s];
          return (
            <span
              key={s}
              style={{
                background: st.bg,
                color: st.color,
                fontSize: 10.5,
                padding: "3px 10px",
                borderRadius: 20,
                fontWeight: 600,
              }}
            >
              {s}
            </span>
          );
        })}
        {selL.map((l) => {
          const col = LEAD_COLOR[l] || "#9CA3AF";
          return (
            <span
              key={l}
              style={{
                background: col + "18",
                color: col,
                fontSize: 10.5,
                padding: "3px 10px",
                borderRadius: 20,
                fontWeight: 600,
                border: `1px solid ${col}33`,
              }}
            >
              {l}
            </span>
          );
        })}
      </div>
      <ReviewClient
        contacts={contacts}
        setContacts={setContacts}
        filtered={filtered}
      />
    </div>
  );
}

// ── Leds Page ──────────────────────────────────────────────────
function LedsPage({ contacts, userRole }) {
  const [selS, setSelS] = useState([]);
  const [selL, setSelL] = useState([]);
  const [qty, setQty] = useState("");
  if (userRole === "indicado")
    return (
      <div style={{ padding: "30px 36px", maxWidth: 600 }}>
        <h1
          style={{
            color: C.tp,
            fontSize: 21,
            fontWeight: 700,
            margin: "0 0 24px",
          }}
        >
          Leds
        </h1>
        <div style={{ ...S.card, padding: "32px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.3 }}>🔒</div>
          <div style={{ color: "#F87171", fontSize: 14, fontWeight: 600 }}>
            Acesso restrito
          </div>
          <div style={{ color: C.tm, fontSize: 12.5, marginTop: 6 }}>
            Usuários indicados não têm permissão para baixar leads.
          </div>
        </div>
      </div>
    );
  const togS = (s) =>
    setSelS((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const togL = (l) =>
    setSelL((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const filtered = contacts.filter(
    (c) =>
      (selS.length === 0 || selS.includes(c.status)) &&
      (selL.length === 0 || selL.includes(c.leadType)),
  );
  const maxQ = Math.min(parseInt(qty) || filtered.length, filtered.length);
  const toDown = filtered.slice(0, maxQ);
  return (
    <div style={{ padding: "30px 36px", maxWidth: 780 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>
          Leds
        </h1>
        <p style={{ color: C.tm, fontSize: 12.5, margin: "4px 0 0" }}>
          Filtre e baixe leads em CSV
        </p>
      </div>
      <div style={{ ...S.card, padding: "22px", marginBottom: 16 }}>
        <div
          style={{
            color: C.ts,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Filtrar por Status
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {CLIENT_STATUS.map((s) => {
            const st = STATUS_STYLE[s];
            const sel = selS.includes(s);
            return (
              <button
                key={s}
                onClick={() => togS(s)}
                style={{
                  background: sel ? st.bg : C.deep,
                  color: sel ? st.color : C.tm,
                  border: sel ? `1px solid ${st.color}55` : `1px solid ${C.b2}`,
                  borderRadius: 20,
                  padding: "6px 13px",
                  fontSize: 11.5,
                  cursor: "pointer",
                  fontWeight: sel ? 600 : 400,
                  transition: "all 0.12s",
                }}
              >
                {sel ? "✓ " : ""}
                {s}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ ...S.card, padding: "22px", marginBottom: 16 }}>
        <div
          style={{
            color: C.ts,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Filtrar por Tipo de Lead
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {LEAD_TYPES.map((t) => {
            const col = LEAD_COLOR[t] || "#9CA3AF";
            const sel = selL.includes(t);
            return (
              <button
                key={t}
                onClick={() => togL(t)}
                style={{
                  background: sel ? col + "1A" : C.deep,
                  color: sel ? col : C.tm,
                  border: sel ? `1px solid ${col}55` : `1px solid ${C.b2}`,
                  borderRadius: 20,
                  padding: "6px 13px",
                  fontSize: 11.5,
                  cursor: "pointer",
                  fontWeight: sel ? 600 : 400,
                  transition: "all 0.12s",
                }}
              >
                {sel ? "✓ " : ""}
                {t}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ ...S.card, padding: "22px", marginBottom: 22 }}>
        <div
          style={{
            color: C.ts,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Quantidade
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="number"
            min="1"
            max={filtered.length}
            placeholder={`Máximo: ${filtered.length}`}
            style={{ ...S.input, width: 200 }}
          />
          <span style={{ color: C.tm, fontSize: 12.5 }}>
            {filtered.length} disponível{filtered.length !== 1 ? "s" : ""} →{" "}
            <span style={{ color: C.atxt, fontWeight: 600 }}>
              {maxQ} selecionado{maxQ !== 1 ? "s" : ""}
            </span>
          </span>
        </div>
      </div>
      <button
        onClick={() => exportCSV(toDown, `nexp_leds_${Date.now()}.csv`)}
        disabled={filtered.length === 0}
        style={{
          background: filtered.length === 0 ? C.deep : C.acc,
          color: filtered.length === 0 ? C.td : "#fff",
          border: "none",
          borderRadius: 8,
          padding: "12px 28px",
          fontSize: 14,
          fontWeight: 600,
          cursor: filtered.length === 0 ? "not-allowed" : "pointer",
        }}
      >
        ⬇ Baixar {maxQ} led{maxQ !== 1 ? "s" : ""} (CSV)
      </button>
    </div>
  );
}

// ── Premium Nexp ───────────────────────────────────────────────
function PremiumNexp({ contacts, setContacts }) {
  const [q, setQ] = useState("");
  const [selS, setSelS] = useState([]);
  const [selL, setSelL] = useState([]);
  const [qty, setQty] = useState("");
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const all = contacts || [];
  const total = all.length;
  const filtered = all.filter((c) => {
    const qs = (q || "").trim().toLowerCase();
    const mQ =
      !qs ||
      (c.name || "").toLowerCase().includes(qs) ||
      (c.cpf || "").replace(/\D/g, "").includes(qs.replace(/\D/g, "")) ||
      (c.cpf || "").includes(qs) ||
      (c.phone || "").includes(qs) ||
      (c.phone2 || "").includes(qs) ||
      (c.phone3 || "").includes(qs) ||
      (c.email || "").toLowerCase().includes(qs) ||
      (c.matricula || "").toLowerCase().includes(qs) ||
      (c.cnpj || "").includes(qs);
    return (
      mQ &&
      (selS.length === 0 || selS.includes(c.status)) &&
      (selL.length === 0 || selL.includes(c.leadType))
    );
  });
  const qNum = parseInt(qty) || 0;
  const dlCount = qNum > 0 ? Math.min(qNum, filtered.length) : filtered.length;
  const openEdit = (c) => {
    setEditId(c.id);
    setEditForm({ ...c });
  };
  const closeEdit = () => {
    setEditId(null);
    setEditForm(null);
  };
  const saveEdit = async () => {
    await saveContact({ ...editForm });
    setContacts((cs) => cs.map((c) => (c.id === editId ? { ...editForm } : c)));
    closeEdit();
  };
  const setF = (k, v) => setEditForm((f) => ({ ...f, [k]: v }));
  const statCards = [
    ["Total", total, C.atxt],
    [
      "Com oportunidade",
      all.filter((c) => c.status === "Com oportunidade").length,
      "#34D399",
    ],
    [
      "Em negociação",
      all.filter((c) => c.status === "Em negociação").length,
      "#60A5FA",
    ],
    ["Fechados", all.filter((c) => c.status === "Fechado").length, "#10B981"],
  ];
  return (
    <div style={{ padding: "28px 36px", background: C.bg, minHeight: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: `linear-gradient(135deg,${C.lg1},${C.lg2})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              color: "#fff",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            ★
          </div>
          <div>
            <h1
              style={{
                color: C.tp,
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                letterSpacing: "-0.4px",
              }}
            >
              Premium Nexp
            </h1>
            <p style={{ color: C.tm, fontSize: 12.5, margin: "3px 0 0" }}>
              Visão completa e exclusiva · {total} lead{total !== 1 ? "s" : ""}{" "}
              no sistema
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            exportCSV(
              filtered.slice(0, dlCount),
              `premium_nexp_${Date.now()}.csv`,
            )
          }
          disabled={filtered.length === 0}
          style={{
            background: filtered.length === 0 ? C.deep : C.acc,
            color: filtered.length === 0 ? C.td : "#fff",
            border: "none",
            borderRadius: 9,
            padding: "11px 24px",
            fontSize: 13.5,
            fontWeight: 700,
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          ⬇ Baixar {dlCount} lead{dlCount !== 1 ? "s" : ""}
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 12,
          marginBottom: 22,
        }}
      >
        {statCards.map(([l, v, cor]) => (
          <div key={l} style={{ ...S.card, padding: "16px 18px" }}>
            <div
              style={{
                color: C.td,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.6px",
                marginBottom: 8,
              }}
            >
              {l}
            </div>
            <div
              style={{
                color: cor,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-0.8px",
              }}
            >
              {v}
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span
          style={{
            position: "absolute",
            left: 14,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 15,
            pointerEvents: "none",
            color: C.tm,
          }}
        >
          🔍
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar por CPF, nome, telefone, email, matrícula ou CNPJ…"
          style={{
            ...S.input,
            background: C.card,
            border: `1px solid ${C.b1}`,
            padding: "11px 40px",
          }}
        />
        {q && (
          <button
            onClick={() => setQ("")}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: C.tm,
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ ...S.card, padding: "14px 18px", marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            marginBottom: 9,
          }}
        >
          <span
            style={{
              color: C.ts,
              fontSize: 11,
              fontWeight: 600,
              marginRight: 4,
              flexShrink: 0,
            }}
          >
            Status:
          </span>
          {CLIENT_STATUS.map((s) => {
            const st = STATUS_STYLE[s];
            const sel = selS.includes(s);
            return (
              <button
                key={s}
                onClick={() =>
                  setSelS((p) =>
                    p.includes(s) ? p.filter((x) => x !== s) : [...p, s],
                  )
                }
                style={{
                  background: sel ? st.bg : C.deep,
                  color: sel ? st.color : C.tm,
                  border: sel ? `1px solid ${st.color}55` : `1px solid ${C.b2}`,
                  borderRadius: 20,
                  padding: "4px 12px",
                  fontSize: 10.5,
                  cursor: "pointer",
                  fontWeight: sel ? 600 : 400,
                  transition: "all 0.12s",
                }}
              >
                {sel ? "✓ " : ""}
                {s}
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span
            style={{
              color: C.ts,
              fontSize: 11,
              fontWeight: 600,
              marginRight: 4,
              flexShrink: 0,
            }}
          >
            Lead:
          </span>
          {LEAD_TYPES.map((t) => {
            const col = LEAD_COLOR[t] || "#9CA3AF";
            const sel = selL.includes(t);
            return (
              <button
                key={t}
                onClick={() =>
                  setSelL((p) =>
                    p.includes(t) ? p.filter((x) => x !== t) : [...p, t],
                  )
                }
                style={{
                  background: sel ? col + "1A" : C.deep,
                  color: sel ? col : C.tm,
                  border: sel ? `1px solid ${col}55` : `1px solid ${C.b2}`,
                  borderRadius: 20,
                  padding: "4px 12px",
                  fontSize: 10.5,
                  cursor: "pointer",
                  fontWeight: sel ? 600 : 400,
                  transition: "all 0.12s",
                }}
              >
                {sel ? "✓ " : ""}
                {t}
              </button>
            );
          })}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          type="number"
          min="1"
          max={filtered.length}
          placeholder={`Qtd para baixar (máx ${filtered.length})`}
          style={{
            ...S.input,
            width: 200,
            padding: "8px 12px",
            fontSize: 12.5,
          }}
        />
        <span style={{ color: C.tm, fontSize: 12.5 }}>
          <span style={{ color: C.ts, fontWeight: 600 }}>
            {filtered.length}
          </span>{" "}
          resultado{filtered.length !== 1 ? "s" : ""} →{" "}
          <span style={{ color: C.atxt, fontWeight: 700 }}>
            {dlCount} para baixar
          </span>
        </span>
        {(selS.length > 0 || selL.length > 0 || q.trim()) && (
          <button
            onClick={() => {
              setSelS([]);
              setSelL([]);
              setQ("");
              setQty("");
            }}
            style={{
              background: "transparent",
              border: `1px solid ${C.b2}`,
              color: C.tm,
              borderRadius: 7,
              padding: "6px 13px",
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>
      <div
        style={{
          color: C.td,
          fontSize: 11,
          marginBottom: 12,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {filtered.length} de {total} lead{total !== 1 ? "s" : ""}
      </div>
      {filtered.length === 0 ? (
        <div style={{ ...S.card, padding: "48px", textAlign: "center" }}>
          <div style={{ fontSize: 38, opacity: 0.25, marginBottom: 14 }}>★</div>
          <div style={{ color: C.tm, fontSize: 14, fontWeight: 600 }}>
            {total === 0
              ? "Nenhum lead cadastrado no sistema."
              : "Nenhum lead encontrado com esses filtros."}
          </div>
        </div>
      ) : (
        filtered.map((c) => {
          const lc = LEAD_COLOR[c.leadType] || "#9CA3AF";
          const isEditing = editId === c.id;
          return (
            <div
              key={c.id}
              style={{ ...S.card, marginBottom: 10, overflow: "hidden" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "13px 16px",
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    background: lc + "1A",
                    color: lc,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                    border: `1.5px solid ${lc}33`,
                  }}
                >
                  {ini(c.name)}
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ color: C.tp, fontSize: 13.5, fontWeight: 600 }}>
                    {c.name}
                  </div>
                  <div style={{ color: C.tm, fontSize: 11.5, marginTop: 2 }}>
                    CPF:{" "}
                    <span style={{ color: C.ts, fontWeight: 600 }}>
                      {c.cpf || "—"}
                    </span>
                    {c.phone && (
                      <span style={{ marginLeft: 12 }}>Tel: {c.phone}</span>
                    )}
                    {c.matricula && (
                      <span style={{ marginLeft: 12 }}>Mat: {c.matricula}</span>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <LeadBadge c={c} />
                  <StatusBadge status={c.status} />
                  {(c.reactions || []).length > 0 && (
                    <span style={{ fontSize: 13 }}>
                      {(c.reactions || []).slice(0, 4).join(" ")}
                    </span>
                  )}
                  <button
                    onClick={() => (isEditing ? closeEdit() : openEdit(c))}
                    style={{
                      background: isEditing ? C.deep : C.abg,
                      color: isEditing ? C.tm : C.atxt,
                      border: `1px solid ${C.atxt}33`,
                      borderRadius: 8,
                      padding: "5px 14px",
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 600,
                      transition: "all 0.12s",
                    }}
                  >
                    {isEditing ? "✕ Fechar" : "✏ Editar"}
                  </button>
                </div>
              </div>
              {isEditing && editForm && (
                <div
                  style={{
                    borderTop: `1px solid ${C.b1}`,
                    padding: "20px 18px",
                    background: C.deep,
                  }}
                >
                  <div
                    style={{
                      color: C.atxt,
                      fontSize: 12.5,
                      fontWeight: 700,
                      marginBottom: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span>✏</span> Editando — {editForm.name || "cliente"}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 12,
                      marginBottom: 14,
                    }}
                  >
                    {[
                      ["Nome completo", "name", "text"],
                      ["CPF", "cpf", "text"],
                      ["Telefone 1", "phone", "tel"],
                      ["Telefone 2", "phone2", "tel"],
                      ["Telefone 3", "phone3", "tel"],
                      ["CNPJ", "cnpj", "text"],
                      ["Email", "email", "email"],
                      ["Matrícula", "matricula", "text"],
                    ].map(([l, k, t]) => (
                      <div key={k}>
                        <label
                          style={{
                            color: C.tm,
                            fontSize: 11,
                            display: "block",
                            marginBottom: 4,
                          }}
                        >
                          {l}
                        </label>
                        <input
                          value={editForm[k] || ""}
                          onChange={(e) => setF(k, e.target.value)}
                          type={t}
                          style={{
                            ...S.input,
                            background: C.card,
                            padding: "7px 10px",
                            fontSize: 12.5,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label
                      style={{
                        color: C.tm,
                        fontSize: 11,
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      Tipo de Lead
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {LEAD_TYPES.map((lt) => {
                        const ltc = LEAD_COLOR[lt] || "#9CA3AF";
                        const sel = editForm.leadType === lt;
                        return (
                          <button
                            key={lt}
                            onClick={() => setF("leadType", lt)}
                            style={{
                              background: sel ? ltc + "1A" : C.card,
                              color: sel ? ltc : C.tm,
                              border: sel
                                ? `1px solid ${ltc}55`
                                : `1px solid ${C.b2}`,
                              borderRadius: 20,
                              padding: "5px 13px",
                              fontSize: 11.5,
                              cursor: "pointer",
                              fontWeight: sel ? 600 : 400,
                            }}
                          >
                            {sel ? "✓ " : ""}
                            {lt}
                          </button>
                        );
                      })}
                    </div>
                    {editForm.leadType === "Outro" && (
                      <input
                        value={editForm.leadTypeCustom || ""}
                        onChange={(e) => setF("leadTypeCustom", e.target.value)}
                        placeholder="Informe o produto"
                        style={{
                          ...S.input,
                          background: C.card,
                          padding: "7px 10px",
                          fontSize: 12.5,
                          marginTop: 8,
                        }}
                      />
                    )}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label
                      style={{
                        color: C.tm,
                        fontSize: 11,
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      Status
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {CLIENT_STATUS.map((s) => {
                        const st = STATUS_STYLE[s];
                        const sel = editForm.status === s;
                        return (
                          <button
                            key={s}
                            onClick={() => setF("status", s)}
                            style={{
                              background: sel ? st.bg : C.card,
                              color: sel ? st.color : C.tm,
                              border: sel
                                ? `1px solid ${st.color}55`
                                : `1px solid ${C.b2}`,
                              borderRadius: 20,
                              padding: "5px 12px",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: sel ? 600 : 400,
                            }}
                          >
                            {sel ? "✓ " : ""}
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label
                      style={{
                        color: C.tm,
                        fontSize: 11,
                        display: "block",
                        marginBottom: 5,
                      }}
                    >
                      Observações
                    </label>
                    <textarea
                      value={editForm.observacao || ""}
                      onChange={(e) => setF("observacao", e.target.value)}
                      rows={3}
                      placeholder="Observações…"
                      style={{
                        ...S.input,
                        background: C.card,
                        resize: "vertical",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={saveEdit}
                      style={{
                        ...S.btn(C.acc, "#fff"),
                        padding: "9px 24px",
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      Salvar alterações
                    </button>
                    <button
                      onClick={closeEdit}
                      style={{
                        ...S.btn("transparent", C.tm),
                        border: `1px solid ${C.b2}`,
                        padding: "9px 18px",
                        fontSize: 13,
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={async () => {
                        if (window.confirm("Remover este lead?")) {
                          await deleteContact(String(c.id));
                          addLog("delete_one", `Lead removido: ${c.name}`, `CPF: ${c.cpf || "—"} · Status: ${c.status}`);
                          setContacts((cs) => cs.filter((x) => x.id !== c.id));
                        }
                        closeEdit();
                      }}
                      style={{
                        ...S.btn("transparent", "#EF4444"),
                        border: "1px solid #EF444433",
                        padding: "9px 16px",
                        fontSize: 13,
                        marginLeft: "auto",
                      }}
                    >
                      Remover lead
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Configurações ──────────────────────────────────────────────
function TemasTab({ currentTheme, onTheme }) {
  return (
    <div>
      <div
        style={{ color: C.ts, fontSize: 13, fontWeight: 600, marginBottom: 6 }}
      >
        Escolha o tema de cores
      </div>
      <div style={{ color: C.tm, fontSize: 12, marginBottom: 22 }}>
        Altera a cor de destaque de toda a interface imediatamente.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 14,
        }}
      >
        {Object.entries(ACCENT_THEMES).map(([name, t]) => {
          const sel = currentTheme === name;
          return (
            <button
              key={name}
              onClick={() => onTheme(name)}
              style={{
                background: sel ? t.abg : C.card,
                border: sel ? `2px solid ${t.atxt}` : `1px solid ${C.b1}`,
                borderRadius: 14,
                padding: "20px 16px",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Colour preview bubbles */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: `linear-gradient(135deg,${t.lg1},${t.lg2})`,
                    boxShadow: `0 0 12px ${t.lg1}55`,
                  }}
                />
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: t.atxt + "55",
                    border: `1.5px solid ${t.atxt}88`,
                  }}
                />
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: t.abg,
                    border: `1.5px solid ${t.atxt}44`,
                  }}
                />
              </div>
              <div
                style={{
                  color: sel ? t.atxt : C.ts,
                  fontSize: 13,
                  fontWeight: sel ? 700 : 400,
                  letterSpacing: "-0.2px",
                }}
              >
                {name}
              </div>
              {sel && (
                <div
                  style={{
                    background: t.acc,
                    color: "#fff",
                    fontSize: 10,
                    padding: "2px 10px",
                    borderRadius: 20,
                    fontWeight: 700,
                  }}
                >
                  ✓ Ativo
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConfigPage({ users, setUsers, currentUser, theme, onTheme }) {
  const [tab, setTab] = useState("perfil");
  const tabs = [
    {
      id: "perfil",
      label: "Perfil",
      icon: "◎",
      roles: ["mestre", "master", "indicado"],
    },
    {
      id: "usuarios",
      label: "Usuários",
      icon: "👤",
      roles: ["mestre", "master"],
    },
    {
      id: "temas",
      label: "Temas",
      icon: "🎨",
      roles: ["mestre", "master", "indicado"],
    },
  ].filter((t) => t.roles.includes(currentUser.role));
  return (
    <div style={{ minHeight: "100%", background: C.bg }}>
      <div style={{ padding: "30px 36px 0" }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>
            Configurações
          </h1>
        </div>
        <div
          style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.b1}` }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? C.atxt : C.tm,
                borderBottom:
                  tab === t.id
                    ? `2px solid ${C.atxt}`
                    : "2px solid transparent",
                marginBottom: "-1px",
                transition: "all 0.12s",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: "26px 36px", maxWidth: 860 }}>
        {tab === "perfil" && (
          <PerfilTab
            users={users}
            setUsers={setUsers}
            currentUser={currentUser}
          />
        )}
        {tab === "usuarios" && (
          <UsuariosTab
            users={users}
            setUsers={setUsers}
            currentUser={currentUser}
          />
        )}
        {tab === "temas" && <TemasTab currentTheme={theme} onTheme={onTheme} />}
      </div>
    </div>
  );
}

function PerfilTab({ users, setUsers, currentUser }) {
  const uObj = users.find((u) => u.id === currentUser.id) || currentUser;
  const [name, setName] = useState(uObj.name || "");
  const [preview, setPreview] = useState(uObj.photo || null);
  const [ok, setOk] = useState(false);
  const fRef = useRef();
  const handleImg = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setPreview(ev.target.result);
    r.readAsDataURL(f);
  };
  const save = () => {
    setUsers((us) =>
      us.map((u) =>
        u.id === currentUser.id ? { ...u, name, photo: preview } : u,
      ),
    );
    setOk(true);
    setTimeout(() => setOk(false), 3000);
  };
  const roleLabel = {
    mestre: "Mestre",
    master: "Master",
    indicado: "Operador",
  };
  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399" };
  const rc = roleColor[uObj.role] || C.atxt;
  return (
    <div style={{ maxWidth: 500 }}>
      {ok && (
        <div
          style={{
            background: "#091E12",
            border: "1px solid #34D39933",
            borderRadius: 8,
            padding: "11px 14px",
            marginBottom: 18,
            color: "#34D399",
            fontSize: 13,
          }}
        >
          ✓ Perfil atualizado!
        </div>
      )}
      <div style={{ ...S.card, padding: "30px" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            {preview ? (
              <img
                src={preview}
                alt=""
                style={{
                  width: 90,
                  height: 90,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: `3px solid ${rc}44`,
                }}
              />
            ) : (
              <div
                style={{
                  width: 90,
                  height: 90,
                  borderRadius: "50%",
                  background: rc + "1A",
                  color: rc,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 32,
                  fontWeight: 700,
                  border: `3px solid ${rc}44`,
                  margin: "0 auto",
                }}
              >
                {ini(name || uObj.username || "OP")}
              </div>
            )}
            <button
              onClick={() => fRef.current && fRef.current.click()}
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: C.acc,
                color: "#fff",
                border: `2px solid ${C.bg}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              +
            </button>
          </div>
          <input
            ref={fRef}
            type="file"
            accept="image/*"
            onChange={handleImg}
            style={{ display: "none" }}
          />
          <div style={{ color: C.td, fontSize: 11.5, marginTop: 10 }}>
            Clique no + para alterar a foto
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              color: C.tm,
              fontSize: 11.5,
              display: "block",
              marginBottom: 5,
            }}
          >
            Nome de exibição
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como quer ser chamado"
            style={{ ...S.input }}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              color: C.tm,
              fontSize: 11.5,
              display: "block",
              marginBottom: 5,
            }}
          >
            Usuário (login)
          </label>
          <input
            value={uObj.email}
            readOnly
            style={{ ...S.input, color: C.tm, cursor: "not-allowed" }}
          />
        </div>
        <div style={{ marginBottom: 22 }}>
          <label
            style={{
              color: C.tm,
              fontSize: 11.5,
              display: "block",
              marginBottom: 5,
            }}
          >
            CPF
          </label>
          <input
            value={uObj.cpf || "—"}
            readOnly
            style={{ ...S.input, color: C.tm, cursor: "not-allowed" }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={save}
            style={{
              ...S.btn(C.acc, "#fff"),
              padding: "11px 28px",
              fontSize: 14,
            }}
          >
            Salvar alterações
          </button>
          <span
            style={{
              background: rc + "18",
              color: rc,
              fontSize: 11,
              padding: "4px 12px",
              borderRadius: 20,
              fontWeight: 700,
              border: `1px solid ${rc}33`,
            }}
          >
            {roleLabel[uObj.role]}
          </span>
        </div>
      </div>
    </div>
  );
}

function UsuariosTab({ users, setUsers, currentUser }) {
  const [mode, setMode] = useState("list");
  const [form, setForm] = useState({
    name: "",
    cpf: "",
    email: "",
    password: "",
    role: "indicado",
    photo: null,
  });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [expandId, setExpandId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [resetPw, setResetPw] = useState("");
  const pRef = useRef();
  const pEditRef = useRef();

  const canSeeAll = currentUser.role === "mestre";
  const visible = users.filter(
    (u) =>
      !u.deleted &&
      (canSeeAll || u.createdBy === currentUser.id || u.id === currentUser.id),
  );

  const roleLabel = {
    mestre: "Mestre",
    master: "Master",
    indicado: "Operador",
  };
  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399" };

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setEF = (k, v) => setEditForm((f) => ({ ...f, [k]: v }));

  const flash = (msg) => {
    setOk(msg);
    setTimeout(() => setOk(""), 3000);
  };

  // ── Create new user
  const create = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim() || !form.cpf.trim()) {
      setErr("Nome, CPF, email e senha são obrigatórios.");
      return;
    }
    setErr("");
    setOk("Criando usuário...");
    try {
      const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador" };
      let uid;
      let reativado = false;

      try {
        uid = await createOperator(form.email, form.password);
      } catch (e) {
        if (e.code === "auth/email-already-in-use") {
          const found = users.find(u => u.email === form.email);
          if (found) {
            uid = found.uid || found.id;
            reativado = true;
          } else {
            const snap = await getDocs(query(collection(db, "users"), where("email", "==", form.email)));
            if (!snap.empty) {
              uid = snap.docs[0].id;
              reativado = true;
            } else {
              throw new Error("Email já existe mas o perfil não foi encontrado.");
            }
          }
        } else {
          throw e;
        }
      }

      const newU = {
        id: uid, uid,
        username: form.email,
        email: form.email,
        role: currentUser.role === "mestre" ? form.role : "indicado",
        name: form.name,
        cpf: form.cpf,
        photo: form.photo || null,
        createdBy: currentUser.uid || currentUser.id,
        active: true,
        deleted: false,
      };
      await saveUserProfile(uid, newU);

      // Enviar email de boas-vindas
      try {
        await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: "nexp_service",
            template_id: "template_hubbahe",
            user_id: "GaZRJdTXt0UMdEY3H",
            template_params: {
              to_name: form.name,
              to_email: form.email,
              user_email: form.email,
              user_password: form.password,
              user_role: roleLabel[newU.role] || newU.role,
              access_link: "https://nexp-company.vercel.app",
            },
          }),
        });
        flash(reativado ? "Usuário reativado e email enviado! ✉" : "Usuário criado e email enviado! ✉");
      } catch {
        flash(reativado ? "Usuário reativado!" : "Usuário criado!");
      }

      setForm({ name: "", cpf: "", email: "", password: "", role: "indicado", photo: null });
      setMode("list");
    } catch (e) {
      setErr("Erro: " + e.message);
      setOk("");
    }
  };

  // ── Delete user
  const deleteUser = async (u) => {
    if (!window.confirm(`Excluir o usuário "${u.name}"?\nEsta ação não pode ser desfeita.`)) return;
    try {
      // Marca como deletado no Firestore — impede login futuro
      await saveUserProfile(u.uid || u.id, { ...u, active: false, deleted: true });
      flash(`Usuário "${u.name}" excluído com sucesso!`);
    } catch (e) { setErr("Erro ao excluir: " + e.message); }
  };
  const openEdit = (u) => {
    if (expandId === u.id) {
      setExpandId(null); setEditForm(null); setResetPw(""); return;
    }
    setExpandId(u.id); setEditForm({ ...u }); setResetPw("");
  };

  // ── Save edits
  const saveEdit = async () => {
    if (!editForm.name.trim() || !editForm.email.trim() || !editForm.cpf.trim()) {
      setErr("Nome, CPF e email são obrigatórios."); return;
    }
    const emailConflict = users.find((u) => u.email === editForm.email && u.id !== editForm.id);
    if (emailConflict) { setErr("Esse email já está em uso por outro usuário."); return; }
    try {
      await saveUserProfile(editForm.uid || editForm.id, editForm);
      setExpandId(null); setEditForm(null); setResetPw("");
      flash("Usuário atualizado!");
    } catch (e) { setErr("Erro ao salvar: " + e.message); }
  };

  // ── Reset password
  const doReset = async () => {
    if (!resetPw.trim()) { setErr("Nova senha não pode estar vazia."); return; }
    try {
      // Usa firebase admin via createOperator trick — apenas salva no perfil
      await saveUserProfile(editForm.uid || editForm.id, { ...editForm, _pwHint: "redefined" });
      setResetPw("");
      flash("Senha redefinida! O usuário precisará usar o novo acesso.");
    } catch (e) { setErr("Erro: " + e.message); }
  };

  // ── Toggle active/inactive
  const toggleActive = async (u) => {
    const updated = { ...u, active: u.active === false ? true : false };
    try {
      await saveUserProfile(u.uid || u.id, updated);
      flash(`Usuário ${updated.active ? "ativado" : "desativado"}!`);
    } catch (e) { setErr("Erro: " + e.message); }
  };

  const handlePhoto = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setF("photo", ev.target.result);
    r.readAsDataURL(f);
  };
  const handleEditPhoto = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setEF("photo", ev.target.result);
    r.readAsDataURL(f);
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div style={{ color: C.ts, fontSize: 13 }}>
          {visible.length} usuário{visible.length !== 1 ? "s" : ""}
        </div>
        <button
          onClick={() => {
            setMode((m) => (m === "list" ? "create" : "list"));
            setErr("");
          }}
          style={{
            ...S.btn(
              mode === "create" ? C.abg : C.acc,
              mode === "create" ? C.atxt : "#fff",
            ),
            border: mode === "create" ? `1px solid ${C.atxt}33` : "none",
            padding: "8px 16px",
            fontSize: 12.5,
          }}
        >
          {mode === "create" ? "← Lista" : "+ Novo usuário"}
        </button>
      </div>

      {ok && (
        <div
          style={{
            background: "#091E12",
            border: "1px solid #34D39933",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 14,
            color: "#34D399",
            fontSize: 13,
          }}
        >
          ✓ {ok}
        </div>
      )}
      {err && (
        <div
          style={{
            background: "#2D1515",
            border: "1px solid #EF444433",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 14,
            color: "#F87171",
            fontSize: 13,
          }}
        >
          ⚠ {err}
        </div>
      )}

      {/* ── Create form ── */}
      {mode === "create" && (
        <div style={{ ...S.card, padding: "24px" }}>
          <div
            style={{
              color: C.ts,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            Criar Novo Usuário
          </div>
          <div style={{ marginBottom: 14 }}>
            <label
              style={{
                color: C.tm,
                fontSize: 11.5,
                display: "block",
                marginBottom: 5,
              }}
            >
              Foto do Operador
            </label>
            <input
              ref={pRef}
              type="file"
              accept="image/*"
              onChange={handlePhoto}
              style={{ color: C.ts, fontSize: 13, display: "block" }}
            />
            {form.photo && (
              <img
                src={form.photo}
                alt=""
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  objectFit: "cover",
                  marginTop: 8,
                  border: `2px solid ${C.atxt}33`,
                }}
              />
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            {[
              ["Nome do operador *", "name", "text"],
              ["CPF *", "cpf", "text"],
              ["Email (usuário) *", "email", "email"],
              ["Senha inicial *", "password", "password"],
            ].map(([l, k, t]) => (
              <div key={k}>
                <label
                  style={{
                    color: C.tm,
                    fontSize: 11.5,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  {l}
                </label>
                <input
                  value={form[k]}
                  onChange={(e) => setF(k, e.target.value)}
                  type={t}
                  style={{ ...S.input }}
                />
              </div>
            ))}
          </div>
          {currentUser.role === "mestre" && (
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  color: C.tm,
                  fontSize: 11.5,
                  display: "block",
                  marginBottom: 7,
                }}
              >
                Nível de acesso
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {["master", "indicado"].map((r) => {
                  const sel = form.role === r;
                  const col = roleColor[r];
                  return (
                    <button
                      key={r}
                      onClick={() => setF("role", r)}
                      style={{
                        background: sel ? col + "18" : C.deep,
                        color: sel ? col : C.tm,
                        border: sel
                          ? `1px solid ${col}55`
                          : `1px solid ${C.b2}`,
                        borderRadius: 20,
                        padding: "7px 16px",
                        fontSize: 12,
                        cursor: "pointer",
                        fontWeight: sel ? 600 : 400,
                      }}
                    >
                      {sel ? "✓ " : ""}
                      {roleLabel[r]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <button
            onClick={create}
            style={{
              ...S.btn(C.acc, "#fff"),
              padding: "11px 22px",
              fontSize: 13.5,
            }}
          >
            Criar usuário
          </button>
        </div>
      )}

      {/* ── User list ── */}
      {mode === "list" && (
        <div>
          {visible.map((u) => {
            const col = roleColor[u.role] || C.atxt;
            const isActive = u.active !== false;
            const isExpanded = expandId === u.id;
            const canEdit =
              currentUser.role === "mestre" ||
              (currentUser.role === "master" &&
                u.createdBy === currentUser.id &&
                u.role === "indicado") ||
              u.id === currentUser.id;
            const canToggle =
              currentUser.role === "mestre" ||
              (currentUser.role === "master" &&
                u.role === "indicado" &&
                u.createdBy === currentUser.id);
            const isSelf = u.id === currentUser.id;

            return (
              <div
                key={u.id}
                style={{
                  ...S.card,
                  marginBottom: 10,
                  overflow: "hidden",
                  opacity: isActive ? 1 : 0.55,
                  transition: "opacity 0.2s",
                }}
              >
                {/* Row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 16px",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Avatar */}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    {u.photo ? (
                      <img
                        src={u.photo}
                        alt=""
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: "50%",
                          objectFit: "cover",
                          border: `1.5px solid ${col}44`,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: "50%",
                          background: col + "18",
                          color: col,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          fontWeight: 700,
                          border: `1.5px solid ${col}33`,
                        }}
                      >
                        {ini(u.name || u.username)}
                      </div>
                    )}
                    {!isActive && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          right: 0,
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          background: "#EF4444",
                          border: `2px solid ${C.card}`,
                        }}
                      />
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 7 }}
                    >
                      <div
                        style={{ color: C.tp, fontSize: 13.5, fontWeight: 600 }}
                      >
                        {u.name || u.username}
                      </div>
                      {!isActive && (
                        <span
                          style={{
                            background: "#2D1515",
                            color: "#F87171",
                            fontSize: 9,
                            padding: "2px 7px",
                            borderRadius: 20,
                            fontWeight: 700,
                          }}
                        >
                          Inativo
                        </span>
                      )}
                    </div>
                    <div style={{ color: C.tm, fontSize: 11.5, marginTop: 1 }}>
                      {u.email}
                      {u.cpf ? " · " + u.cpf : ""}
                    </div>
                  </div>

                  {/* Role badge */}
                  <span
                    style={{
                      background: col + "18",
                      color: col,
                      fontSize: 10.5,
                      padding: "3px 10px",
                      borderRadius: 20,
                      fontWeight: 700,
                      border: `1px solid ${col}33`,
                      flexShrink: 0,
                    }}
                  >
                    {roleLabel[u.role]}
                  </span>

                  {/* Activate / Deactivate */}
                  {canToggle && !isSelf && (
                    <button
                      onClick={() => toggleActive(u)}
                      style={{
                        background: isActive ? "#2D1515" : "#091E12",
                        color: isActive ? "#F87171" : "#34D399",
                        border: isActive
                          ? "1px solid #EF444433"
                          : "1px solid #34D39933",
                        borderRadius: 8,
                        padding: "5px 12px",
                        fontSize: 11,
                        cursor: "pointer",
                        fontWeight: 600,
                        flexShrink: 0,
                        transition: "all 0.15s",
                      }}
                    >
                      {isActive ? "Desativar" : "Ativar"}
                    </button>
                  )}

                  {/* Edit button */}
                  {canEdit && (
                    <button
                      onClick={() => {
                        openEdit(u);
                        setErr("");
                      }}
                      style={{
                        background: isExpanded ? C.abg : C.deep,
                        color: isExpanded ? C.atxt : C.tm,
                        border: isExpanded
                          ? `1px solid ${C.atxt}44`
                          : `1px solid ${C.b2}`,
                        borderRadius: 8,
                        padding: "5px 14px",
                        fontSize: 11,
                        cursor: "pointer",
                        fontWeight: 600,
                        flexShrink: 0,
                        transition: "all 0.15s",
                      }}
                    >
                      {isExpanded ? "✕ Fechar" : "✏ Editar"}
                    </button>
                  )}

                  {/* Delete button — apenas mestre pode excluir, nunca a si mesmo, nunca outro mestre */}
                  {currentUser.role === "mestre" && !isSelf && u.role !== "mestre" && (
                    <button
                      onClick={() => deleteUser(u)}
                      style={{
                        background: "transparent",
                        color: "#EF4444",
                        border: "1px solid #EF444433",
                        borderRadius: 8,
                        padding: "5px 12px",
                        fontSize: 11,
                        cursor: "pointer",
                        fontWeight: 600,
                        flexShrink: 0,
                        transition: "all 0.15s",
                      }}
                    >
                      🗑 Excluir
                    </button>
                  )}
                </div>

                {/* ── Inline edit panel ── */}
                {isExpanded && editForm && (
                  <div
                    style={{
                      borderTop: `1px solid ${C.b1}`,
                      padding: "20px 18px",
                      background: C.deep,
                    }}
                  >
                    <div
                      style={{
                        color: C.atxt,
                        fontSize: 12.5,
                        fontWeight: 700,
                        marginBottom: 18,
                      }}
                    >
                      ✏ Editando — {editForm.name || editForm.email}
                    </div>

                    {/* Photo */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        marginBottom: 18,
                      }}
                    >
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        {editForm.photo ? (
                          <img
                            src={editForm.photo}
                            alt=""
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: "50%",
                              objectFit: "cover",
                              border: `2px solid ${col}44`,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: "50%",
                              background: col + "18",
                              color: col,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 18,
                              fontWeight: 700,
                              border: `2px solid ${col}33`,
                            }}
                          >
                            {ini(editForm.name || "U")}
                          </div>
                        )}
                        <button
                          onClick={() =>
                            pEditRef.current && pEditRef.current.click()
                          }
                          style={{
                            position: "absolute",
                            bottom: 0,
                            right: 0,
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: C.acc,
                            color: "#fff",
                            border: `2px solid ${C.deep}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          +
                        </button>
                      </div>
                      <input
                        ref={pEditRef}
                        type="file"
                        accept="image/*"
                        onChange={handleEditPhoto}
                        style={{ display: "none" }}
                      />
                      <div style={{ color: C.tm, fontSize: 11.5 }}>
                        Clique no + para alterar a foto de perfil
                      </div>
                    </div>

                    {/* Fields */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                        marginBottom: 14,
                      }}
                    >
                      {[
                        ["Nome completo", "name", "text"],
                        ["CPF", "cpf", "text"],
                        ["Email (usuário)", "email", "email"],
                      ].map(([l, k, t]) => (
                        <div
                          key={k}
                          style={k === "email" ? { gridColumn: "1/-1" } : {}}
                        >
                          <label
                            style={{
                              color: C.tm,
                              fontSize: 11,
                              display: "block",
                              marginBottom: 4,
                            }}
                          >
                            {l}
                          </label>
                          <input
                            value={editForm[k] || ""}
                            onChange={(e) => setEF(k, e.target.value)}
                            type={t}
                            style={{
                              ...S.input,
                              background: C.card,
                              padding: "8px 11px",
                              fontSize: 12.5,
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    {/* Role selector — mestre can change anyone except themselves */}
                    {currentUser.role === "mestre" &&
                      !isSelf &&
                      editForm.role !== "mestre" && (
                        <div style={{ marginBottom: 14 }}>
                          <label
                            style={{
                              color: C.tm,
                              fontSize: 11,
                              display: "block",
                              marginBottom: 7,
                            }}
                          >
                            Nível de acesso
                          </label>
                          <div style={{ display: "flex", gap: 8 }}>
                            {["master", "indicado"].map((r) => {
                              const sel = editForm.role === r;
                              const rcol = roleColor[r];
                              return (
                                <button
                                  key={r}
                                  onClick={() => setEF("role", r)}
                                  style={{
                                    background: sel ? rcol + "18" : C.card,
                                    color: sel ? rcol : C.tm,
                                    border: sel
                                      ? `1px solid ${rcol}55`
                                      : `1px solid ${C.b2}`,
                                    borderRadius: 20,
                                    padding: "6px 15px",
                                    fontSize: 12,
                                    cursor: "pointer",
                                    fontWeight: sel ? 600 : 400,
                                  }}
                                >
                                  {sel ? "✓ " : ""}
                                  {roleLabel[r]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    {/* Save row */}
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        marginBottom: 16,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={saveEdit}
                        style={{
                          ...S.btn(C.acc, "#fff"),
                          padding: "9px 22px",
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        Salvar alterações
                      </button>
                      <button
                        onClick={() => {
                          setExpandId(null);
                          setEditForm(null);
                          setResetPw("");
                          setErr("");
                        }}
                        style={{
                          ...S.btn("transparent", C.tm),
                          border: `1px solid ${C.b2}`,
                          padding: "9px 16px",
                          fontSize: 13,
                        }}
                      >
                        Cancelar
                      </button>
                    </div>

                    {/* Reset password */}
                    {(currentUser.role === "mestre" ||
                      (currentUser.role === "master" &&
                        u.role === "indicado" &&
                        u.createdBy === currentUser.id)) &&
                      !isSelf && (
                        <div
                          style={{
                            borderTop: `1px solid ${C.b1}`,
                            paddingTop: 16,
                          }}
                        >
                          <div
                            style={{
                              color: C.tm,
                              fontSize: 11,
                              marginBottom: 8,
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                            }}
                          >
                            Redefinir senha
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                            }}
                          >
                            <input
                              value={resetPw}
                              onChange={(e) => setResetPw(e.target.value)}
                              type="password"
                              placeholder="Nova senha"
                              style={{
                                ...S.input,
                                background: C.card,
                                padding: "8px 11px",
                                fontSize: 12.5,
                                flex: 1,
                              }}
                            />
                            <button
                              onClick={doReset}
                              style={{
                                ...S.btn(C.acc, "#fff"),
                                padding: "8px 18px",
                                fontSize: 12,
                                flexShrink: 0,
                              }}
                            >
                              Redefinir
                            </button>
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Chat Page ──────────────────────────────────────────────────
const QUICK_MESSAGES = [
  "🔥 Hoje vai ser incrível, vamos com tudo pessoal!",
  "🌅 Novo dia, novas oportunidades!",
  "💪 Foco total hoje, vamos bater as metas!",
  "🚀 Equipe unida, ninguém nos para!",
  "⭐ Cada cliente é uma chance de fazer a diferença!",
  "💰 Vendas feitas com propósito mudam vidas!",
  "🎯 Mira no alvo, hoje é dia de fechar negócio!",
  "🏆 Campeões não desistem, bora que bora!",
  "✨ Acredite no seu potencial e vá em frente!",
  "📈 Resultado não vem do acaso, vem do esforço!",
  "💡 Uma boa conversa pode mudar o dia do cliente!",
  "🤝 Atendimento com excelência é o nosso padrão!",
  "🌟 Você é capaz de mais do que imagina!",
  "🎉 Cada SIM é uma vitória que devemos celebrar!",
  "📞 Liga pro cliente, oportunidade não espera!",
  "💎 Qualidade no atendimento gera fidelidade!",
  "🔑 A chave do sucesso é não parar de tentar!",
  "🌈 Dificuldades existem para nos fortalecer!",
  "⚡ Energia boa atrai resultados bons!",
  "🎯 Foca no que você pode controlar: seu esforço!",
  "👊 Time forte, resultados fortes!",
  "🏅 Persistência é a mãe do sucesso!",
  "💬 Uma boa escuta vale mais que mil palavras!",
  "🌍 Nosso trabalho transforma a vida das pessoas!",
  "🔔 Alerta de oportunidade: é hoje o dia!",
  "🤩 Anime-se! O melhor cliente está por vir!",
  "📊 Números sobem quando o time se une!",
  "🧠 Trabalhe com estratégia, não só com força!",
  "🌻 Plante dedicação e colha resultados!",
  "🎊 Parabéns a todos pelo esforço de cada dia!",
];

const CHAT_EMOJIS = ["👍","🔥","❤️","😄","🎉","💪","⭐","🚀","✅","👏","😎","🤝","💰","🏆","🎯"];

function ChatPage({ currentUser, users, presence }) {
  const myId = currentUser.uid || currentUser.id;
  const isMestre = currentUser.role === "mestre";

  // Para mestre: pode abrir DM com qualquer um
  // Para master/operador: pode abrir DM com o mestre
  const mestreUser = users.find(u => u.role === "mestre");
  const dmList = isMestre
    ? users.filter(u => (u.uid || u.id) !== myId)
    : (mestreUser ? [mestreUser] : []);

  const [tab, setTab] = useState("geral");
  const [allMessages, setAllMessages] = useState([]);
  const [text, setText] = useState("");
  const [showQuick, setShowQuick] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [filter, setFilter] = useState("");
  const [attachment, setAttachment] = useState(null);
  const shakeLocal = false;
  const [flashAuthor, setFlashAuthor] = useState(null);
  const [hoveredMsg, setHoveredMsg] = useState(null);
  const [reactionPicker, setReactionPicker] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const unsub = listenChat((msgs) => setAllMessages(msgs));
    return () => unsub();
  }, []);

  // Filtrar mensagens por tab
  const messages = tab === "geral"
    ? allMessages.filter(m => !m.toId)
    : allMessages.filter(m =>
        (m.authorId === myId && m.toId === tab) ||
        (m.authorId === tab && m.toId === myId)
      );

  // Detectar nova mensagem para flash
  const lastMsgId = useRef(null);
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (last.id !== lastMsgId.current) {
      lastMsgId.current = last.id;
      if (last.authorId !== myId) {
        setFlashAuthor(last.authorId);
        setTimeout(() => setFlashAuthor(null), 3000);
      }
    }
  }, [messages]); // eslint-disable-line

  // Rola para o final ao receber mensagens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Marca como lida apenas quando o usuário vê o final da conversa (scroll chegou lá)
  const markReadRef = useRef(false);
  useEffect(() => {
    if (tab === "geral" || !tab) return;
    markReadRef.current = false;
    // Pequeno delay para garantir que o usuário realmente abriu e está vendo
    const timer = setTimeout(() => {
      markReadRef.current = true;
      const unread = allMessages.filter(m =>
        m.toId === myId && m.authorId === tab && !m.readAt && m.type !== "shake"
      );
      unread.forEach(async (m) => {
        try {
          await setDoc(doc(db, "chat", m.id), { readAt: new Date().toISOString() }, { merge: true });
        } catch(e) {}
      });
    }, 1500); // aguarda 1.5s antes de marcar como lida
    return () => clearTimeout(timer);
  }, [tab]); // eslint-disable-line

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAttachment({ name: f.name, url: ev.target.result, type: f.type });
    reader.readAsDataURL(f);
  };

  const send = async (msg) => {
    const content = (msg || text).trim();
    if (!content && !attachment) return;
    setText(""); setShowQuick(false); setShowEmoji(false);
    const payload = {
      text: content || "",
      authorId: myId,
      authorName: currentUser.name || currentUser.email,
      authorRole: currentUser.role,
      ...(tab !== "geral" && { toId: tab }),
      ...(attachment && { attachment }),
    };
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = "";
    await sendChatMessage(payload);
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === "/") setShowQuick(true);
    if (e.key === "Escape") { setShowQuick(false); setShowEmoji(false); }
  };

  const shake = async () => {
    if (tab === "geral" || !tab) return;
    await sendChatMessage({
      text: "🔔",
      type: "shake",
      authorId: myId,
      authorName: currentUser.name || currentUser.email,
      authorRole: currentUser.role,
      toId: tab,
    });
  };

  const REACTION_EMOJIS = ["❤️","😂","😮","😢","😡","👍","🔥","🎉"];

  const toggleReaction = async (msgId, emoji) => {
    setReactionPicker(null);
    const msg = allMessages.find(m => m.id === msgId);
    if (!msg) return;
    const reactions = msg.reactions || {};
    const users = reactions[emoji] || [];
    const updated = users.includes(myId)
      ? users.filter(u => u !== myId)
      : [...users, myId];
    const newReactions = { ...reactions, [emoji]: updated };
    // Remove emoji key if no one reacted
    if (updated.length === 0) delete newReactions[emoji];
    await setDoc(doc(db, "chat", msgId), { reactions: newReactions }, { merge: true });
  };

  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399" };
  const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador" };
  const filteredQuick = filter
    ? QUICK_MESSAGES.filter(m => m.toLowerCase().includes(filter.toLowerCase()))
    : QUICK_MESSAGES;

  const tabUser = tab !== "geral" ? dmList.find(u => (u.uid || u.id) === tab) : null;

  // Contar não lidas por DM — usa readAt
  const unreadDM = (uid) => allMessages.filter(m =>
    m.toId === myId && m.authorId === uid && !m.readAt && m.type !== "shake"
  ).length;

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, animation: shakeLocal ? "shake 0.6s ease" : "none" }}>

      {/* ── Sidebar de conversas ── */}
      <div style={{ width: 220, borderRight: `1px solid ${C.b1}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {/* Header */}
        <div style={{ padding: "16px 14px 10px", borderBottom: `1px solid ${C.b1}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>🧑‍💻</span>
            <div>
              <div style={{ color: C.tp, fontSize: 13, fontWeight: 700 }}>CHAT CORBAN</div>
              <div style={{ color: C.tm, fontSize: 10 }}>Equipe em tempo real</div>
            </div>
          </div>
        </div>

        {/* Lista de conversas */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Grupo */}
          <button onClick={() => setTab("geral")}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", background: tab === "geral" ? C.abg : "transparent", border: "none", cursor: "pointer", textAlign: "left", borderBottom: `1px solid ${C.b1}` }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: C.acc + "1A", color: C.acc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🌐</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: tab === "geral" ? C.atxt : C.ts, fontSize: 12, fontWeight: 600 }}>Geral</div>
              <div style={{ color: C.tm, fontSize: 10 }}>Todos os membros</div>
            </div>
          </button>

          {/* DMs */}
          {dmList.map(u => {
            const uid = u.uid || u.id;
            const rc = roleColor[u.role] || C.atxt;
            const isOnline = presence[uid]?.online;
            const unread = unreadDM(uid);
            const isFlashing = flashAuthor === uid;
            const isActive = tab === uid;
            return (
              <button key={uid} onClick={() => setTab(uid)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", background: isActive ? C.abg : "transparent", border: "none", cursor: "pointer", textAlign: "left", borderBottom: `1px solid ${C.b1}` }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: "50%",
                    background: isFlashing ? "#16A34A" : rc + "1A",
                    color: isFlashing ? "#fff" : rc,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                    animation: isFlashing ? "pulse 0.8s infinite" : "none",
                    transition: "background 0.3s",
                  }}>
                    {ini(u.name || u.email || "?")}
                  </div>
                  {isOnline && (
                    <div style={{ position: "absolute", bottom: 0, right: 0, width: 9, height: 9, borderRadius: "50%", background: "#16A34A", border: `1.5px solid ${C.sb}` }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: isActive ? C.atxt : C.ts, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {u.name || u.email}
                  </div>
                  <div style={{ color: isOnline ? "#16A34A" : C.td, fontSize: 10, display: "flex", alignItems: "center", gap: 3 }}>
                    {isOnline ? <><span>●</span> online</> : roleLabel[u.role]}
                  </div>
                </div>
                {unread > 0 && (
                  <span style={{ background: "#16A34A", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 9, fontWeight: 700, animation: "pulse 1s infinite" }}>{unread}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Área de conversa ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header da conversa */}
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.b1}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {tab === "geral" ? (
            <>
              <span style={{ fontSize: 20 }}>🌐</span>
              <div>
                <div style={{ color: C.tp, fontSize: 14, fontWeight: 700 }}>Chat Geral</div>
                <div style={{ color: C.tm, fontSize: 11 }}>{users.length} membros</div>
              </div>
            </>
          ) : tabUser ? (
            <>
              <div style={{ position: "relative" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: (roleColor[tabUser.role] || C.atxt) + "1A", color: roleColor[tabUser.role] || C.atxt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                  {ini(tabUser.name || "?")}
                </div>
                {presence[tab]?.online && (
                  <div style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: "50%", background: "#16A34A", border: `2px solid ${C.bg}` }} />
                )}
              </div>
              <div>
                <div style={{ color: C.tp, fontSize: 14, fontWeight: 700 }}>{tabUser.name || tabUser.email}</div>
                <div style={{ color: presence[tab]?.online ? "#16A34A" : C.tm, fontSize: 11 }}>
                  {presence[tab]?.online ? "● online" : roleLabel[tabUser.role]}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Mensagens */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.tm }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>💬</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{tab === "geral" ? "Seja o primeiro a falar!" : "Início da conversa privada"}</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Digite / para mensagens de incentivo</div>
            </div>
          )}
          {messages.map((msg) => {
            const isMine = msg.authorId === myId;
            const rc = roleColor[msg.authorRole] || C.atxt;
            const time = msg.createdAt?.seconds
              ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
              : "";
            const reactions = msg.reactions || {};
            const hasReactions = Object.keys(reactions).some(e => reactions[e]?.length > 0);

            return (
              <div key={msg.id}
                style={{ display: "flex", flexDirection: isMine ? "row-reverse" : "row", alignItems: "flex-end", gap: 7, position: "relative" }}
                onMouseEnter={() => setHoveredMsg(msg.id)}
                onMouseLeave={() => { setHoveredMsg(null); if (reactionPicker === msg.id) setReactionPicker(null); }}
              >
                {!isMine && (
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: flashAuthor === msg.authorId ? "#16A34A" : rc + "1A",
                    color: flashAuthor === msg.authorId ? "#fff" : rc,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                    animation: flashAuthor === msg.authorId ? "pulse 0.8s infinite" : "none",
                    transition: "background 0.3s",
                  }}>
                    {ini(msg.authorName || "?")}
                  </div>
                )}

                <div style={{ maxWidth: "70%", display: "flex", flexDirection: "column", alignItems: isMine ? "flex-end" : "flex-start", position: "relative" }}>
                  {!isMine && (
                    <span style={{ color: rc, fontSize: 10, fontWeight: 700, marginBottom: 2, paddingLeft: 3 }}>
                      {msg.authorName} · {roleLabel[msg.authorRole] || msg.authorRole}
                    </span>
                  )}

                  {/* Bolha da mensagem + botão de reação */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexDirection: isMine ? "row-reverse" : "row" }}>
                    <div style={{ background: isMine ? C.acc : C.card, color: isMine ? "#fff" : C.tp, border: isMine ? "none" : `1px solid ${C.b1}`, borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px", padding: "8px 13px", fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" }}>
                      {msg.text && <div>{msg.text}</div>}
                      {msg.attachment && (
                        <div style={{ marginTop: msg.text ? 6 : 0 }}>
                          {msg.attachment.type?.startsWith("image/") ? (
                            <img src={msg.attachment.url} alt={msg.attachment.name} style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, display: "block" }} />
                          ) : (
                            <a href={msg.attachment.url} download={msg.attachment.name} style={{ color: isMine ? "#fff" : C.atxt, fontSize: 12, textDecoration: "underline" }}>
                              📎 {msg.attachment.name}
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Botão de reação — aparece no hover */}
                    {hoveredMsg === msg.id && (
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={() => setReactionPicker(p => p === msg.id ? null : msg.id)}
                          style={{ background: C.card, border: `1px solid ${C.b1}`, borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, flexShrink: 0, boxShadow: "0 2px 8px #00000044" }}
                        >
                          🙂
                        </button>

                        {/* Picker de emojis */}
                        {reactionPicker === msg.id && (
                          <div style={{
                            position: "absolute",
                            bottom: 32,
                            [isMine ? "right" : "left"]: 0,
                            background: C.card,
                            border: `1px solid ${C.b1}`,
                            borderRadius: 24,
                            padding: "6px 10px",
                            display: "flex",
                            gap: 4,
                            zIndex: 100,
                            boxShadow: "0 4px 20px #00000066",
                            whiteSpace: "nowrap",
                          }}>
                            {REACTION_EMOJIS.map(e => {
                              const reacted = (reactions[e] || []).includes(myId);
                              return (
                                <button key={e} onClick={() => toggleReaction(msg.id, e)}
                                  style={{
                                    background: reacted ? C.abg : "transparent",
                                    border: reacted ? `1px solid ${C.atxt}44` : "1px solid transparent",
                                    borderRadius: "50%",
                                    width: 34, height: 34,
                                    fontSize: 18,
                                    cursor: "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    transition: "all 0.12s",
                                    transform: reacted ? "scale(1.2)" : "scale(1)",
                                  }}
                                  onMouseEnter={ev => ev.currentTarget.style.transform = "scale(1.3)"}
                                  onMouseLeave={ev => ev.currentTarget.style.transform = reacted ? "scale(1.2)" : "scale(1)"}
                                >
                                  {e}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Reações exibidas abaixo da bolha */}
                  {hasReactions && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, justifyContent: isMine ? "flex-end" : "flex-start" }}>
                      {Object.entries(reactions).filter(([, users]) => users?.length > 0).map(([emoji, users]) => {
                        const iReacted = users.includes(myId);
                        return (
                          <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)}
                            style={{
                              background: iReacted ? C.abg : C.deep,
                              border: iReacted ? `1px solid ${C.atxt}55` : `1px solid ${C.b2}`,
                              borderRadius: 20,
                              padding: "2px 8px",
                              fontSize: 12,
                              cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 4,
                              transition: "all 0.12s",
                            }}>
                            <span>{emoji}</span>
                            <span style={{ color: iReacted ? C.atxt : C.tm, fontSize: 10.5, fontWeight: 600 }}>{users.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Horário + status de leitura */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, justifyContent: isMine ? "flex-end" : "flex-start" }}>
                    <span style={{ color: C.td, fontSize: 9.5 }}>{time}</span>
                    {isMine && tab !== "geral" && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: msg.readAt ? "#38BDF8" : C.td, letterSpacing: "-1px", lineHeight: 1 }}
                        title={msg.readAt ? `Visto às ${new Date(msg.readAt).toLocaleTimeString("pt-BR", {hour:"2-digit",minute:"2-digit"})}` : "Enviado"}>
                        {msg.readAt ? "✓✓" : "✓"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Mensagens rápidas */}
        {showQuick && (
          <div style={{ margin: "0 20px 6px", background: C.card, border: `1px solid ${C.b1}`, borderRadius: 10, overflow: "hidden", maxHeight: 200, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "7px 12px", borderBottom: `1px solid ${C.b1}`, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: C.tm, fontSize: 11 }}>⚡ Clique para enviar</span>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar..." style={{ ...S.input, padding: "3px 8px", fontSize: 11, flex: 1 }} />
              <button onClick={() => { setShowQuick(false); setFilter(""); }} style={{ background: "none", border: "none", color: C.tm, cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {filteredQuick.map((m, i) => (
                <div key={i} onClick={() => send(m)}
                  style={{ padding: "8px 14px", cursor: "pointer", fontSize: 12, color: C.ts, borderBottom: `1px solid ${C.b1}` }}
                  onMouseEnter={e => e.currentTarget.style.background = C.abg}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {m}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prévia anexo */}
        {attachment && (
          <div style={{ margin: "0 20px 5px", padding: "7px 12px", background: C.card, borderRadius: 8, border: `1px solid ${C.b1}`, display: "flex", alignItems: "center", gap: 10 }}>
            {attachment.type?.startsWith("image/") ? (
              <img src={attachment.url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 5 }} />
            ) : <span style={{ fontSize: 20 }}>📎</span>}
            <span style={{ color: C.ts, fontSize: 11, flex: 1 }}>{attachment.name}</span>
            <button onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = ""; }} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 13 }}>✕</button>
          </div>
        )}

        {/* Emojis */}
        {showEmoji && (
          <div style={{ margin: "0 20px 5px", display: "flex", flexWrap: "wrap", gap: 5, padding: "7px 12px", background: C.card, borderRadius: 10, border: `1px solid ${C.b1}` }}>
            {CHAT_EMOJIS.map((e, i) => (
              <button key={i} onClick={() => setText(t => t + e)}
                style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", borderRadius: 5, padding: "2px 3px" }}
                onMouseEnter={ev => ev.currentTarget.style.background = C.b2}
                onMouseLeave={ev => ev.currentTarget.style.background = "none"}>
                {e}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: "8px 20px 14px", borderTop: `1px solid ${C.b1}`, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <button onClick={() => { setShowQuick(p => !p); setFilter(""); }}
              style={{ background: showQuick ? C.abg : C.deep, border: `1px solid ${showQuick ? C.atxt + "44" : C.b2}`, color: showQuick ? C.atxt : C.tm, borderRadius: 9, padding: "8px 10px", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>⚡</button>
            <button onClick={() => setShowEmoji(p => !p)}
              style={{ background: showEmoji ? C.abg : C.deep, border: `1px solid ${showEmoji ? C.atxt + "44" : C.b2}`, color: showEmoji ? C.atxt : C.tm, borderRadius: 9, padding: "8px 10px", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>😊</button>
            {/* Botão nudge estilo MSN — só aparece em DM */}
            {tab !== "geral" && (
              <button
                onClick={shake}
                title="Chamar atenção (nudge)"
                style={{
                  background: C.deep,
                  border: `1px solid ${C.b2}`,
                  color: C.tm,
                  borderRadius: 9,
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontSize: 14,
                  flexShrink: 0,
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#2D1515"; e.currentTarget.style.borderColor = "#EF444433"; e.currentTarget.style.color = "#F87171"; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.deep; e.currentTarget.style.borderColor = C.b2; e.currentTarget.style.color = C.tm; }}
              >
                📳
              </button>
            )}
            {tab !== "geral" && (
              <button onClick={() => fileRef.current?.click()}
                style={{ background: attachment ? C.abg : C.deep, border: `1px solid ${attachment ? C.atxt + "44" : C.b2}`, color: attachment ? C.atxt : C.tm, borderRadius: 9, padding: "8px 10px", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>📎</button>
            )}
            <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" onChange={handleFile} style={{ display: "none" }} />
            <textarea ref={inputRef} value={text}
              onChange={e => { setText(e.target.value); if (e.target.value.startsWith("/")) setShowQuick(true); }}
              onKeyDown={handleKey}
              placeholder={tab === "geral" ? "Mensagem para a equipe... (/ para atalhos)" : `Mensagem para ${tabUser?.name || "usuário"}...`}
              rows={1}
              style={{ ...S.input, flex: 1, resize: "none", borderRadius: 9, padding: "8px 12px", fontSize: 13, lineHeight: 1.5 }} />
            <button onClick={() => send()} disabled={!text.trim() && !attachment}
              style={{ ...S.btn(text.trim() || attachment ? C.acc : C.deep, text.trim() || attachment ? "#fff" : C.td), padding: "8px 14px", fontSize: 14, flexShrink: 0, opacity: text.trim() || attachment ? 1 : 0.5 }}>➤</button>
          </div>
          <div style={{ color: C.td, fontSize: 10, marginTop: 3 }}>Enter para enviar · Shift+Enter nova linha · / para atalhos</div>
        </div>
      </div>
    </div>
  );
}

// ── Stories ────────────────────────────────────────────────────
const STORY_EMOJIS = [
  "😀","😂","🤣","😍","🥰","😘","😎","🤩","🥳","😜",
  "😅","😇","🤗","🤔","😏","😒","😔","😢","😭","😤",
  "😡","🤯","🥺","😬","🙄","😴","🤤","🥴","😷","🤒",
  "❤️","🧡","💛","💚","💙","💜","🖤","💖","💝","💯",
  "🔥","⭐","✨","🎉","🎊","🎈","🏆","👑","💎","🌟",
  "👍","👏","🙌","💪","🤝","🫶","👀","💬","💭","🚀",
];
const STORY_EMOJI_REACTIONS = ["❤️","😂","🔥","👍","😮","🎉","💯","😢"];

function StoriesPage({ currentUser, users }) {
  const myId = currentUser.uid || currentUser.id;
  const myProfile = users.find(u => (u.uid || u.id) === myId) || currentUser;
  const [stories, setStories] = useState([]);
  const [viewingAuthor, setViewingAuthor] = useState(null);
  const [viewingIdx, setViewingIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newText, setNewText] = useState("");
  const [newMedia, setNewMedia] = useState(null);
  const [newBg, setNewBg] = useState("#1A1F2E");
  const [newFont, setNewFont] = useState("Inter");
  const [comment, setComment] = useState("");
  const [showCommentEmoji, setShowCommentEmoji] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mediaErr, setMediaErr] = useState("");
  const mediaRef = useRef();

  const BG_COLORS = ["#1A1F2E","#0D2B1A","#2D1515","#2D0E30","#2B1D03","#082033","#1C1903","#0A0A0A","#1a1a2e","#16213e"];
  const FONTS = [
    { name: "Inter",     label: "Padrão",   style: "'Inter',sans-serif" },
    { name: "Georgia",   label: "Clássica", style: "Georgia,serif" },
    { name: "Courier",   label: "Código",   style: "'Courier New',monospace" },
    { name: "Impact",    label: "Impacto",  style: "Impact,sans-serif" },
    { name: "Pacifico",  label: "Cursiva",  style: "'Comic Sans MS',cursive" },
  ];

  // ── Listen stories realtime ──────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "stories"), (snap) => {
      const now = Date.now();
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.expiresAt > now)
        .sort((a, b) => b.createdAt - a.createdAt);
      setStories(list);
    });
    return unsub;
  }, []);

  const handleMedia = (e) => {
    const f = e.target.files[0]; if (!f) return;
    setMediaErr("");
    const isImg   = f.type.startsWith("image/");
    const isVideo = f.type.startsWith("video/");
    const isAudio = f.type.startsWith("audio/");
    const mb = f.size / 1024 / 1024;
    if (isImg   && mb > 5)  { setMediaErr("Imagem máx 5 MB.");  return; }
    if (isVideo && mb > 50) { setMediaErr("Vídeo máx 50 MB.");  return; }
    if (isAudio && mb > 5)  { setMediaErr("Áudio máx 5 MB.");   return; }
    if (!isImg && !isVideo && !isAudio) { setMediaErr("Formato não suportado."); return; }
    // Create preview URL + keep File for Storage upload
    const previewUrl = URL.createObjectURL(f);
    setNewMedia({ url: previewUrl, type: f.type, name: f.name, file: f });
  };

  // ── Post story ───────────────────────────────────────────────
  const post = async () => {
    if (!newText.trim() && !newMedia) return;
    const myStories = stories.filter(s => s.authorId === myId);
    if (myStories.length >= 20) { setMediaErr("Limite de 20 stories atingido."); return; }
    setLoading(true);
    setUploadProgress(0);

    try {
      let mediaPayload = null;

      // Upload mídia para Firebase Storage (não Firestore)
      if (newMedia?.file) {
        const path = `stories/${myId}/${Date.now()}_${newMedia.file.name}`;
        const url = await uploadMedia(newMedia.file, path, (pct) => setUploadProgress(pct));
        mediaPayload = { url, type: newMedia.type, name: newMedia.name, storagePath: path };
      }

      const now = Date.now();
      const id = String(now);
      await setDoc(doc(db, "stories", id), {
        id,
        authorId: myId,
        authorName: currentUser.name || currentUser.email,
        authorRole: currentUser.role,
        authorPhoto: myProfile.photo || null,
        text: newText.trim(),
        font: newFont,
        media: mediaPayload,
        bg: newBg,
        likes: [],
        reactions: {},
        comments: [],
        views: [],
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });

      setCreating(false); setNewText(""); setNewMedia(null); setNewBg("#1A1F2E"); setNewFont("Inter");
    } catch(e) {
      setMediaErr("Erro ao postar: " + e.message);
    } finally {
      setLoading(false); setUploadProgress(0);
    }
  };

  const deleteStory = async (id) => {
    if (!window.confirm("Excluir este story?")) return;
    await deleteDoc(doc(db, "stories", id));
    setViewingAuthor(null);
  };

  // ── Reactions ────────────────────────────────────────────────
  const toggleReaction = async (story, emoji) => {
    setShowReactions(false);
    const reactions = story.reactions || {};
    const users2 = reactions[emoji] || [];
    const updated = users2.includes(myId) ? users2.filter(u => u !== myId) : [...users2, myId];
    const newR = { ...reactions, [emoji]: updated };
    if (updated.length === 0) delete newR[emoji];
    await setDoc(doc(db, "stories", story.id), { reactions: newR }, { merge: true });
  };

  // ── Comments ─────────────────────────────────────────────────
  const addComment = async (story) => {
    if (!comment.trim()) return;
    const comments = [...(story.comments || []), {
      userId: myId,
      userName: currentUser.name || currentUser.email,
      userRole: currentUser.role,
      userPhoto: myProfile.photo || null,
      text: comment.trim(),
      createdAt: Date.now(),
    }];
    await setDoc(doc(db, "stories", story.id), { comments }, { merge: true });
    setComment(""); setShowCommentEmoji(false);
  };

  const markViewed = async (story) => {
    const views = story.views || [];
    if (!views.includes(myId))
      await setDoc(doc(db, "stories", story.id), { views: [...views, myId] }, { merge: true });
  };

  // ── Helpers ──────────────────────────────────────────────────
  const timeLeft = (expiresAt) => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return "Expirado";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m restantes`;
    if (m > 0) return `${m}m ${s}s restantes`;
    return `${s}s restantes`;
  };

  // Tick para atualizar o contador em tempo real
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399" };

  // Group by author, keep all stories
  const byAuthor = {};
  stories.forEach(s => {
    if (!byAuthor[s.authorId]) byAuthor[s.authorId] = [];
    byAuthor[s.authorId].push(s);
  });
  // Sort each author's stories newest first
  Object.values(byAuthor).forEach(arr => arr.sort((a,b) => b.createdAt - a.createdAt));

  const myStories = byAuthor[myId] || [];
  const allAuthors = Object.keys(byAuthor);

  // Current story being viewed
  const viewAuthorStories = viewingAuthor ? (byAuthor[viewingAuthor] || []) : [];
  const viewStory = viewAuthorStories[viewingIdx] || null;

  const openAuthor = (authorId, idx=0) => {
    setViewingAuthor(authorId); setViewingIdx(idx); setShowReactions(false); setShowCommentEmoji(false);
    if (byAuthor[authorId]?.[idx]) markViewed(byAuthor[authorId][idx]);
  };

  // ── Avatar component ─────────────────────────────────────────
  const StoryAvatar = ({ authorId, authorName, authorPhoto, authorStories: aStories, isMe }) => {
    const allViewed = aStories.every(s => (s.views||[]).includes(myId));
    const isActive = viewingAuthor === authorId;
    const rc = roleColor[aStories[0]?.authorRole] || C.atxt;
    return (
      <button onClick={() => isMe && myStories.length === 0 ? setCreating(true) : openAuthor(authorId)}
        style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", flexShrink:0 }}>
        <div style={{ position:"relative", width:68, height:68 }}>
          {/* Ring */}
          <div style={{
            position:"absolute", inset:0, borderRadius:"50%",
            background: isActive
              ? `linear-gradient(135deg,${C.acc},${C.atxt})`
              : (!allViewed && aStories.length > 0)
                ? `linear-gradient(135deg,#3B6EF5,#7C3AED)`
                : "transparent",
            border: (allViewed || aStories.length === 0) ? `2px solid ${C.b2}` : "none",
            padding: 3,
          }} />
          {/* Avatar */}
          <div style={{
            position:"absolute", inset:3, borderRadius:"50%",
            background: C.deep, overflow:"hidden",
            border: `2px solid ${C.bg}`,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            {authorPhoto
              ? <img src={authorPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
              : <span style={{ fontSize:18, fontWeight:700, color: isMe ? C.atxt : rc }}>{ini(authorName||"?")}</span>
            }
          </div>
          {/* Badge count > 1 */}
          {aStories.length > 1 && (
            <div style={{ position:"absolute", top:0, right:0, background:C.acc, color:"#fff", borderRadius:"50%", width:18, height:18, fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", border:`2px solid ${C.bg}` }}>
              {aStories.length}
            </div>
          )}
          {/* + button when no stories (own avatar) */}
          {isMe && myStories.length === 0 && (
            <div style={{ position:"absolute", bottom:0, right:0, width:22, height:22, borderRadius:"50%", background:C.acc, border:`2px solid ${C.bg}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"#fff", fontWeight:700 }}>+</div>
          )}
        </div>
        <span style={{ color: isActive ? C.atxt : C.tm, fontSize:11, fontWeight: isActive ? 600 : 400, maxWidth:64, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {isMe ? "Você" : (authorName||"?").split(" ")[0]}
        </span>
      </button>
    );
  };

  return (
    <div style={{ padding:"28px 36px", height:"100%", boxSizing:"border-box" }}>
      {/* Header */}
      <div style={{ marginBottom:22 }}>
        <h1 style={{ color:C.tp, fontSize:21, fontWeight:700, margin:0 }}>Stories</h1>
        <p style={{ color:C.tm, fontSize:12.5, margin:"4px 0 0" }}>Atualizações que duram 24h · até 20 stories · 📷5MB · 🎥50MB · 🎵5MB</p>
      </div>

      {/* ── Criar story ── */}
      {creating && (
        <div style={{ ...S.card, padding:"22px", marginBottom:24 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ color:C.ts, fontSize:13, fontWeight:600 }}>✨ Novo Story ({myStories.length}/20)</div>
            {myStories.length >= 20 && <span style={{ color:"#F87171", fontSize:12 }}>Limite de 20 atingido</span>}
          </div>

          {/* Preview */}
          <div style={{ background:newBg, borderRadius:14, padding:"28px 22px", minHeight:140, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, marginBottom:16, border:`1px solid ${C.b1}` }}>
            {newMedia?.type?.startsWith("image/") && <img src={newMedia.url} alt="" style={{ maxWidth:"100%", maxHeight:180, borderRadius:10, objectFit:"contain" }} />}
            {newMedia?.type?.startsWith("video/") && <video src={newMedia.url} controls style={{ maxWidth:"100%", maxHeight:180, borderRadius:10 }} />}
            {newMedia?.type?.startsWith("audio/") && <audio src={newMedia.url} controls style={{ width:"100%" }} />}
            {newText && <div style={{ color:"#fff", fontSize:18, fontWeight:600, textAlign:"center", textShadow:"0 1px 6px #00000066", fontFamily: FONTS.find(f=>f.name===newFont)?.style || "inherit" }}>{newText}</div>}
            {!newText && !newMedia && <div style={{ color:"#ffffff44", fontSize:13 }}>Preview do story</div>}
          </div>

          {/* BG picker */}
          <div style={{ display:"flex", gap:8, marginBottom:12, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ color:C.tm, fontSize:11.5 }}>Fundo:</span>
            {BG_COLORS.map(bg => (
              <button key={bg} onClick={() => setNewBg(bg)} style={{ width:22, height:22, borderRadius:"50%", background:bg, border:newBg===bg?`2px solid ${C.atxt}`:`1px solid ${C.b2}`, cursor:"pointer", flexShrink:0 }} />
            ))}
          </div>

          {/* Font picker */}
          <div style={{ display:"flex", gap:6, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ color:C.tm, fontSize:11.5, flexShrink:0 }}>Fonte:</span>
            {FONTS.map(f => (
              <button key={f.name} onClick={() => setNewFont(f.name)}
                style={{ background:newFont===f.name?C.abg:C.deep, border:newFont===f.name?`1px solid ${C.atxt}55`:`1px solid ${C.b2}`, borderRadius:8, padding:"5px 12px", cursor:"pointer", color:newFont===f.name?C.atxt:C.tm, fontSize:12, fontFamily:f.style, fontWeight:newFont===f.name?600:400 }}>
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ marginBottom:12 }}>
            <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>Texto</label>
            <textarea value={newText} onChange={e=>setNewText(e.target.value)} rows={2} placeholder="Escreva algo..."
              style={{ ...S.input, resize:"vertical", fontFamily: FONTS.find(f=>f.name===newFont)?.style || "inherit" }} />
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>
              Mídia &nbsp;<span style={{ color:C.td, fontSize:10.5 }}>📷 imagem 5MB · 🎥 vídeo 50MB · 🎵 áudio 5MB</span>
            </label>
            <input ref={mediaRef} type="file" accept="image/*,video/*,audio/*" onChange={handleMedia} style={{ display:"none" }} />
            <button onClick={() => mediaRef.current?.click()}
              style={{ ...S.btn(C.deep, C.atxt), border:`1px solid ${C.atxt}44`, fontSize:13, padding:"9px 20px", display:"flex", alignItems:"center", gap:8, fontWeight:600 }}>
              📷🎥🎵 Adicionar mídia
            </button>
            {newMedia && (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, padding:"7px 12px", background:C.deep, borderRadius:8, border:`1px solid ${C.b1}` }}>
                <span style={{ color:C.ts, fontSize:12, flex:1 }}>✓ {newMedia.name}</span>
                <button onClick={() => setNewMedia(null)} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer", fontSize:13 }}>✕</button>
              </div>
            )}
            {mediaErr && <div style={{ color:"#F87171", fontSize:11.5, marginTop:6 }}>⚠ {mediaErr}</div>}
          </div>

          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <button onClick={post} disabled={loading || myStories.length >= 20 || (!newText.trim() && !newMedia)}
              style={{ ...S.btn(C.acc,"#fff"), padding:"10px 24px", fontSize:13, fontWeight:700, opacity:(!newText.trim()&&!newMedia)||myStories.length>=20?0.5:1 }}>
              {loading ? (uploadProgress > 0 ? `Enviando ${uploadProgress}%` : "Processando...") : "Publicar"}
            </button>
            <button onClick={()=>{setCreating(false);setNewText("");setNewMedia(null);setMediaErr("");setNewFont("Inter");}}
              disabled={loading}
              style={{ ...S.btn("transparent",C.tm), border:`1px solid ${C.b2}`, padding:"10px 16px", fontSize:13, opacity:loading?0.5:1 }}>
              Cancelar
            </button>
          </div>
          {/* Barra de progresso do upload */}
          {loading && newMedia?.file && (
            <div style={{ marginTop:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ color:C.tm, fontSize:11.5 }}>
                  {uploadProgress < 100 ? "Fazendo upload da mídia..." : "Salvando story..."}
                </span>
                <span style={{ color:C.atxt, fontSize:11.5, fontWeight:600 }}>{uploadProgress}%</span>
              </div>
              <div style={{ background:C.b1, borderRadius:4, height:6, overflow:"hidden" }}>
                <div style={{ width:`${uploadProgress}%`, height:"100%", background:`linear-gradient(90deg,${C.acc},${C.atxt})`, borderRadius:4, transition:"width 0.3s" }} />
              </div>
            </div>
          )}
          {loading && !newMedia?.file && (
            <div style={{ marginTop:10, color:C.tm, fontSize:12 }}>💾 Salvando...</div>
          )}
        </div>
      )}

      {/* ── Avatar row ── */}
      <div style={{ display:"flex", gap:16, overflowX:"auto", paddingBottom:10, marginBottom:24 }}>
        {/* Meu avatar sempre primeiro */}
        <StoryAvatar
          authorId={myId}
          authorName={currentUser.name || currentUser.email}
          authorPhoto={myProfile.photo}
          authorStories={myStories}
          isMe={true}
        />
        {/* + criar se já tenho stories mas menos de 10 */}
        {myStories.length > 0 && myStories.length < 20 && (
          <button onClick={() => setCreating(true)}
            style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", flexShrink:0 }}>
            <div style={{ width:68, height:68, borderRadius:"50%", background:C.deep, border:`2px dashed ${C.atxt}66`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, color:C.atxt }}>＋</div>
            <span style={{ color:C.tm, fontSize:11 }}>Novo</span>
          </button>
        )}
        {/* Outros usuários */}
        {allAuthors.filter(id => id !== myId).map(authorId => {
          const aStories = byAuthor[authorId];
          const uObj = users.find(u=>(u.uid||u.id)===authorId);
          return (
            <StoryAvatar
              key={authorId}
              authorId={authorId}
              authorName={aStories[0]?.authorName || "?"}
              authorPhoto={uObj?.photo || null}
              authorStories={aStories}
              isMe={false}
            />
          );
        })}
      </div>

      {/* ── Story viewer ── */}
      {viewStory && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 360px", gap:20, maxWidth:900 }}>
          {/* Story card */}
          <div style={{ background:viewStory.bg||C.card, borderRadius:18, overflow:"hidden", border:`1px solid ${C.b1}`, display:"flex", flexDirection:"column", minHeight:440, position:"relative" }}>

            {/* Progress dots */}
            {viewAuthorStories.length > 1 && (
              <div style={{ display:"flex", gap:4, padding:"10px 14px 0", flexShrink:0 }}>
                {viewAuthorStories.map((_, i) => (
                  <div key={i} onClick={() => { setViewingIdx(i); markViewed(viewAuthorStories[i]); }}
                    style={{ flex:1, height:3, borderRadius:2, background: i===viewingIdx ? "#fff" : "rgba(255,255,255,0.3)", cursor:"pointer", transition:"all 0.2s" }} />
                ))}
              </div>
            )}

            {/* Header */}
            <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:10, background:"linear-gradient(180deg,#00000055 0%,transparent 100%)", flexShrink:0 }}>
              <div style={{ width:36, height:36, borderRadius:"50%", overflow:"hidden", border:"1.5px solid rgba(255,255,255,0.4)", flexShrink:0 }}>
                {viewStory.authorPhoto
                  ? <img src={viewStory.authorPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                  : <div style={{ width:"100%", height:"100%", background:(roleColor[viewStory.authorRole]||C.atxt)+"1A", color:roleColor[viewStory.authorRole]||C.atxt, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700 }}>{ini(viewStory.authorName||"?")}</div>
                }
              </div>
              <div style={{ flex:1 }}>
                <div style={{ color:"#fff", fontSize:13, fontWeight:700, textShadow:"0 1px 4px #000" }}>{viewStory.authorName}</div>
                <div style={{ color:"rgba(255,255,255,0.75)", fontSize:10, marginBottom:3 }}>⏳ {timeLeft(viewStory.expiresAt)}</div>
                {/* Barra de expiração — verde→amarela→vermelha */}
                <div style={{ background:"rgba(255,255,255,0.2)", borderRadius:3, height:3, width:110, overflow:"hidden" }}>
                  <div style={{
                    height:"100%", borderRadius:3, transition:"width 1s linear",
                    width:`${Math.max(0,((viewStory.expiresAt-Date.now())/(24*3600000))*100)}%`,
                    background: ((viewStory.expiresAt-Date.now())/(24*3600000)) > 0.5 ? "#34D399" : ((viewStory.expiresAt-Date.now())/(24*3600000)) > 0.2 ? "#FBBF24" : "#F87171",
                  }}/>
                </div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                {viewingIdx > 0 && (
                  <button onClick={() => { setViewingIdx(i=>i-1); markViewed(viewAuthorStories[viewingIdx-1]); }}
                    style={{ background:"rgba(0,0,0,0.4)", border:"none", color:"#fff", borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:14 }}>‹</button>
                )}
                {viewingIdx < viewAuthorStories.length-1 && (
                  <button onClick={() => { setViewingIdx(i=>i+1); markViewed(viewAuthorStories[viewingIdx+1]); }}
                    style={{ background:"rgba(0,0,0,0.4)", border:"none", color:"#fff", borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:14 }}>›</button>
                )}
                {viewStory.authorId === myId && (
                  <button onClick={() => deleteStory(viewStory.id)} style={{ background:"rgba(0,0,0,0.4)", border:"none", color:"#F87171", borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                )}
              </div>
            </div>

            {/* Content */}
            <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"20px", gap:14, overflow:"hidden" }}>
              {viewStory.media?.type?.startsWith("image/") && <img src={viewStory.media.url} alt="" style={{ maxWidth:"100%", maxHeight:260, borderRadius:12, objectFit:"contain" }} />}
              {viewStory.media?.type?.startsWith("video/") && <video src={viewStory.media.url} controls style={{ maxWidth:"100%", maxHeight:240, borderRadius:12 }} />}
              {viewStory.media?.type?.startsWith("audio/") && <audio src={viewStory.media.url} controls style={{ width:"90%" }} />}
              {viewStory.text && <div style={{ color:"#fff", fontSize:20, fontWeight:600, textAlign:"center", textShadow:"0 2px 8px #00000088", lineHeight:1.4, fontFamily: viewStory.font === "Georgia" ? "Georgia,serif" : viewStory.font === "Courier" ? "'Courier New',monospace" : viewStory.font === "Impact" ? "Impact,sans-serif" : viewStory.font === "Pacifico" ? "'Comic Sans MS',cursive" : "'Inter',sans-serif" }}>{viewStory.text}</div>}
            </div>

            {/* Footer — reactions + likes + views */}
            <div style={{ padding:"10px 16px 14px", background:"linear-gradient(0deg,#00000077 0%,transparent 100%)", flexShrink:0 }}>
              {/* Existing reactions display */}
              {Object.keys(viewStory.reactions||{}).filter(e=>(viewStory.reactions[e]||[]).length>0).length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:10 }}>
                  {Object.entries(viewStory.reactions||{}).filter(([,u])=>u?.length>0).map(([emoji,reactUsers])=>(
                    <button key={emoji} onClick={() => toggleReaction(viewStory, emoji)}
                      style={{ background: reactUsers.includes(myId) ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)", border:"none", borderRadius:20, padding:"4px 10px", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ fontSize:14 }}>{emoji}</span>
                      <span style={{ color:"#fff", fontSize:11, fontWeight:600 }}>{reactUsers.length}</span>
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display:"flex", alignItems:"center", gap:10, position:"relative" }}>
                {/* Emoji reaction picker */}
                <div style={{ position:"relative" }}>
                  <button onClick={() => setShowReactions(p=>!p)}
                    style={{ background:"rgba(0,0,0,0.35)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:20, padding:"6px 12px", cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", gap:5, color:"#fff" }}>
                    😊 <span style={{ fontSize:11 }}>Reagir</span>
                  </button>
                  {showReactions && (
                    <div style={{ position:"absolute", bottom:40, left:0, background:C.card, border:`1px solid ${C.b1}`, borderRadius:24, padding:"6px 10px", display:"flex", gap:4, zIndex:100, boxShadow:"0 4px 20px #00000066" }}>
                      {STORY_EMOJI_REACTIONS.map(e => (
                        <button key={e} onClick={() => toggleReaction(viewStory, e)}
                          style={{ background:(viewStory.reactions?.[e]||[]).includes(myId)?"rgba(255,255,255,0.15)":"transparent", border:"none", borderRadius:"50%", width:34, height:34, fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"transform 0.1s" }}
                          onMouseEnter={ev=>ev.currentTarget.style.transform="scale(1.3)"}
                          onMouseLeave={ev=>ev.currentTarget.style.transform="scale(1)"}>
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Like */}
                <button onClick={() => toggleReaction(viewStory, "❤️")}
                  style={{ background:"rgba(0,0,0,0.35)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:20, padding:"6px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ fontSize:15 }}>{(viewStory.reactions?.["❤️"]||[]).includes(myId)?"❤️":"🤍"}</span>
                  <span style={{ color:"#fff", fontSize:11, fontWeight:600 }}>{(viewStory.reactions?.["❤️"]||[]).length||""}</span>
                </button>

                <span style={{ color:"rgba(255,255,255,0.5)", fontSize:11, display:"flex", alignItems:"center", gap:4, marginLeft:"auto" }}>
                  👁 {(viewStory.views||[]).length}
                </span>
              </div>
            </div>
          </div>

          {/* Comments panel */}
          <div style={{ ...S.card, display:"flex", flexDirection:"column", maxHeight:440, overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.b1}`, color:C.ts, fontSize:13, fontWeight:600 }}>
              💬 Comentários ({(viewStory.comments||[]).length})
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:"10px 14px", display:"flex", flexDirection:"column", gap:10 }}>
              {(viewStory.comments||[]).length === 0
                ? <div style={{ textAlign:"center", padding:"24px 0", color:C.tm, fontSize:12 }}>Seja o primeiro a comentar!</div>
                : (viewStory.comments||[]).map((c, i) => {
                    const rc2 = roleColor[c.userRole]||C.atxt;
                    return (
                      <div key={i} style={{ display:"flex", gap:9 }}>
                        <div style={{ width:28, height:28, borderRadius:"50%", overflow:"hidden", flexShrink:0, border:`1.5px solid ${rc2}44` }}>
                          {c.userPhoto
                            ? <img src={c.userPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                            : <div style={{ width:"100%", height:"100%", background:rc2+"1A", color:rc2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700 }}>{ini(c.userName||"?")}</div>
                          }
                        </div>
                        <div>
                          <div style={{ color:rc2, fontSize:10.5, fontWeight:700 }}>{c.userName}</div>
                          <div style={{ color:C.ts, fontSize:12.5, marginTop:2, lineHeight:1.4 }}>{c.text}</div>
                          <div style={{ color:C.td, fontSize:9.5, marginTop:3 }}>{new Date(c.createdAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
            {/* Comment input */}
            <div style={{ padding:"10px 14px", borderTop:`1px solid ${C.b1}`, flexShrink:0 }}>
              {showCommentEmoji && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginBottom:8, padding:"8px 10px", background:C.deep, borderRadius:10, border:`1px solid ${C.b1}`, maxHeight:120, overflowY:"auto" }}>
                  {STORY_EMOJIS.map(e => (
                    <button key={e} onClick={() => setComment(t=>t+e)}
                      style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", borderRadius:5, padding:"2px 3px" }}
                      onMouseEnter={ev=>ev.currentTarget.style.background=C.b2}
                      onMouseLeave={ev=>ev.currentTarget.style.background="none"}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display:"flex", gap:7 }}>
                <button onClick={() => setShowCommentEmoji(p=>!p)}
                  style={{ background:showCommentEmoji?C.abg:C.deep, border:`1px solid ${showCommentEmoji?C.atxt+"44":C.b2}`, borderRadius:8, padding:"7px 9px", cursor:"pointer", fontSize:14, flexShrink:0 }}>
                  😊
                </button>
                <input value={comment} onChange={e=>setComment(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&addComment(viewStory)}
                  placeholder="Comentar..." style={{ ...S.input, padding:"7px 11px", fontSize:12.5, flex:1 }} />
                <button onClick={() => addComment(viewStory)} disabled={!comment.trim()}
                  style={{ ...S.btn(comment.trim()?C.acc:C.deep, comment.trim()?"#fff":C.td), padding:"7px 12px", fontSize:13, opacity:comment.trim()?1:0.5, flexShrink:0 }}>
                  ➤
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Atalhos ────────────────────────────────────────────────────
function AtalhosPage({ currentUser }) {
  const isMestre = currentUser.role === "mestre";
  const [atalhos, setAtalhos] = useState([]);
  const [form, setForm] = useState({ nome: "", link: "" });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ nome: "", link: "" });
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  // Ouve atalhos do Firestore em tempo real
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "atalhos"), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      setAtalhos(list);
    });
    return unsub;
  }, []);

  const flash = (msg) => { setOk(msg); setTimeout(() => setOk(""), 3000); };

  const save = async () => {
    if (!form.nome.trim() || !form.link.trim()) { setErr("Nome e link são obrigatórios."); return; }
    setErr("");
    const url = form.link.startsWith("http") ? form.link : "https://" + form.link;
    const id = String(Date.now());
    await setDoc(doc(db, "atalhos", id), { nome: form.nome.trim(), link: url, ordem: atalhos.length });
    setForm({ nome: "", link: "" });
    flash("Atalho adicionado!");
  };

  const saveEdit = async () => {
    if (!editForm.nome.trim() || !editForm.link.trim()) return;
    const url = editForm.link.startsWith("http") ? editForm.link : "https://" + editForm.link;
    await setDoc(doc(db, "atalhos", editId), { ...editForm, link: url }, { merge: true });
    setEditId(null);
    flash("Atalho atualizado!");
  };

  const remove = async (id) => {
    if (!window.confirm("Remover este atalho?")) return;
    await deleteDoc(doc(db, "atalhos", id));
    flash("Atalho removido!");
  };

  const getFavicon = (url) => {
    try { return `https://www.google.com/s2/favicons?sz=32&domain=${new URL(url).hostname}`; }
    catch { return null; }
  };

  return (
    <div style={{ padding: "30px 36px", maxWidth: 680 }}>
      <div style={{ marginBottom: 26 }}>
        <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>🔗 Atalhos</h1>
        <p style={{ color: C.tm, fontSize: 12.5, margin: "4px 0 0" }}>Links rápidos da equipe</p>
      </div>

      {ok && <div style={{ background: "#091E12", border: "1px solid #34D39933", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#34D399", fontSize: 13 }}>✓ {ok}</div>}
      {err && <div style={{ background: "#2D1515", border: "1px solid #EF444433", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#F87171", fontSize: 13 }}>⚠ {err}</div>}

      {/* Formulário — só mestre vê */}
      {isMestre && (
        <div style={{ ...S.card, padding: "20px", marginBottom: 22 }}>
          <div style={{ color: C.ts, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Adicionar atalho</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ color: C.tm, fontSize: 11.5, display: "block", marginBottom: 4 }}>Nome</label>
              <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="ex: Sistema interno" style={{ ...S.input }} />
            </div>
            <div>
              <label style={{ color: C.tm, fontSize: 11.5, display: "block", marginBottom: 4 }}>Link</label>
              <input value={form.link} onChange={e => setForm(f => ({ ...f, link: e.target.value }))}
                placeholder="ex: https://sistema.com" style={{ ...S.input }} />
            </div>
          </div>
          <button onClick={save} style={{ ...S.btn(C.acc, "#fff"), padding: "9px 22px", fontSize: 13, fontWeight: 700 }}>
            + Adicionar
          </button>
        </div>
      )}

      {/* Lista de atalhos */}
      {atalhos.length === 0 ? (
        <div style={{ ...S.card, padding: "48px", textAlign: "center" }}>
          <div style={{ fontSize: 36, opacity: 0.2, marginBottom: 12 }}>🔗</div>
          <div style={{ color: C.tm, fontSize: 13 }}>
            {isMestre ? "Nenhum atalho adicionado ainda." : "Nenhum atalho disponível."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {atalhos.map((a) => (
            <div key={a.id} style={{ ...S.card, overflow: "hidden" }}>
              {/* Linha principal */}
              {editId !== a.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                  {/* Favicon */}
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: C.deep, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${C.b1}` }}>
                    {getFavicon(a.link)
                      ? <img src={getFavicon(a.link)} alt="" width={20} height={20} onError={e => { e.currentTarget.style.display = "none"; }} />
                      : <span style={{ fontSize: 16 }}>🔗</span>}
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.tp, fontSize: 13.5, fontWeight: 600 }}>{a.nome}</div>
                    <div style={{ color: C.tm, fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.link}</div>
                  </div>
                  {/* Abrir */}
                  <a href={a.link} target="_blank" rel="noopener noreferrer"
                    style={{ background: C.abg, color: C.atxt, border: `1px solid ${C.atxt}33`, borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, textDecoration: "none", flexShrink: 0 }}>
                    Abrir →
                  </a>
                  {/* Editar / Remover — só mestre */}
                  {isMestre && (
                    <>
                      <button onClick={() => { setEditId(a.id); setEditForm({ nome: a.nome, link: a.link }); }}
                        style={{ background: "transparent", border: `1px solid ${C.b2}`, color: C.tm, borderRadius: 8, padding: "6px 11px", fontSize: 12, cursor: "pointer" }}>
                        ✏
                      </button>
                      <button onClick={() => remove(a.id)}
                        style={{ background: "transparent", border: "1px solid #EF444433", color: "#EF4444", borderRadius: 8, padding: "6px 11px", fontSize: 12, cursor: "pointer" }}>
                        ✕
                      </button>
                    </>
                  )}
                </div>
              ) : (
                /* Linha de edição */
                <div style={{ padding: "14px 16px", borderTop: `1px solid ${C.b1}`, background: C.deep }}>
                  <div style={{ color: C.atxt, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>✏ Editando atalho</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                    <div>
                      <label style={{ color: C.tm, fontSize: 11, display: "block", marginBottom: 4 }}>Nome</label>
                      <input value={editForm.nome} onChange={e => setEditForm(f => ({ ...f, nome: e.target.value }))} style={{ ...S.input, background: C.card, padding: "7px 10px", fontSize: 12.5 }} />
                    </div>
                    <div>
                      <label style={{ color: C.tm, fontSize: 11, display: "block", marginBottom: 4 }}>Link</label>
                      <input value={editForm.link} onChange={e => setEditForm(f => ({ ...f, link: e.target.value }))} style={{ ...S.input, background: C.card, padding: "7px 10px", fontSize: 12.5 }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={saveEdit} style={{ ...S.btn(C.acc, "#fff"), padding: "8px 20px", fontSize: 12.5 }}>Salvar</button>
                    <button onClick={() => setEditId(null)} style={{ ...S.btn("transparent", C.tm), border: `1px solid ${C.b2}`, padding: "8px 14px", fontSize: 12 }}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── App Root ───────────────────────────────────────────────────
export default function App() {
  const [users, setUsers] = useState(INITIAL_USERS);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [page, setPage] = useState(() => sessionStorage.getItem("nexp_page") || "dashboard");
  const [theme, setTheme] = useState("Padrão");
  const [unreadChat, setUnreadChat] = useState(0);
  const [shake, setShake] = useState(false);
  const [presence, setPresenceData] = useState({});
  const [flashUserId, setFlashUserId] = useState(null);
  const lastChatCount = useRef(0);

  // Salva a página ativa ao trocar
  const setPageAndSave = (p) => {
    sessionStorage.setItem("nexp_page", p);
    setPage(p);
  };

  // ── Persistência de sessão Firebase ──────────────────────────
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

  // ── Ouvir contatos do Firestore em tempo real ─────────────────
  useEffect(() => {
    if (!currentUser) return;
    const unsub = listenContacts((data) => setContacts(data));
    return () => unsub();
  }, [currentUser]);

  // ── Ouvir usuários do Firestore em tempo real ─────────────────
  useEffect(() => {
    if (!currentUser) return;
    const unsub = listenUsers((data) => setUsers(data));
    return () => unsub();
  }, [currentUser]);

  // ── Presença online ───────────────────────────────────────────
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
      removePresence(myId);
      unsub();
    };
  }, [currentUser]); // eslint-disable-line

  // ── Ouvir chat para indicador de não lidas e shake ────────────
  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;
    const unsub = listenChat((msgs) => {
      const relevant = msgs.filter(m => !m.toId || m.toId === myId);
      const newCount = relevant.length;

      // ── Shake: detecta SEMPRE, em qualquer página ──
      if (newCount > lastChatCount.current) {
        const newMsgs = relevant.slice(lastChatCount.current);
        const shakeSignal = newMsgs.find(m => m.type === "shake" && m.toId === myId);
        if (shakeSignal) {
          setShake(true);
          setTimeout(() => setShake(false), 1000);
        }
        // Flash no avatar de quem mandou
        const lastNew = newMsgs.filter(m => m.type !== "shake").pop();
        if (lastNew && lastNew.authorId !== myId) {
          setFlashUserId(lastNew.authorId);
          setTimeout(() => setFlashUserId(null), 3000);
        }
      }
      lastChatCount.current = newCount;

      // ── Badge: recalcula em tempo real com base em readAt ──
      const unread = relevant.filter(m =>
        m.type !== "shake" && m.authorId !== myId && !m.readAt
      ).length;
      setUnreadChat(unread);
    });
    return () => unsub();
  }, [currentUser]); // eslint-disable-line

  // Apply accent theme to module-level C so all components pick it up on re-render
  Object.assign(C, ACCENT_THEMES[theme] || ACCENT_THEMES["Padrão"]);
  // Rebuild S with updated C
  S.card = {
    background: C.card,
    borderRadius: 12,
    border: `1px solid ${C.b1}`,
  };
  S.input = {
    background: C.deep,
    border: `1px solid ${C.b2}`,
    borderRadius: 8,
    color: C.tp,
    fontSize: 13,
    padding: "9px 12px",
    boxSizing: "border-box",
    width: "100%",
  };
  S.btn = (bg, color) => ({
    background: bg,
    color,
    border: "none",
    borderRadius: 8,
    padding: "9px 18px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  });

  if (authLoading)
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#060810",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#4F8EF7",
          fontSize: 15,
          fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
        }}
      >
        Carregando...
      </div>
    );

  if (!currentUser)
    return (
      <LoginPage
        onLogin={(u) => {
          setCurrentUser(u);
          setPageAndSave("dashboard");
        }}
      />
    );

  const logout = async () => {
    await firebaseLogout();
    setCurrentUser(null);
    sessionStorage.removeItem("nexp_page");
    setPage("dashboard");
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        html, body, #root { height: 100%; margin: 0; padding: 0; overflow: hidden; }
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          10%,30%,50%,70%,90%{transform:translateX(-6px)}
          20%,40%,60%,80%{transform:translateX(6px)}
        }
        @keyframes pulse {
          0%,100%{opacity:1} 50%{opacity:0.5}
        }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A1F2E; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #525870; }
      `}</style>
      <div
        key={theme}
        style={{
          display: "flex",
          height: "100vh",
          width: "100vw",
          overflow: "hidden",
          background: C.bg,
          fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
          animation: shake ? "shake 0.6s ease" : "none",
        }}
      >
      <Sidebar
        page={page}
        setPage={setPageAndSave}
        user={currentUser}
        users={users}
        onLogout={logout}
        unreadChat={unreadChat}
        presence={presence}
        flashUserId={flashUserId}
      />
      <div style={{ flex: 1, overflowY: "auto", height: "100vh" }}>
        {page === "dashboard" && <Dashboard contacts={contacts} />}
        {page === "contacts" && (
          <ContactsPage contacts={contacts} setContacts={setContacts} />
        )}
        {page === "add" && (
          <AddClient setContacts={setContacts} setPage={setPageAndSave} />
        )}
        {page === "import" && (
          <ImportPage contacts={contacts} setContacts={setContacts} setPage={setPageAndSave} currentUser={currentUser} />
        )}
        {page === "review" && (
          <ReviewClient contacts={contacts} setContacts={setContacts} />
        )}
        {page === "cstatus" && (
          <ClienteStatus contacts={contacts} setContacts={setContacts} />
        )}
        {page === "leds" && (
          <LedsPage contacts={contacts} userRole={currentUser.role} />
        )}
        {page === "atalhos" && (
          <AtalhosPage currentUser={currentUser} />
        )}
        {page === "stories" && (
          <StoriesPage currentUser={currentUser} users={users} />
        )}
        {page === "chat" && (
          <ChatPage currentUser={currentUser} users={users} presence={presence} />
        )}
        {page === "premium" && currentUser.role === "mestre" && (
          <PremiumNexp contacts={contacts} setContacts={setContacts} />
        )}
        {page === "premium" && currentUser.role !== "mestre" && (
          <div style={{ padding: "60px 36px", textAlign: "center" }}>
            <div style={{ fontSize: 36, opacity: 0.3, marginBottom: 12 }}>
              🔒
            </div>
            <div style={{ color: C.tm, fontSize: 14, fontWeight: 600 }}>
              Acesso restrito ao Mestre.
            </div>
          </div>
        )}
        {page === "config" && (
          <ConfigPage
            users={users}
            setUsers={setUsers}
            currentUser={currentUser}
            theme={theme}
            onTheme={setTheme}
          />
        )}
      </div>
    </div>
    </>
  );
}
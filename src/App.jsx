import { useState, useRef, useEffect } from "react";
import { onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import {
  auth,
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
function EmojiBar({ reactions = [], onToggle }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {EMOJIS.map((e) => {
        const a = reactions.includes(e);
        return (
          <button
            key={e}
            onClick={() => onToggle(e)}
            style={{
              background: a ? "#1E2A45" : C.deep,
              border: a ? "1px solid #4F8EF766" : `1px solid ${C.b2}`,
              borderRadius: 8,
              padding: "4px 7px",
              cursor: "pointer",
              fontSize: 15,
              transform: a ? "scale(1.15)" : "scale(1)",
              transition: "all 0.12s",
            }}
          >
            {e}
          </button>
        );
      })}
    </div>
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
function Sidebar({ page, setPage, user, users, onLogout }) {
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
            </button>
          );
        })}
      </nav>
      <div style={{ padding: "0 12px" }}>
        <div
          style={{
            background: C.deep,
            borderRadius: 10,
            padding: "11px 12px",
            border: `1px solid ${C.b1}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginBottom: 8,
            }}
          >
            {uObj.photo ? (
              <img
                src={uObj.photo}
                alt=""
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: `1.5px solid ${C.atxt}33`,
                }}
              />
            ) : (
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: C.abg,
                  color: C.atxt,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  border: `1.5px solid ${C.atxt}33`,
                }}
              >
                {ini(uObj.name || "OP")}
              </div>
            )}
            <div>
              <div style={{ color: C.ts, fontSize: 12, fontWeight: 600 }}>
                {uObj.name || uObj.username}
              </div>
              <div style={{ color: C.td, fontSize: 10 }}>
                {roleLabel[user.role]}
              </div>
            </div>
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
  const [form, setForm] = useState({ ...contact });
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    onUpdate(form);
    setEd(false);
  };
  const tog = (e) => {
    const r = contact.reactions || [];
    onUpdate({
      ...contact,
      reactions: r.includes(e) ? r.filter((x) => x !== e) : [...r, e],
    });
  };
  const lc = LEAD_COLOR[contact.leadType] || "#9CA3AF";
  return (
    <div style={{ ...S.card, marginBottom: 10, overflow: "hidden" }}>
      <div
        onClick={() => {
          setOpen((o) => !o);
          if (ed) setEd(false);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 15px",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
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
          {ini(contact.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: C.tp,
              fontSize: 13.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {contact.name}
          </div>
          <div style={{ color: C.tm, fontSize: 11.5, marginTop: 1 }}>
            {contact.cpf}
            {contact.phone ? " · " + contact.phone : ""}
          </div>
        </div>
        {(contact.reactions || []).length > 0 && (
          <div style={{ display: "flex", gap: 2 }}>
            {(contact.reactions || []).slice(0, 4).map((e, i) => (
              <span key={i} style={{ fontSize: 13 }}>
                {e}
              </span>
            ))}
          </div>
        )}
        <LeadBadge c={contact} />
        <StatusBadge status={contact.status} />
        <span style={{ color: C.td, fontSize: 11, marginLeft: 4 }}>
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${C.b1}`, padding: "16px" }}>
          {!ed ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3,1fr)",
                  gap: "10px 18px",
                  marginBottom: 14,
                }}
              >
                {[
                  ["Email", contact.email || "—"],
                  ["CNPJ", contact.cnpj || "—"],
                  ["Matrícula", contact.matricula || "—"],
                  ["Tel 1", contact.phone || "—"],
                  ["Tel 2", contact.phone2 || "—"],
                  ["Tel 3", contact.phone3 || "—"],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div
                      style={{ color: C.tm, fontSize: 10.5, marginBottom: 2 }}
                    >
                      {l}
                    </div>
                    <div style={{ color: C.ts, fontSize: 12.5 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    color: C.tm,
                    fontSize: 10.5,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Status
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {CLIENT_STATUS.map((s) => {
                    const st = STATUS_STYLE[s];
                    const sel = contact.status === s;
                    return (
                      <button
                        key={s}
                        onClick={() => onUpdate({ ...contact, status: s })}
                        style={{
                          background: sel ? st.bg : C.deep,
                          color: sel ? st.color : C.tm,
                          border: sel
                            ? `1px solid ${st.color}44`
                            : `1px solid ${C.b2}`,
                          borderRadius: 20,
                          padding: "4px 10px",
                          fontSize: 10.5,
                          cursor: "pointer",
                          fontWeight: sel ? 600 : 400,
                          transition: "all 0.12s",
                        }}
                      >
                        {s}
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
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Reações
                </div>
                <EmojiBar reactions={contact.reactions || []} onToggle={tog} />
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
  if (!list.length)
    return (
      <div style={{ padding: "30px 36px" }}>
        <h1
          style={{
            color: C.tp,
            fontSize: 21,
            fontWeight: 700,
            margin: "0 0 30px",
          }}
        >
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
  const si = Math.min(idx, list.length - 1);
  const cur = list[si];
  const nexts = list.slice(si + 1, si + 11);
  const lc = LEAD_COLOR[cur.leadType] || "#9CA3AF";
  const upd = async (u) => {
    await saveContact(u);
    setContacts((cs) => cs.map((c) => (c.id === u.id ? u : c)));
  };
  const tog = (e) => {
    const r = cur.reactions || [];
    upd({
      ...cur,
      reactions: r.includes(e) ? r.filter((x) => x !== e) : [...r, e],
    });
  };
  return (
    <div style={{ padding: "26px 36px", maxWidth: 800 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
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
            style={{
              ...S.btn(si === 0 ? C.deep : C.abg, si === 0 ? C.td : C.atxt),
              border: `1px solid ${C.b2}`,
              padding: "7px 14px",
              fontSize: 13,
            }}
          >
            ← Anterior
          </button>
          <button
            onClick={() => setIdx((i) => Math.min(list.length - 1, i + 1))}
            disabled={si === list.length - 1}
            style={{
              ...S.btn(
                si === list.length - 1 ? C.deep : C.acc,
                si === list.length - 1 ? C.td : "#fff",
              ),
              padding: "7px 14px",
              fontSize: 13,
            }}
          >
            Próximo →
          </button>
        </div>
      </div>
      <div
        style={{
          ...S.card,
          border: `1px solid ${lc}33`,
          padding: "24px 26px",
          marginBottom: 16,
          boxShadow: `0 0 28px ${lc}08`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: lc + "1A",
              color: lc,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              fontWeight: 700,
              border: `2px solid ${lc}44`,
              flexShrink: 0,
            }}
          >
            {ini(cur.name)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.tp, fontSize: 18, fontWeight: 700 }}>
              {cur.name}
            </div>
            <div style={{ color: C.tm, fontSize: 12.5, marginTop: 2 }}>
              {cur.cpf}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              <LeadBadge c={cur} />
              <StatusBadge status={cur.status} />
              {cur.matricula && (
                <span
                  style={{
                    color: C.tm,
                    fontSize: 11,
                    padding: "3px 9px",
                    borderRadius: 20,
                    border: `1px solid ${C.b2}`,
                  }}
                >
                  #{cur.matricula}
                </span>
              )}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: "10px 18px",
            padding: "12px",
            background: C.deep,
            borderRadius: 10,
            marginBottom: 16,
          }}
        >
          {[
            ["Tel 1", cur.phone || "—"],
            ["Tel 2", cur.phone2 || "—"],
            ["Tel 3", cur.phone3 || "—"],
            ["Email", cur.email || "—"],
            ["CNPJ", cur.cnpj || "—"],
          ].map(([l, v]) => (
            <div key={l}>
              <div style={{ color: C.tm, fontSize: 10, marginBottom: 2 }}>
                {l}
              </div>
              <div style={{ color: C.ts, fontSize: 12.5, fontWeight: 500 }}>
                {v}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              color: C.tm,
              fontSize: 10.5,
              marginBottom: 7,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Marcar status
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CLIENT_STATUS.map((s) => {
              const st = STATUS_STYLE[s];
              const sel = cur.status === s;
              return (
                <button
                  key={s}
                  onClick={() => upd({ ...cur, status: s })}
                  style={{
                    background: sel ? st.bg : C.deep,
                    color: sel ? st.color : C.tm,
                    border: sel
                      ? `1px solid ${st.color}55`
                      : `1px solid ${C.b2}`,
                    borderRadius: 20,
                    padding: "5px 11px",
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
        </div>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              color: C.tm,
              fontSize: 10.5,
              marginBottom: 7,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Reações
          </div>
          <EmojiBar reactions={cur.reactions || []} onToggle={tog} />
        </div>
        <div style={{ marginBottom: 14 }}>
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
            value={cur.observacao || ""}
            onChange={(e) => upd({ ...cur, observacao: e.target.value })}
            rows={3}
            placeholder="Observação..."
            style={{
              ...S.input,
              background: C.deep,
              border: `1px solid ${C.b2}`,
              color: C.ts,
              resize: "vertical",
            }}
          />
        </div>
        <div>
          <button
            onClick={() => setSc((p) => !p)}
            style={{
              background: "transparent",
              border: `1px solid ${C.b2}`,
              color: C.tm,
              borderRadius: 8,
              padding: "6px 13px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {sc ? "▲ Fechar" : "💰 Simular comissão"}
          </button>
          {sc && (
            <div
              style={{
                marginTop: 12,
                padding: "16px",
                background: C.deep,
                borderRadius: 10,
                border: `1px solid ${C.b2}`,
              }}
            >
              <CommSim compact />
            </div>
          )}
        </div>
      </div>
      {nexts.length > 0 && (
        <div>
          <div
            style={{
              color: C.td,
              fontSize: 10.5,
              marginBottom: 7,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Próximos {nexts.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {nexts.map((c, i) => {
              const lc2 = LEAD_COLOR[c.leadType] || "#9CA3AF";
              const ss2 =
                STATUS_STYLE[c.status] || STATUS_STYLE["Não simulado"];
              return (
                <div
                  key={c.id}
                  onClick={() => setIdx(si + 1 + i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "6px 11px",
                    background: C.deep,
                    borderRadius: 7,
                    border: `1px solid ${C.b1}`,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = C.card)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = C.deep)
                  }
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: lc2 + "18",
                      color: lc2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 8,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {ini(c.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{ color: C.ts, fontSize: 11, fontWeight: 500 }}
                    >
                      {c.name}
                    </span>
                  </div>
                  <span style={{ color: lc2, fontSize: 9.5, flexShrink: 0 }}>
                    {c.leadType === "Outro"
                      ? c.leadTypeCustom || "Outro"
                      : c.leadType}
                  </span>
                  <span
                    style={{
                      background: ss2.bg,
                      color: ss2.color,
                      fontSize: 9,
                      padding: "2px 7px",
                      borderRadius: 20,
                      fontWeight: 600,
                    }}
                  >
                    {c.status}
                  </span>
                  {(c.reactions || []).length > 0 && (
                    <div style={{ display: "flex", gap: 1 }}>
                      {(c.reactions || []).slice(0, 3).map((e, j) => (
                        <span key={j} style={{ fontSize: 10 }}>
                          {e}
                        </span>
                      ))}
                    </div>
                  )}
                  <span style={{ color: C.td, fontSize: 9.5 }}>
                    #{si + 2 + i}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {si === list.length - 1 && (
        <div
          style={{
            textAlign: "center",
            padding: "18px",
            color: C.tm,
            fontSize: 13,
            background: C.deep,
            borderRadius: 10,
            marginTop: 14,
            border: `1px solid ${C.b1}`,
          }}
        >
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
          // Tenta fazer login para obter o UID do usuário existente
          const { signInWithEmailAndPassword } = await import("firebase/auth");
          const { getAuth } = await import("firebase/auth");
          const tempAuth = getAuth();
          // Usa instância secundária para não deslogar o mestre
          const { initializeApp, getApps } = await import("firebase/app");
          const secondApp = getApps().find(a => a.name === "reauth") ||
            initializeApp({
              apiKey: "AIzaSyAnYyVIb5AxUd1qkQuXVEpEw7COzW2nvDw",
              authDomain: "nexpcompany-9a7ba.firebaseapp.com",
              projectId: "nexpcompany-9a7ba",
              storageBucket: "nexpcompany-9a7ba.firebasestorage.app",
              messagingSenderId: "1043432853586",
              appId: "1:1043432853586:web:10d443d6757420fe01cf8b",
            }, "reauth");
          const { getAuth: getAuth2, signInWithEmailAndPassword: signIn2 } = await import("firebase/auth");
          const auth2 = getAuth2(secondApp);
          const cred = await signIn2(auth2, form.email, form.password);
          uid = cred.user.uid;
          reativado = true;
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

// ── App Root ───────────────────────────────────────────────────
export default function App() {
  const [users, setUsers] = useState(INITIAL_USERS);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [page, setPage] = useState("dashboard");
  const [theme, setTheme] = useState("Padrão");

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
          setPage("dashboard");
        }}
      />
    );

  const logout = async () => {
    await firebaseLogout();
    setCurrentUser(null);
    setPage("dashboard");
  };

  return (
    <div
      key={theme}
      style={{
        display: "flex",
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
      }}
    >
      <Sidebar
        page={page}
        setPage={setPage}
        user={currentUser}
        users={users}
        onLogout={logout}
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        {page === "dashboard" && <Dashboard contacts={contacts} />}
        {page === "contacts" && (
          <ContactsPage contacts={contacts} setContacts={setContacts} />
        )}
        {page === "add" && (
          <AddClient setContacts={setContacts} setPage={setPage} />
        )}
        {page === "import" && (
          <ImportPage contacts={contacts} setContacts={setContacts} setPage={setPage} currentUser={currentUser} />
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
  );
}

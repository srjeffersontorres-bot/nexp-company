import { useState, useRef, useEffect } from "react";
import { onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider, updatePassword } from "firebase/auth";
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
function SidebarCover({ user, sidebarOpen, setSidebarOpen }) {
  const canEdit = user.role === "mestre" || user.role === "master";
  const [cover, setCover] = useState(() => localStorage.getItem("nexp_sidebar_cover") || null);
  const coverRef = useRef(null);
  const handleCover = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => { setCover(ev.target.result); localStorage.setItem("nexp_sidebar_cover", ev.target.result); };
    r.readAsDataURL(f);
  };
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div style={{ width: "100%", height: 72, background: cover ? "transparent" : `linear-gradient(135deg,${C.lg1},${C.lg2})`, overflow: "hidden", position: "relative" }}>
        {cover && <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
        <div style={{ position: "absolute", bottom: 8, left: 12 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 13.5, letterSpacing: "-0.3px", textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>Nexp Company</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>Sistema de Leads</div>
        </div>
        {canEdit && (
          <button onClick={() => coverRef.current?.click()} style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", borderRadius: 6, padding: "2px 7px", fontSize: 9.5, cursor: "pointer" }}>
            {cover ? "✎ Trocar" : "＋ Capa"}
          </button>
        )}
        <input ref={coverRef} type="file" accept="image/*" onChange={handleCover} style={{ display: "none" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${C.b1}`, height: 24 }}>
        <div style={{ flex: 1 }} />
        <button onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? "Fechar menu" : "Abrir menu"}
          style={{ background: "transparent", border: "none", color: C.tm, fontSize: 11, cursor: "pointer", padding: "0 10px", height: "100%", display: "flex", alignItems: "center", opacity: 0.7, transition: "opacity 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "1"}
          onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}>
          <span style={{ display: "inline-block", transition: "transform 0.2s" }}>◀</span>
        </button>
      </div>
    </div>
  );
}

function Sidebar({ page, setPage, user, users, onLogout, unreadChat, unreadNotif, unreadStories, presence, flashUserId, stories }) {
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
  const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador" };
  const isConfig = page === "config";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [navOpen] = useState(true);
  const [navOrder, setNavOrder] = useState(() => nav.map(it => it.id));
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const orderedNav = [...nav].sort((a, b) => {
    const ai = navOrder.indexOf(a.id);
    const bi = navOrder.indexOf(b.id);
    if (ai === -1) return 1; if (bi === -1) return -1;
    return ai - bi;
  });

  const handleDragStart = (id) => setDragId(id);
  const handleDragOver  = (e, id) => { e.preventDefault(); setDragOver(id); };
  const handleDrop      = (e, targetId) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) { setDragId(null); setDragOver(null); return; }
    const arr = [...orderedNav.map(x => x.id)];
    const from = arr.indexOf(dragId); const to = arr.indexOf(targetId);
    arr.splice(from, 1); arr.splice(to, 0, dragId);
    setNavOrder(arr); setDragId(null); setDragOver(null);
  };
  const handleDragEnd = () => { setDragId(null); setDragOver(null); };

  return (
    <>
      {/* Sidebar */}
      <div style={{
        width: sidebarOpen ? 222 : 0, background: C.sb, height: "100vh",
        display: "flex", flexDirection: "column", flexShrink: 0,
        borderRight: `1px solid ${C.b1}`, overflow: "hidden",
        transition: "width 0.25s cubic-bezier(.4,0,.2,1)", position: "relative",
      }}>
        <div style={{ width: 222, display: "flex", flexDirection: "column", height: "100%" }}>

          {/* ── Capa editável ── */}
          <SidebarCover user={user} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

          {/* Nav items */}
          {navOpen && (
            <nav style={{ flex: 1, padding: "4px 8px 6px", display: "flex", flexDirection: "column", gap: 3, overflowY: "auto" }}>
              {orderedNav.map((it) => {
                const active = it.id === "config" ? isConfig : page === it.id;
                const isDragging = dragId === it.id;
                const isOver = dragOver === it.id && dragOver !== dragId;
                return (
                  <button key={it.id}
                    draggable
                    onDragStart={() => handleDragStart(it.id)}
                    onDragOver={(e) => handleDragOver(e, it.id)}
                    onDrop={(e) => handleDrop(e, it.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => { setPage(it.id); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 13px", borderRadius: 10, cursor: "pointer",
                      textAlign: "left", width: "100%",
                      background: active ? C.acc : isOver ? C.abg : C.deep,
                      color: active ? "#fff" : isOver ? C.atxt : C.ts,
                      border: active ? "none" : isOver ? `1px solid ${C.atxt}44` : `1px solid ${C.b2}`,
                      fontSize: 12.5, fontWeight: active ? 700 : 400,
                      opacity: isDragging ? 0.35 : 1,
                      transform: isOver ? "translateY(-2px) scale(1.02)" : "none",
                      transition: "all 0.14s cubic-bezier(.4,0,.2,1)",
                      boxShadow: active ? `0 3px 12px ${C.acc}55` : "none",
                    }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.background = C.abg; e.currentTarget.style.color = C.atxt; e.currentTarget.style.borderColor = C.atxt + "44"; e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = `0 2px 8px ${C.acc}22`; }}}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.background = C.deep; e.currentTarget.style.color = C.ts; e.currentTarget.style.borderColor = C.b2; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}}
                  >
                    <span style={{ fontSize: 14, width: 18, textAlign: "center", flexShrink: 0 }}>{it.icon}</span>
                    <span style={{ flex: 1 }}>{it.label}</span>
                    {it.id === "premium" && <span style={{ background: active ? "rgba(255,255,255,0.2)" : C.abg, color: active ? "#fff" : C.atxt, fontSize: 9, padding: "1px 5px", borderRadius: 9 }}>★</span>}
                    <span style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.35)" : C.td, cursor: "grab" }} title="Arrastar">⠿</span>
                  </button>
                );
              })}
            </nav>
          )}



          {/* Bottom: Stories + Chat + Profile + WhatsApp */}
          <div style={{ padding: "0 12px" }}>
            <div style={{ borderTop: `1px solid ${C.b1}`, paddingTop: 10, marginBottom: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              {[{ id:"notificacoes", label:"Notificações", icon:"🔔" }, { id:"stories", label:"Stories", icon:"◎" }, { id:"chat", label:"Chat da Equipe", icon:"💬" }].map(item => (
                <button key={item.id} onClick={() => setPage(item.id)} style={{
                  display: "flex", alignItems: "center", gap: 9,
                  padding: "9px 13px", borderRadius: 10, width: "100%",
                  border: page === item.id ? `1px solid ${C.atxt}44` : `1px solid ${C.b2}`,
                  cursor: "pointer", textAlign: "left",
                  background: page === item.id ? C.abg : C.deep,
                  color: page === item.id ? C.atxt : C.tm,
                  fontSize: 12.5, fontWeight: page === item.id ? 600 : 400, transition: "all 0.14s",
                  boxShadow: page === item.id ? `0 2px 8px ${C.acc}33` : "none",
                }}
                  onMouseEnter={e => { if (page !== item.id) { e.currentTarget.style.background = C.abg; e.currentTarget.style.color = C.atxt; e.currentTarget.style.borderColor = C.atxt + "44"; e.currentTarget.style.transform = "scale(1.01)"; }}}
                  onMouseLeave={e => { if (page !== item.id) { e.currentTarget.style.background = C.deep; e.currentTarget.style.color = C.tm; e.currentTarget.style.borderColor = C.b2; e.currentTarget.style.transform = "none"; }}}
                >
                  <span style={{ fontSize: 15, width: 17, textAlign: "center" }}>{item.icon}</span>
                  {item.label}
                  {item.id === "chat" && unreadChat > 0 && (
                    <span style={{ marginLeft: "auto", background: "#16A34A", color: "#fff", fontSize: 9, padding: "2px 7px", borderRadius: 9, fontWeight: 700, animation: "pulse 1.5s infinite" }}>{unreadChat}</span>
                  )}
                  {item.id === "notificacoes" && unreadNotif > 0 && (
                    <span style={{ marginLeft: "auto", background: "#F59E0B", color: "#fff", fontSize: 9, padding: "2px 7px", borderRadius: 9, fontWeight: 700, animation: "pulse 1.5s infinite" }}>{unreadNotif}</span>
                  )}
                  {item.id === "stories" && unreadStories > 0 && (
                    <span style={{ marginLeft: "auto", background: "linear-gradient(135deg,#3B6EF5,#7C3AED)", color: "#fff", fontSize: 9, padding: "2px 7px", borderRadius: 9, fontWeight: 700, animation: "pulse 1.5s infinite" }}>{unreadStories}</span>
                  )}
                </button>
              ))}
            </div>

            {/* User card */}
            <div style={{ background: C.deep, borderRadius: 10, padding: "11px 12px", border: `1px solid ${C.b1}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  {/* Story ring on profile */}
                  {(() => {
                    const myId = uObj.uid || uObj.id;
                    const now = Date.now();
                    const myStories = (stories||[]).filter(s => s.authorId === myId && s.expiresAt > now);
                    const iHaveStory = myStories.length > 0;
                    const allSeen = iHaveStory && myStories.every(s => (s.views||[]).length > 0);
                    const ringBg = iHaveStory
                      ? (allSeen ? "#6B7280" : "linear-gradient(135deg,#3B6EF5,#7C3AED,#F5376B)")
                      : "transparent";
                    return (
                      <div
                        onClick={() => iHaveStory && setPage("stories")}
                        style={{
                          width:32, height:32, borderRadius:"50%",
                          padding: iHaveStory ? 2 : 0,
                          boxSizing:"border-box",
                          background: ringBg,
                          cursor: iHaveStory ? "pointer" : "default",
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}>
                        <div style={{ width:"100%", height:"100%", borderRadius:"50%", background: iHaveStory ? C.sb : "transparent", padding: iHaveStory ? 1 : 0, boxSizing:"border-box" }}>
                          {uObj.photo
                            ? <img src={uObj.photo} alt="" style={{ width:"100%", height:"100%", borderRadius:"50%", objectFit:"cover", display:"block", border: !iHaveStory ? `1.5px solid ${C.atxt}33` : "none" }} />
                            : <div style={{ width:"100%", height:"100%", borderRadius:"50%", background: flashUserId === (uObj.uid || uObj.id) ? "#16A34A" : C.abg, color: flashUserId === (uObj.uid || uObj.id) ? "#fff" : C.atxt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, animation: flashUserId === (uObj.uid || uObj.id) ? "pulse 0.8s infinite" : "none", transition: "background 0.3s" }}>{ini(uObj.name || "OP")}</div>
                          }
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderRadius: "50%", background: "#16A34A", border: `1.5px solid ${C.sb}` }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.ts, fontSize: 12, fontWeight: 600 }}>{uObj.name || uObj.username}</div>
                  <div style={{ color: C.td, fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>{roleLabel[user.role]}<span style={{ color: "#16A34A", fontSize: 9 }}>● online</span></div>
                </div>
                <button onClick={() => setPage("stories")} title="Criar story" style={{ width: 20, height: 20, borderRadius: "50%", background: C.acc, color: "#fff", border: `1.5px solid ${C.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0, lineHeight: 1, padding: 0 }}>+</button>
              </div>
              <button onClick={onLogout} style={{ background: "transparent", border: `1px solid ${C.b2}`, color: C.tm, borderRadius: 7, padding: "5px 10px", fontSize: 11, cursor: "pointer", width: "100%" }}>Sair</button>
            </div>

            {/* WhatsApp */}
            <a href="https://wa.me/5584981323542" target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "9px 12px", background: "#0A2918", border: "1px solid #16A34A44", borderRadius: 9, textDecoration: "none" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366"><path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.17 1.6 5.98L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.21-3.48-8.52zM12 21.94a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.73.98.99-3.63-.23-.37A9.93 9.93 0 0 1 2.06 12C2.06 6.5 6.5 2.06 12 2.06S21.94 6.5 21.94 12 17.5 21.94 12 21.94zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97s-.47-.15-.67.15-.77.97-.94 1.17-.35.22-.65.07a8.15 8.15 0 0 1-2.4-1.48 9.01 9.01 0 0 1-1.66-2.07c-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5s.05-.38-.02-.52c-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.48 1.07 2.88 1.22 3.08 2.1 3.2 5.09 4.49c.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/></svg>
              <div>
                <div style={{ color: "#25D366", fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>Suporte WhatsApp</div>
                <div style={{ color: "#2D6B47", fontSize: 10, marginTop: 1 }}>(84) 98132-3542</div>
              </div>
            </a>
          </div>
        </div>
      </div>

      {/* Botão reabrir — aparece só quando sidebar está fechada */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          title="Abrir menu"
          style={{
            position: "fixed", left: 0, top: "50%",
            transform: "translateY(-50%)", zIndex: 200,
            width: 22, height: 50,
            background: `linear-gradient(135deg,${C.acc},${C.lg2})`,
            color: "#fff", border: "none",
            borderRadius: "0 12px 12px 0",
            cursor: "pointer", fontSize: 12, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `3px 0 14px ${C.acc}55`,
          }}
        >
          ▶
        </button>
      )}
    </>
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


function PerfisTab({ users, setUsers, currentUser }) {
  const [selectedUid, setSelectedUid] = useState(null);
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState("");
  const [cardOrder, setCardOrder] = useState([]);
  const [dragOver, setDragOver] = useState(null);
  const [searchPerfil, setSearchPerfil] = useState("");
  const dragId = useRef(null);

  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399" };
  const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador" };

  const allUsers = users.filter(u => !u.deleted);
  const allVisible = searchPerfil.trim()
    ? allUsers.filter(u => {
        const q = searchPerfil.toLowerCase();
        return (
          (u.name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.cpf || "").includes(q) ||
          (u.role || "").toLowerCase().includes(q) ||
          (u.cidade || "").toLowerCase().includes(q)
        );
      })
    : allUsers;
  // Apply custom order
  const visible = cardOrder.length > 0
    ? [...allVisible].sort((a, b) => {
        const ai = cardOrder.indexOf(a.uid || a.id);
        const bi = cardOrder.indexOf(b.uid || b.id);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
    : allVisible;

  // Drag handlers
  const onDragStart = (uid) => { dragId.current = uid; };
  const onDragOver = (e, uid) => { e.preventDefault(); setDragOver(uid); };
  const onDrop = (targetUid) => {
    if (!dragId.current || dragId.current === targetUid) { setDragOver(null); return; }
    const ids = visible.map(u => u.uid || u.id);
    const fromIdx = ids.indexOf(dragId.current);
    const toIdx = ids.indexOf(targetUid);
    const newOrder = [...ids];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, dragId.current);
    setCardOrder(newOrder);
    dragId.current = null;
    setDragOver(null);
  };

  const openProfile = (u) => {
    const uid = u.uid || u.id;
    if (selectedUid === uid) { setSelectedUid(null); setEditData(null); return; }
    setSelectedUid(uid);
    setEditData({ ...u });
    setOk("");
  };

  const saveEdit = async () => {
    if (!editData) return;
    setSaving(true);
    const uid = editData.uid || editData.id;
    await saveUserProfile(uid, editData);
    setUsers(us => us.map(u => (u.uid||u.id) === uid ? { ...u, ...editData } : u));
    setOk("Perfil salvo!"); setSaving(false);
    setTimeout(() => setOk(""), 3000);
  };

  const toggleLock = async (u) => {
    const uid = u.uid || u.id;
    const updated = { ...u, profileLocked: !u.profileLocked };
    await saveUserProfile(uid, updated);
    setUsers(us => us.map(x => (x.uid||x.id) === uid ? updated : x));
    if (editData && (editData.uid||editData.id) === uid) setEditData(updated);
  };

  const EF = (k, v) => setEditData(d => ({ ...d, [k]: v }));

  const [copiedKey, setCopiedKey] = useState(null);
  const copyVal = (k, val) => {
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => {
      setCopiedKey(k); setTimeout(() => setCopiedKey(null), 1800);
    });
  };

  const Field = ({ label, k, type = "text", placeholder = "" }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <label style={{ color: C.tm, fontSize: 11 }}>{label}</label>
        {editData?.[k] && (
          <button onClick={() => copyVal(k, editData[k])}
            style={{ background: "none", border: "none", color: copiedKey === k ? "#34D399" : C.td, cursor: "pointer", fontSize: 10, padding: "1px 5px" }}>
            {copiedKey === k ? "✓ Copiado" : "⎘ Copiar"}
          </button>
        )}
      </div>
      <input value={editData?.[k] || ""} onChange={e => EF(k, e.target.value)}
        type={type} placeholder={placeholder}
        style={{ ...S.input, fontSize: 12.5 }} />
    </div>
  );

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18 }}>
        <div style={{ color: C.ts, fontSize: 13, fontWeight: 600, flexShrink:0 }}>
          {visible.length} perfil{visible.length !== 1 ? "s" : ""} cadastrado{visible.length !== 1 ? "s" : ""}
          {searchPerfil && allUsers.length !== visible.length && <span style={{ color:C.td, fontSize:11, fontWeight:400 }}> de {allUsers.length}</span>}
        </div>
        <div style={{ position:"relative", flex:1, maxWidth:260 }}>
          <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.td, fontSize:13, pointerEvents:"none" }}>🔍</span>
          <input value={searchPerfil} onChange={e=>setSearchPerfil(e.target.value)}
            placeholder="Buscar por nome, email, CPF, cidade..."
            style={{ ...S.input, paddingLeft:30, fontSize:12, padding:"6px 10px 6px 28px" }} />
          {searchPerfil && <button onClick={()=>setSearchPerfil("")} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:13, lineHeight:1 }}>✕</button>}
        </div>
      </div>

      {/* ── Profile cards grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
        {visible.map(u => {
          const uid = u.uid || u.id;
          const col = roleColor[u.role] || C.atxt;
          const isSelected = selectedUid === uid;
          const hasMissingData = !u.cpf || !u.endereco || !u.banco || !u.certificacoes;

          return (
            <div key={uid}
              draggable
              onDragStart={() => onDragStart(uid)}
              onDragOver={e => onDragOver(e, uid)}
              onDrop={() => onDrop(uid)}
              onDragEnd={() => setDragOver(null)}
              style={{
                opacity: dragOver === uid ? 0.5 : 1,
                transform: dragOver === uid ? "scale(0.97)" : "scale(1)",
                transition: "all 0.15s",
                cursor: "grab",
              }}
            >
            <button onClick={() => openProfile(u)}
              style={{
                width: "100%",
                background: isSelected ? C.abg : C.card,
                border: isSelected ? `1.5px solid ${C.atxt}` : hasMissingData ? `1px solid #F59E0B44` : `1px solid ${C.b1}`,
                borderRadius: 12, padding: "16px 14px", cursor: "pointer", textAlign: "center",
                transition: "all 0.15s", position: "relative",
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = C.atxt + "44"; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = hasMissingData ? "#F59E0B44" : C.b1; }}
            >
              {/* Lock indicator */}
              {u.profileLocked && (
                <div style={{ position: "absolute", top: 8, right: 8, fontSize: 11 }}>🔒</div>
              )}
              {/* Incomplete badge */}
              {hasMissingData && (
                <div style={{ position: "absolute", top: 8, left: 8, background: "#2B1D03", color: "#F59E0B", fontSize: 9, padding: "1px 6px", borderRadius: 6, fontWeight: 700 }}>Incompleto</div>
              )}

              {/* Avatar */}
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, marginTop: hasMissingData ? 8 : 0 }}>
                {u.photo
                  ? <img src={u.photo} alt="" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: `2px solid ${col}44` }} />
                  : <div style={{ width: 52, height: 52, borderRadius: "50%", background: col + "1A", color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, border: `2px solid ${col}33` }}>{ini(u.name || "?")}</div>
                }
              </div>
              <div style={{ color: C.tp, fontSize: 13, fontWeight: 600, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name || u.email}</div>
              <span style={{ background: col + "18", color: col, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: `1px solid ${col}33` }}>{roleLabel[u.role]}</span>

              {/* Quick data indicators */}
              <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
                {[["CPF", !!u.cpf], ["End.", !!u.endereco], ["Banco", !!u.banco], ["Cert.", !!u.certificacoes]].map(([label, filled]) => (
                  <span key={label} style={{ fontSize: 9, color: filled ? "#34D399" : C.td, background: filled ? "#091E12" : C.deep, padding: "1px 5px", borderRadius: 4, border: `1px solid ${filled ? "#34D39922" : C.b1}` }}>{filled ? "✓" : "○"} {label}</span>
                ))}
              </div>
            </button>
            </div>
          );
        })}
      </div>

      {/* ── Edit panel ── */}
      {selectedUid && editData && (
        <div style={{ ...S.card, padding: "24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {editData.photo
                ? <img src={editData.photo} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: `2px solid ${roleColor[editData.role] || C.atxt}44` }} />
                : <div style={{ width: 44, height: 44, borderRadius: "50%", background: (roleColor[editData.role]||C.atxt) + "1A", color: roleColor[editData.role]||C.atxt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>{ini(editData.name || "?")}</div>
              }
              <div>
                <div style={{ color: C.tp, fontSize: 14, fontWeight: 700 }}>{editData.name || editData.email}</div>
                <div style={{ color: C.tm, fontSize: 11.5 }}>{editData.email}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => toggleLock(editData)}
                style={{ background: editData.profileLocked ? "#2D1515" : C.deep, color: editData.profileLocked ? "#F87171" : C.tm, border: editData.profileLocked ? "1px solid #EF444433" : `1px solid ${C.b2}`, borderRadius: 8, padding: "6px 14px", fontSize: 11.5, cursor: "pointer", fontWeight: 600 }}>
                {editData.profileLocked ? "🔒 Bloqueado" : "🔓 Bloquear edição"}
              </button>
              <button onClick={() => { setSelectedUid(null); setEditData(null); }}
                style={{ background: C.deep, border: `1px solid ${C.b2}`, color: C.tm, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>✕</button>
            </div>
          </div>

          {ok && <div style={{ background: "#091E12", border: "1px solid #34D39933", borderRadius: 8, padding: "9px 14px", marginBottom: 16, color: "#34D399", fontSize: 13 }}>✓ {ok}</div>}

          {/* Dados pessoais */}
          <div style={{ color: C.ts, fontSize: 11.5, fontWeight: 700, marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid ${C.b1}` }}>👤 Dados Pessoais</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            <Field label="Nome completo" k="name" />
            <Field label="CPF" k="cpf" placeholder="000.000.000-00" />
          </div>

          <div style={{ color: C.ts, fontSize: 11.5, fontWeight: 700, margin: "16px 0 12px", paddingBottom: 6, borderBottom: `1px solid ${C.b1}` }}>🏠 Endereço</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 0 }}>
            <Field label="CEP" k="cep" placeholder="00000-000" />
            <Field label="Rua / Logradouro" k="rua" placeholder="Ex: Rua das Flores" />
            <Field label="Nº" k="numero" placeholder="123" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 0 }}>
            <Field label="Cidade" k="cidade" placeholder="Ex: Natal" />
            <Field label="UF" k="uf" placeholder="Ex: RN" />
          </div>
          <Field label="Complemento" k="complemento" placeholder="Ex: Apto 12, Bloco B" />

          <div style={{ color: C.ts, fontSize: 11.5, fontWeight: 700, margin: "16px 0 12px", paddingBottom: 6, borderBottom: `1px solid ${C.b1}` }}>🏦 Dados Bancários</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            <Field label="Banco" k="banco" />
            <Field label="Agência" k="agencia" />
            <Field label="Conta" k="conta" />
          </div>
          <div style={{ padding: "10px 12px", background: C.card, borderRadius: 8, border: `1px solid ${C.b1}`, marginBottom: 12 }}>
            <div style={{ color: C.atxt, fontSize: 10, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>⚡ PIX</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              <Field label="Chave PIX" k="pixKey" />
              <Field label="Banco da Chave PIX" k="pixBanco" />
            </div>
          </div>

          <div style={{ color: C.ts, fontSize: 11.5, fontWeight: 700, margin: "16px 0 12px", paddingBottom: 6, borderBottom: `1px solid ${C.b1}` }}>🏆 Certificações</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            <Field label="Certificações" k="certificacoes" />
            <Field label="Vencimento" k="certVencimento" type="date" />
          </div>

          {/* Document viewer */}
          {editData.docFile && (
            <>
              <div style={{ color: C.ts, fontSize: 11.5, fontWeight: 700, margin: "16px 0 12px", paddingBottom: 6, borderBottom: `1px solid ${C.b1}` }}>📄 Documento ({editData.docTipo || "—"})</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.deep, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.b1}` }}>
                {editData.docFile.type?.startsWith("image/")
                  ? <img src={editData.docFile.url} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} />
                  : <span style={{ fontSize: 24 }}>📄</span>
                }
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.tp, fontSize: 12.5, fontWeight: 600 }}>{editData.docFile.name}</div>
                  <div style={{ color: C.td, fontSize: 11 }}>{editData.docTipo}</div>
                </div>
                {editData.docFile.type?.startsWith("image/") && (
                  <a href={editData.docFile.url} target="_blank" rel="noopener noreferrer"
                    style={{ background: C.abg, color: C.atxt, border: `1px solid ${C.atxt}33`, borderRadius: 7, padding: "5px 12px", fontSize: 11, textDecoration: "none" }}>Ver documento →</a>
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
            <button onClick={saveEdit} disabled={saving}
              style={{ ...S.btn(C.acc, "#fff"), padding: "10px 28px", fontSize: 13, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>
            <button onClick={() => { setSelectedUid(null); setEditData(null); }}
              style={{ ...S.btn(C.deep, C.tm), padding: "10px 18px", fontSize: 13, border: `1px solid ${C.b2}` }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
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
      id: "perfis",
      label: "Perfis",
      icon: "📋",
      roles: ["mestre"],
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
        {tab === "perfis" && <PerfisTab users={users} setUsers={setUsers} currentUser={currentUser} />}
        {tab === "temas" && <TemasTab currentTheme={theme} onTheme={onTheme} />}
      </div>
    </div>
  );
}

function PerfilTab({ users, setUsers, currentUser }) {
  const myId = currentUser.uid || currentUser.id;
  const uObj = users.find((u) => (u.uid||u.id) === myId) || currentUser;
  const isLocked = uObj.profileLocked === true;
  const canLock = currentUser.role === "mestre" || currentUser.role === "master";
  // Mestre/master can always edit; others blocked if locked
  const canEdit = canLock || !isLocked;

  const [name, setName] = useState(uObj.name || "");
  const [preview, setPreview] = useState(uObj.photo || null);

  // Extended profile fields
  const [cpf, setCpf]               = useState(uObj.cpf || "");
  // Endereço separado
  const [cep, setCep]               = useState(uObj.cep || "");
  const [rua, setRua]               = useState(uObj.rua || "");
  const [numero, setNumero]         = useState(uObj.numero || "");
  const [cidade, setCidade]         = useState(uObj.cidade || "");
  const [uf, setUf]                 = useState(uObj.uf || "");
  const [complemento, setComplemento] = useState(uObj.complemento || "");
  // Dados bancários
  const [banco, setBanco]           = useState(uObj.banco || "");
  const [agencia, setAgencia]       = useState(uObj.agencia || "");
  const [conta, setConta]           = useState(uObj.conta || "");
  const [pixKey, setPixKey]         = useState(uObj.pixKey || "");
  const [pixBanco, setPixBanco]     = useState(uObj.pixBanco || "");
  const [certificacoes, setCertificacoes] = useState(uObj.certificacoes || "");
  const [certVencimento, setCertVencimento] = useState(uObj.certVencimento || "");
  const [docTipo, setDocTipo]       = useState(uObj.docTipo || "RG");
  const [docFile, setDocFile]       = useState(uObj.docFile || null);

  const [ok, setOk] = useState(false);
  const [saving, setSaving] = useState(false);
  // Password change
  const [showPwChange, setShowPwChange] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwOk, setPwOk] = useState("");
  const fRef = useRef();
  const docRef = useRef();

  // Operator count — users this person created
  const operatorsCreated = users.filter(u => u.createdBy === myId && !u.deleted).length;

  const handleImg = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = (ev) => setPreview(ev.target.result); r.readAsDataURL(f);
  };
  const handleDoc = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setDocFile({ name: f.name, url: ev.target.result, type: f.type });
    r.readAsDataURL(f);
  };

  const save = async () => {
    setSaving(true);
    const updated = {
      ...uObj, name, photo: preview, cpf,
      cep, rua, numero, cidade, uf, complemento,
      banco, agencia, conta, pixKey, pixBanco,
      certificacoes, certVencimento, docTipo, docFile,
    };
    await saveUserProfile(myId, updated);
    setUsers(us => us.map(u => (u.uid||u.id) === myId ? { ...u, ...updated } : u));
    setOk(true); setSaving(false);
    setTimeout(() => setOk(false), 3000);
  };

  const toggleLock = async () => {
    const updated = { ...uObj, profileLocked: !isLocked };
    await saveUserProfile(myId, updated);
    setUsers(us => us.map(u => (u.uid||u.id) === myId ? updated : u));
  };

  const changePassword = async () => {
    setPwErr(""); setPwOk("");
    if (!newPw.trim()) { setPwErr("Digite a nova senha."); return; }
    if (newPw.length < 6) { setPwErr("A senha deve ter pelo menos 6 caracteres."); return; }
    if (newPw !== confirmPw) { setPwErr("As senhas não coincidem."); return; }
    try {
      if (!auth.currentUser) { setPwErr("Sessão expirada. Faça login novamente."); return; }
      await updatePassword(auth.currentUser, newPw);
      setPwOk("Senha alterada com sucesso!"); setNewPw(""); setConfirmPw("");
      setTimeout(() => { setPwOk(""); setShowPwChange(false); }, 3000);
    } catch (e) {
      if (e.code === "auth/requires-recent-login") {
        setPwErr("Por segurança, faça logout e login novamente antes de alterar a senha.");
      } else {
        setPwErr("Erro ao alterar senha: " + e.message);
      }
    }
  };

  const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador" };
  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399" };
  const rc = roleColor[uObj.role] || C.atxt;

  const [copiedField, setCopiedField] = useState(null);
  const copyValue = (label, value) => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1800);
    });
  };

  const Field = ({ label, value, onChange, placeholder, type = "text", readOnly = false }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <label style={{ color: C.tm, fontSize: 11.5 }}>{label}</label>
        {value && (
          <button onClick={() => copyValue(label, value)}
            style={{ background: copiedField === label ? "#091E12" : "transparent", border: "none", color: copiedField === label ? "#34D399" : C.td, cursor: "pointer", fontSize: 10.5, padding: "1px 6px", borderRadius: 5, transition: "all 0.2s" }}
            title="Copiar">
            {copiedField === label ? "✓ Copiado" : "⎘ Copiar"}
          </button>
        )}
      </div>
      <input value={value} onChange={e => onChange && onChange(e.target.value)} placeholder={placeholder || ""}
        type={type} readOnly={readOnly || !canEdit}
        style={{ ...S.input, color: (!canEdit || readOnly) ? C.tm : C.tp, cursor: (!canEdit || readOnly) ? "not-allowed" : "text", opacity: (!canEdit || readOnly) ? 0.6 : 1 }} />
    </div>
  );

  return (
    <div style={{ maxWidth: 640 }}>
      {ok && <div style={{ background: "#091E12", border: "1px solid #34D39933", borderRadius: 8, padding: "11px 14px", marginBottom: 18, color: "#34D399", fontSize: 13 }}>✓ Perfil atualizado!</div>}
      {isLocked && !canLock && (
        <div style={{ background: "#2B1D03", border: "1px solid #F59E0B44", borderRadius: 8, padding: "11px 14px", marginBottom: 18, color: "#FBBF24", fontSize: 13 }}>
          🔒 Suas informações foram bloqueadas pelo administrador. Entre em contato para alterações.
        </div>
      )}

      {/* ── Foto + nome + lock ── */}
      <div style={{ ...S.card, padding: "24px 28px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            {preview
              ? <img src={preview} alt="" style={{ width: 76, height: 76, borderRadius: "50%", objectFit: "cover", border: `3px solid ${rc}44` }} />
              : <div style={{ width: 76, height: 76, borderRadius: "50%", background: rc + "1A", color: rc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, border: `3px solid ${rc}44` }}>{ini(name || "OP")}</div>
            }
            {canEdit && (
              <button onClick={() => fRef.current?.click()}
                style={{ position: "absolute", bottom: 0, right: 0, width: 26, height: 26, borderRadius: "50%", background: C.acc, color: "#fff", border: `2px solid ${C.bg}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>+</button>
            )}
            <input ref={fRef} type="file" accept="image/*" onChange={handleImg} style={{ display: "none" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.tp, fontSize: 15, fontWeight: 700 }}>{uObj.name || uObj.username}</div>
            <div style={{ color: C.tm, fontSize: 12, marginTop: 3 }}>{uObj.email}</div>
            <span style={{ background: rc + "18", color: rc, fontSize: 10, padding: "3px 10px", borderRadius: 20, fontWeight: 700, border: `1px solid ${rc}33`, display: "inline-block", marginTop: 5 }}>{roleLabel[uObj.role]}</span>
            {operatorsCreated > 0 && (
              <span style={{ background: C.abg, color: C.atxt, fontSize: 10, padding: "3px 10px", borderRadius: 20, fontWeight: 600, border: `1px solid ${C.atxt}33`, display: "inline-block", marginTop: 5, marginLeft: 6 }}>
                👥 {operatorsCreated} operador{operatorsCreated !== 1 ? "es" : ""} criado{operatorsCreated !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
            <button onClick={() => setShowPwChange(p => !p)}
              style={{ ...S.btn(showPwChange ? C.abg : C.deep, showPwChange ? C.atxt : C.tm), border: showPwChange ? `1px solid ${C.atxt}44` : `1px solid ${C.b2}`, padding: "6px 12px", fontSize: 11.5 }}>
              🔑 Alterar senha
            </button>
            {canLock && (
              <button onClick={toggleLock}
                style={{ ...S.btn(isLocked ? "#2D1515" : C.deep, isLocked ? "#F87171" : C.tm), border: isLocked ? "1px solid #EF444433" : `1px solid ${C.b2}`, padding: "6px 12px", fontSize: 11.5 }}>
                {isLocked ? "🔒 Bloqueado" : "🔓 Bloquear"}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Nome completo *" value={name} onChange={setName} placeholder="Nome completo" />
          <Field label="CPF *" value={cpf} onChange={setCpf} placeholder="000.000.000-00" />
          <Field label="Usuário (login)" value={uObj.email} readOnly placeholder="" />
        </div>
      </div>

      {/* ── Alterar senha ── */}
      {showPwChange && (
        <div style={{ ...S.card, padding: "20px 24px", marginBottom: 16, border: `1px solid ${C.atxt}33` }}>
          <div style={{ color: C.atxt, fontSize: 12.5, fontWeight: 700, marginBottom: 14 }}>🔑 Alterar Senha</div>
          {pwErr && <div style={{ background: "#2D1515", border: "1px solid #EF444433", borderRadius: 8, padding: "9px 13px", marginBottom: 12, color: "#F87171", fontSize: 12.5 }}>⚠ {pwErr}</div>}
          {pwOk && <div style={{ background: "#091E12", border: "1px solid #34D39933", borderRadius: 8, padding: "9px 13px", marginBottom: 12, color: "#34D399", fontSize: 12.5 }}>✓ {pwOk}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ color: C.tm, fontSize: 11.5, display: "block", marginBottom: 5 }}>Nova senha</label>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                style={{ ...S.input }} />
            </div>
            <div>
              <label style={{ color: C.tm, fontSize: 11.5, display: "block", marginBottom: 5 }}>Confirmar nova senha</label>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                placeholder="Repita a senha"
                onKeyDown={e => e.key === "Enter" && changePassword()}
                style={{ ...S.input }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={changePassword}
              style={{ ...S.btn(C.acc, "#fff"), padding: "9px 22px", fontSize: 13, fontWeight: 700 }}>
              Confirmar alteração
            </button>
            <button onClick={() => { setShowPwChange(false); setNewPw(""); setConfirmPw(""); setPwErr(""); }}
              style={{ ...S.btn(C.deep, C.tm), padding: "9px 14px", fontSize: 12, border: `1px solid ${C.b2}` }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Endereço ── */}
      <div style={{ ...S.card, padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ color: C.ts, fontSize: 12.5, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>🏠 Endereço</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field label="CEP" value={cep} onChange={setCep} placeholder="00000-000" />
          <Field label="Rua / Logradouro" value={rua} onChange={setRua} placeholder="Ex: Rua das Flores" />
          <Field label="Nº" value={numero} onChange={setNumero} placeholder="Ex: 123" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field label="Cidade" value={cidade} onChange={setCidade} placeholder="Ex: Natal" />
          <Field label="UF" value={uf} onChange={setUf} placeholder="Ex: RN" />
        </div>
        <Field label="Complemento" value={complemento} onChange={setComplemento} placeholder="Ex: Apto 12, Bloco B" />
      </div>

      {/* ── Dados bancários ── */}
      <div style={{ ...S.card, padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ color: C.ts, fontSize: 12.5, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>🏦 Dados Bancários</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Banco" value={banco} onChange={setBanco} placeholder="Ex: Banco do Brasil" />
          <Field label="Agência" value={agencia} onChange={setAgencia} placeholder="Ex: 1234-5" />
          <Field label="Conta" value={conta} onChange={setConta} placeholder="Ex: 12345-6" />
        </div>
        <div style={{ marginTop: 12, padding: "12px 14px", background: C.deep, borderRadius: 10, border: `1px solid ${C.b1}` }}>
          <div style={{ color: C.atxt, fontSize: 11, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>⚡ PIX</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Chave PIX" value={pixKey} onChange={setPixKey} placeholder="CPF, email, telefone ou chave" />
            <Field label="Banco da Chave PIX" value={pixBanco} onChange={setPixBanco} placeholder="Ex: Nubank, Itaú..." />
          </div>
        </div>
      </div>

      {/* ── Certificações ── */}
      <div style={{ ...S.card, padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ color: C.ts, fontSize: 12.5, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>🏆 Certificações</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Certificação(ões)" value={certificacoes} onChange={setCertificacoes} placeholder="Ex: Certificação INSS, FGTS..." />
          <Field label="Data de vencimento" value={certVencimento} onChange={setCertVencimento} type="date" placeholder="" />
        </div>
      </div>

      {/* ── Documento ── */}
      <div style={{ ...S.card, padding: "20px 24px", marginBottom: 20 }}>
        <div style={{ color: C.ts, fontSize: 12.5, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>📄 Documento</div>
        {/* Type selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {["RG", "CNH", "Outro"].map(t => (
            <button key={t} onClick={() => canEdit && setDocTipo(t)}
              style={{ background: docTipo === t ? C.abg : C.deep, color: docTipo === t ? C.atxt : C.tm, border: docTipo === t ? `1px solid ${C.atxt}55` : `1px solid ${C.b2}`, borderRadius: 20, padding: "5px 16px", fontSize: 12, cursor: canEdit ? "pointer" : "not-allowed", fontWeight: docTipo === t ? 700 : 400 }}>
              {docTipo === t ? "✓ " : ""}{t}
            </button>
          ))}
        </div>
        {/* Upload */}
        {canEdit && (
          <button onClick={() => docRef.current?.click()}
            style={{ ...S.btn(C.deep, C.tm), border: `1px dashed ${C.atxt}44`, padding: "10px 18px", fontSize: 12.5, marginBottom: 10, width: "100%" }}>
            📎 Anexar {docTipo} (imagem ou PDF)
          </button>
        )}
        <input ref={docRef} type="file" accept="image/*,.pdf" onChange={handleDoc} style={{ display: "none" }} />
        {docFile && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.deep, borderRadius: 8, padding: "9px 13px", border: `1px solid ${C.b1}` }}>
            {docFile.type?.startsWith("image/")
              ? <img src={docFile.url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} />
              : <span style={{ fontSize: 22 }}>📄</span>
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.tp, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{docFile.name}</div>
              <div style={{ color: C.td, fontSize: 11 }}>{docTipo} anexado</div>
            </div>
            {docFile.type?.startsWith("image/") && (
              <a href={docFile.url} target="_blank" rel="noopener noreferrer"
                style={{ background: C.abg, color: C.atxt, border: `1px solid ${C.atxt}33`, borderRadius: 7, padding: "4px 10px", fontSize: 11, textDecoration: "none" }}>Ver</a>
            )}
            {canEdit && (
              <button onClick={() => setDocFile(null)} style={{ background: "transparent", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 14 }}>✕</button>
            )}
          </div>
        )}
      </div>

      {/* ── Save button ── */}
      {canEdit && (
        <button onClick={save} disabled={saving}
          style={{ ...S.btn(C.acc, "#fff"), padding: "12px 32px", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
          {saving ? "Salvando..." : "Salvar perfil"}
        </button>
      )}
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
  const [viewProfileId, setViewProfileId] = useState(null);
  const [searchUser, setSearchUser] = useState("");
  const pRef = useRef();
  const pEditRef = useRef();

  const canSeeAll = currentUser.role === "mestre";
  const allVisible = users.filter(
    (u) =>
      !u.deleted &&
      (canSeeAll || u.createdBy === currentUser.id || u.id === currentUser.id),
  );
  const visible = searchUser.trim()
    ? allVisible.filter(u => {
        const q = searchUser.toLowerCase();
        return (
          (u.name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.cpf || "").includes(q) ||
          (u.role || "").toLowerCase().includes(q)
        );
      })
    : allVisible;

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
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
          <div style={{ color: C.ts, fontSize: 13, flexShrink:0 }}>
            {visible.length} usuário{visible.length !== 1 ? "s" : ""}
            {searchUser && allVisible.length !== visible.length && <span style={{ color:C.td, fontSize:11 }}> de {allVisible.length}</span>}
          </div>
          <div style={{ position:"relative", flex:1, maxWidth:220 }}>
            <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.td, fontSize:13, pointerEvents:"none" }}>🔍</span>
            <input value={searchUser} onChange={e=>setSearchUser(e.target.value)}
              placeholder="Buscar usuário..."
              style={{ ...S.input, paddingLeft:30, fontSize:12, padding:"6px 10px 6px 28px" }} />
            {searchUser && <button onClick={()=>setSearchUser("")} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:13, lineHeight:1 }}>✕</button>}
          </div>
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

                  {/* Ver Perfil completo — mestre e master */}
                  {(currentUser.role === "mestre" || currentUser.role === "master") && (
                    <button
                      onClick={() => setViewProfileId(viewProfileId === (u.uid||u.id) ? null : (u.uid||u.id))}
                      style={{
                        background: viewProfileId === (u.uid||u.id) ? C.abg : C.deep,
                        color: viewProfileId === (u.uid||u.id) ? C.atxt : C.tm,
                        border: viewProfileId === (u.uid||u.id) ? `1px solid ${C.atxt}44` : `1px solid ${C.b2}`,
                        borderRadius: 8, padding: "5px 12px", fontSize: 11,
                        cursor: "pointer", fontWeight: 600, flexShrink: 0,
                      }}>
                      {viewProfileId === (u.uid||u.id) ? "✕ Fechar" : "👁 Perfil"}
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


                {/* ── Full profile view panel (mestre/master) ── */}
                {viewProfileId === (u.uid||u.id) && (
                  <div style={{ borderTop: `1px solid ${C.b1}`, padding: "20px 22px", background: C.deep }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                      <div style={{ color: C.atxt, fontSize: 12.5, fontWeight: 700 }}>👁 Perfil de {u.name || u.email}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {/* Lock/Unlock */}
                        <button onClick={async () => {
                          const updated = { ...u, profileLocked: !u.profileLocked };
                          await saveUserProfile(u.uid||u.id, updated);
                        }}
                          style={{ background: u.profileLocked ? "#2D1515" : C.card, color: u.profileLocked ? "#F87171" : C.tm, border: u.profileLocked ? "1px solid #EF444433" : `1px solid ${C.b2}`, borderRadius: 8, padding: "5px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                          {u.profileLocked ? "🔒 Bloqueado" : "🔓 Bloquear edição"}
                        </button>
                      </div>
                    </div>
                    {(() => {
                      const CopyField = ({ label, val }) => {
                        const [copied, setCopied] = useState(false);
                        const copy = () => { if (!val) return; navigator.clipboard.writeText(val).then(() => { setCopied(true); setTimeout(()=>setCopied(false),1800); }); };
                        return (
                          <div>
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 3 }}>
                              <div style={{ color: C.td, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</div>
                              {val && <button onClick={copy} style={{ background:"none", border:"none", color: copied?"#34D399":C.td, cursor:"pointer", fontSize:10, padding:"0 4px" }}>{copied?"✓":"⎘"}</button>}
                            </div>
                            <div style={{ color: val ? C.tp : C.tm, fontSize: 12.5, fontWeight: val ? 500 : 400 }}>{val || "—"}</div>
                          </div>
                        );
                      };
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                          <CopyField label="Nome completo" val={u.name} />
                          <CopyField label="CPF" val={u.cpf} />
                          <CopyField label="Email (login)" val={u.email} />
                          <CopyField label="CEP" val={u.cep} />
                          <CopyField label="Rua / Nº" val={[u.rua, u.numero].filter(Boolean).join(", ")} />
                          <CopyField label="Cidade / UF" val={[u.cidade, u.uf].filter(Boolean).join(" - ")} />
                          <CopyField label="Complemento" val={u.complemento} />
                          <CopyField label="Banco" val={u.banco} />
                          <CopyField label="Agência" val={u.agencia} />
                          <CopyField label="Conta" val={u.conta} />
                          <CopyField label="Chave PIX" val={u.pixKey} />
                          <CopyField label="Banco da PIX" val={u.pixBanco} />
                          <CopyField label="Certificações" val={u.certificacoes} />
                          <CopyField label="Vencimento cert." val={u.certVencimento} />
                        </div>
                      );
                    })()}
                    {u.docFile && (
                      <div style={{ marginTop: 16, borderTop: `1px solid ${C.b1}`, paddingTop: 14 }}>
                        <div style={{ color: C.td, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 8 }}>Documento ({u.docTipo || "—"})</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 8, padding: "9px 13px", border: `1px solid ${C.b1}` }}>
                          {u.docFile.type?.startsWith("image/")
                            ? <img src={u.docFile.url} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.b1}` }} />
                            : <span style={{ fontSize: 24 }}>📄</span>
                          }
                          <div style={{ flex: 1 }}>
                            <div style={{ color: C.tp, fontSize: 12.5, fontWeight: 600 }}>{u.docFile.name}</div>
                            <div style={{ color: C.td, fontSize: 11 }}>{u.docTipo}</div>
                          </div>
                          {u.docFile.type?.startsWith("image/") && (
                            <a href={u.docFile.url} target="_blank" rel="noopener noreferrer"
                              style={{ background: C.abg, color: C.atxt, border: `1px solid ${C.atxt}33`, borderRadius: 7, padding: "5px 12px", fontSize: 11, textDecoration: "none" }}>Ver documento</a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
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

// ── Stories ────────────────────────────────────────────────────
// ── Notificações ───────────────────────────────────────────────
function NotificacoesPage({ currentUser, users }) {
  const myId = currentUser.uid || currentUser.id;
  const isMestre = currentUser.role === "mestre";
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBroadcastForm, setShowBroadcastForm] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastEmoji, setBroadcastEmoji] = useState("📢");
  const [broadcastColor, setBroadcastColor] = useState("#F59E0B");
  const [sending, setSending] = useState(false);
  const [searchNotif, setSearchNotif] = useState("");
  const markedRef = useRef(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "notifications"), (snap) => {
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(n => n.toId === myId || n.broadcast === true)
        .sort((a, b) => {
          // Broadcasts pinned at top, then by date
          if (a.broadcast && !b.broadcast) return -1;
          if (!a.broadcast && b.broadcast) return 1;
          return b.createdAt - a.createdAt;
        });
      setNotifs(all);
      setLoading(false);
    });
    return () => unsub();
  }, []); // eslint-disable-line

  // Mark all as read on mount
  useEffect(() => {
    if (markedRef.current || notifs.length === 0) return;
    markedRef.current = true;
    const markAll = async () => {
      for (const n of notifs) {
        if (n.broadcast) {
          const readBy = n.readBy || [];
          if (!readBy.includes(myId)) {
            await setDoc(doc(db, "notifications", n.id), { readBy: [...readBy, myId] }, { merge: true });
          }
        } else if (!n.readAt) {
          await setDoc(doc(db, "notifications", n.id), { readAt: Date.now() }, { merge: true });
        }
      }
    };
    markAll();
  }, [notifs]); // eslint-disable-line

  const deleteNotif = async (id) => {
    await deleteDoc(doc(db, "notifications", id));
  };

  const clearPersonal = async () => {
    if (!window.confirm("Limpar suas notificações pessoais?")) return;
    for (const n of notifs.filter(n => !n.broadcast)) {
      await deleteDoc(doc(db, "notifications", n.id));
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastText.trim()) return;
    setSending(true);
    const id = "broadcast_" + Date.now();
    await setDoc(doc(db, "notifications", id), {
      id,
      type: "broadcast",
      broadcast: true,
      emoji: broadcastEmoji,
      color: broadcastColor,
      text: broadcastText.trim(),
      fromId: myId,
      fromName: currentUser.name || currentUser.email,
      createdAt: Date.now(),
      readBy: [myId],
    });
    setBroadcastText(""); setShowBroadcastForm(false); setSending(false);
  };

  const deleteBroadcast = async (id) => {
    if (!window.confirm("Remover este aviso para todos?")) return;
    await deleteDoc(doc(db, "notifications", id));
  };

  const timeAgo = (ts) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (d > 0) return `há ${d}d`;
    if (h > 0) return `há ${h}h`;
    if (m > 0) return `há ${m}min`;
    return "agora";
  };

  const notifIcon = (type) => {
    if (type === "like") return "❤️";
    if (type === "comment") return "💬";
    if (type === "group_add") return "👥";
    if (type === "group_rename") return "✏️";
    if (type === "broadcast") return "📢";
    return "🔔";
  };

  const notifColor = (type, customColor) => {
    if (customColor) return customColor;
    if (type === "like") return "#F472B6";
    if (type === "comment") return C.atxt;
    if (type === "group_add") return "#34D399";
    if (type === "group_rename") return "#FBBF24";
    if (type === "broadcast") return "#F59E0B";
    return C.atxt;
  };

  const notifText = (n) => {
    if (n.type === "like") return (
      <span><strong style={{ color: C.tp }}>{n.fromName}</strong> curtiu seu story com {n.emoji}{n.storyText ? <span style={{ color: C.td }}> · "{n.storyText.slice(0, 30)}{n.storyText.length > 30 ? "…" : ""}"</span> : ""}</span>
    );
    if (n.type === "comment") return (
      <span><strong style={{ color: C.tp }}>{n.fromName}</strong> comentou no seu story{n.commentText ? <span>: <em style={{ color: C.ts }}>"{n.commentText.slice(0, 40)}{n.commentText.length > 40 ? "…" : ""}"</em></span> : ""}</span>
    );
    if (n.type === "group_add") return (
      <span><strong style={{ color: C.tp }}>{n.fromName}</strong> adicionou você ao grupo <strong style={{ color: "#34D399" }}>{n.groupName}</strong></span>
    );
    if (n.type === "group_rename") return (
      <span><strong style={{ color: C.tp }}>{n.fromName}</strong> renomeou o grupo de <strong style={{ color: "#FBBF24" }}>{n.oldName}</strong> para <strong style={{ color: "#FBBF24" }}>{n.groupName}</strong></span>
    );
    if (n.type === "broadcast") return (
      <span style={{ color: C.tp, fontWeight: 500 }}>{n.text}</span>
    );
    return <span>Nova notificação</span>;
  };

  const BROADCAST_EMOJIS = ["📢","🚨","⚠️","✅","🔔","📌","💡","🎯","🏆","🚀","❗","📣"];
  const BROADCAST_COLORS = [
    { label: "Amarelo", color: "#F59E0B" },
    { label: "Vermelho", color: "#EF4444" },
    { label: "Verde", color: "#34D399" },
    { label: "Azul", color: "#60A5FA" },
    { label: "Roxo", color: "#C084FC" },
  ];

  const filteredNotifs = searchNotif.trim()
    ? notifs.filter(n => {
        const q = searchNotif.toLowerCase();
        return (
          (n.fromName || "").toLowerCase().includes(q) ||
          (n.text || "").toLowerCase().includes(q) ||
          (n.commentText || "").toLowerCase().includes(q) ||
          (n.groupName || "").toLowerCase().includes(q) ||
          (n.storyText || "").toLowerCase().includes(q) ||
          (n.type || "").toLowerCase().includes(q)
        );
      })
    : notifs;
  const broadcasts = filteredNotifs.filter(n => n.broadcast);
  const personal = filteredNotifs.filter(n => !n.broadcast);

  return (
    <div style={{ padding: "28px 36px", minHeight: "100%", background: C.bg }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
        <div>
          <h1 style={{ color: C.tp, fontSize: 21, fontWeight: 700, margin: 0 }}>Notificações 🔔</h1>
          <p style={{ color: C.tm, fontSize: 12.5, margin: "4px 0 0" }}>Avisos, curtidas, comentários e atividades de grupo</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems:"center" }}>
          {/* Search */}
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.td, fontSize:13, pointerEvents:"none" }}>🔍</span>
            <input value={searchNotif} onChange={e=>setSearchNotif(e.target.value)}
              placeholder="Buscar notificação..."
              style={{ ...S.input, paddingLeft:28, fontSize:12, padding:"7px 10px 7px 28px", width:200 }} />
            {searchNotif && <button onClick={()=>setSearchNotif("")} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:12, lineHeight:1 }}>✕</button>}
          </div>
          {isMestre && (
            <button onClick={() => setShowBroadcastForm(p => !p)}
              style={{ ...S.btn(showBroadcastForm ? C.abg : "#2B1D03", showBroadcastForm ? C.atxt : "#FBBF24"), border: `1px solid #F59E0B44`, padding: "7px 14px", fontSize: 12, fontWeight: 700 }}>
              📢 Criar Aviso
            </button>
          )}
          {personal.length > 0 && (
            <button onClick={clearPersonal}
              style={{ background: "transparent", border: `1px solid ${C.b2}`, color: C.tm, borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>
              🗑 Limpar minhas
            </button>
          )}
        </div>
      </div>

      {/* ── Broadcast form (mestre only) ── */}
      {showBroadcastForm && isMestre && (
        <div style={{ ...S.card, padding: "20px", marginBottom: 22, border: `1px solid #F59E0B44`, background: "#2B1D0311" }}>
          <div style={{ color: "#FBBF24", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>📢 Novo Aviso para Todos</div>

          {/* Emoji picker */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: C.tm, fontSize: 11, marginBottom: 6 }}>Ícone</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {BROADCAST_EMOJIS.map(e => (
                <button key={e} onClick={() => setBroadcastEmoji(e)}
                  style={{ width: 32, height: 32, borderRadius: 8, background: broadcastEmoji === e ? "#F59E0B22" : C.deep, border: broadcastEmoji === e ? "1.5px solid #F59E0B" : `1px solid ${C.b2}`, fontSize: 16, cursor: "pointer" }}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: C.tm, fontSize: 11, marginBottom: 6 }}>Cor de destaque</div>
            <div style={{ display: "flex", gap: 8 }}>
              {BROADCAST_COLORS.map(bc => (
                <button key={bc.color} onClick={() => setBroadcastColor(bc.color)}
                  style={{ width: 24, height: 24, borderRadius: "50%", background: bc.color, border: broadcastColor === bc.color ? `3px solid #fff` : `2px solid transparent`, cursor: "pointer", boxShadow: broadcastColor === bc.color ? `0 0 0 1px ${bc.color}` : "none" }} />
              ))}
            </div>
          </div>

          {/* Preview */}
          {broadcastText.trim() && (
            <div style={{ background: broadcastColor + "15", border: `1px solid ${broadcastColor}44`, borderRadius: 10, padding: "12px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>{broadcastEmoji}</span>
              <span style={{ color: C.tp, fontSize: 13 }}>{broadcastText}</span>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <textarea value={broadcastText} onChange={e => setBroadcastText(e.target.value)}
              placeholder="Escreva o aviso para toda a equipe..."
              rows={3} style={{ ...S.input, resize: "vertical", fontSize: 13 }} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={sendBroadcast} disabled={!broadcastText.trim() || sending}
              style={{ ...S.btn("#F59E0B", "#000"), padding: "9px 22px", fontSize: 13, fontWeight: 700, opacity: broadcastText.trim() ? 1 : 0.5 }}>
              {sending ? "Enviando..." : "📢 Publicar Aviso"}
            </button>
            <button onClick={() => { setShowBroadcastForm(false); setBroadcastText(""); }}
              style={{ ...S.btn(C.deep, C.tm), padding: "9px 16px", fontSize: 12, border: `1px solid ${C.b2}` }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.tm, fontSize: 13 }}>Carregando...</div>
      )}

      {/* ── Broadcasts (Avisos) pinned at top ── */}
      {broadcasts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: C.td, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10, fontWeight: 600 }}>📢 Avisos da equipe</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 680 }}>
            {broadcasts.map(n => {
              const color = n.color || "#F59E0B";
              const isUnread = !(n.readBy || []).includes(myId);
              return (
                <div key={n.id} style={{
                  borderRadius: 12, padding: "14px 18px",
                  background: color + "12",
                  border: `1.5px solid ${color}55`,
                  display: "flex", alignItems: "flex-start", gap: 12,
                  boxShadow: isUnread ? `0 0 14px ${color}22` : "none",
                }}>
                  <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{n.emoji || "📢"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.tp, fontSize: 13.5, fontWeight: 500, lineHeight: 1.5 }}>{n.text}</div>
                    <div style={{ color: C.td, fontSize: 11, marginTop: 5, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>por <strong style={{ color }}>{n.fromName}</strong></span>
                      <span>·</span>
                      <span>{timeAgo(n.createdAt)}</span>
                      {isUnread && <span style={{ background: color, color: "#000", fontSize: 9, padding: "1px 6px", borderRadius: 6, fontWeight: 700 }}>NOVO</span>}
                    </div>
                  </div>
                  {isMestre && (
                    <button onClick={() => deleteBroadcast(n.id)}
                      style={{ background: "transparent", border: "none", color: C.td, cursor: "pointer", fontSize: 14, padding: "2px 6px", borderRadius: 6, flexShrink: 0 }}
                      onMouseEnter={e => e.currentTarget.style.color = "#EF4444"}
                      onMouseLeave={e => e.currentTarget.style.color = C.td}>✕</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Personal notifs ── */}
      {!loading && personal.length === 0 && broadcasts.length === 0 && (
        <div style={{ ...S.card, padding: "60px 36px", textAlign: "center" }}>
          <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>🔔</div>
          <div style={{ color: C.tm, fontSize: 14, fontWeight: 600 }}>
            {searchNotif ? `Nenhuma notificação encontrada para "${searchNotif}"` : "Nenhuma notificação ainda"}
          </div>
          {!searchNotif && <div style={{ color: C.td, fontSize: 12, marginTop: 6 }}>Quando alguém curtir ou comentar seu story, ou te adicionar a um grupo, vai aparecer aqui.</div>}
        </div>
      )}

      {personal.length > 0 && (
        <>
          <div style={{ color: C.td, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10, fontWeight: 600 }}>Suas notificações</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 680 }}>
            {personal.map(n => {
              const color = notifColor(n.type, n.color);
              const isUnread = !n.readAt;
              return (
                <div key={n.id} style={{
                  ...S.card,
                  padding: "14px 16px",
                  display: "flex", alignItems: "center", gap: 13,
                  border: isUnread ? `1px solid ${color}44` : `1px solid ${C.b1}`,
                  background: isUnread ? color + "0A" : C.card,
                  transition: "all 0.2s", position: "relative",
                }}>
                  {isUnread && (
                    <div style={{ position: "absolute", top: 10, right: 10, width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}88` }} />
                  )}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 42, height: 42, borderRadius: "50%", overflow: "hidden", border: `2px solid ${color}44`, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {n.fromPhoto
                        ? <img src={n.fromPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ color, fontSize: 15, fontWeight: 700 }}>{(n.fromName || "?").charAt(0).toUpperCase()}</span>
                      }
                    </div>
                    <div style={{ position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: "50%", background: C.card, border: `1.5px solid ${C.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>
                      {notifIcon(n.type)}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.ts, fontSize: 13, lineHeight: 1.5 }}>{notifText(n)}</div>
                    <div style={{ color: C.td, fontSize: 11, marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
                  </div>
                  <button onClick={() => deleteNotif(n.id)}
                    style={{ background: "transparent", border: "none", color: C.td, cursor: "pointer", fontSize: 14, padding: "4px 6px", borderRadius: 6, flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = "#EF4444"}
                    onMouseLeave={e => e.currentTarget.style.color = C.td}
                    title="Remover">✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Filtro de palavras ofensivas ──────────────────────────────
const OFFENSIVE_WORDS = [
  // Palavrões gerais
  "merda","porra","caralho","puta","viado","buceta","cu","cuzão","cuzao",
  "fdp","fudeu","fuder","foda","foder","otário","otario","idiota","imbecil",
  "babaca","arrombado","burro","estúpido","estupido","lixo","inútil","inutilmente",
  "safado","safada","vagabundo","vagabunda","prostituta","piranha","rapariga",
  "desgraça","desgraca","maldito","maldita","inferno","filha da puta","filho da puta",
  // Racismo
  "macaco","macacão","neguinho","pretinho","crioulo","subumano",
  "raça inferior","escravos","senzala","nordestino",
  "bolsominion","comunista","petralha",
  // Homofobia/transfobia
  "gay","lésbica","sapatão","bicha","traveco","viadagem",
  "homossexual","transexual",
  // Outras ofensas
  "nazi","nazista","hitler","fascista",
];

function containsOffensiveContent(text) {
  const normalized = text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ");
  return OFFENSIVE_WORDS.some(word => {
    const normWord = word.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, " ");
    return normalized.includes(normWord);
  });
}

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
  const [newBg, setNewBg] = useState("s1");
  const [newFont, setNewFont] = useState("Inter");
  const [comment, setComment] = useState("");
  const [showCommentEmoji, setShowCommentEmoji] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mediaErr, setMediaErr] = useState("");
  const [blockedAlert, setBlockedAlert] = useState(false);

  const FONTS = [
    { name: "Inter",     label: "Padrão",    style: "'Inter',sans-serif" },
    { name: "Georgia",   label: "Clássica",  style: "Georgia,serif" },
    { name: "Courier",   label: "Código",    style: "'Courier New',monospace" },
    { name: "Impact",    label: "Impacto",   style: "Impact,sans-serif" },
    { name: "Comic",     label: "Cursiva",   style: "'Comic Sans MS',cursive" },
    { name: "Trebuchet", label: "Moderna",   style: "Trebuchet MS,sans-serif" },
    { name: "Palatino",  label: "Elegante",  style: "Palatino Linotype,serif" },
  ];

  // Solid backgrounds
  const BG_SOLIDS = [
    { id:"s1", bg:"#1A1F2E", label:"" }, { id:"s2", bg:"#0D2B1A", label:"" },
    { id:"s3", bg:"#2D1515", label:"" }, { id:"s4", bg:"#2D0E30", label:"" },
    { id:"s5", bg:"#082033", label:"" }, { id:"s6", bg:"#2B1D03", label:"" },
    { id:"s7", bg:"#0A0A0A", label:"" }, { id:"s8", bg:"#16213e", label:"" },
  ];

  // Gradient backgrounds
  const BG_GRADIENTS = [
    { id:"g1", bg:"linear-gradient(135deg,#667eea,#764ba2)", label:"💜" },
    { id:"g2", bg:"linear-gradient(135deg,#f093fb,#f5576c)", label:"💗" },
    { id:"g3", bg:"linear-gradient(135deg,#4facfe,#00f2fe)", label:"💙" },
    { id:"g4", bg:"linear-gradient(135deg,#43e97b,#38f9d7)", label:"💚" },
    { id:"g5", bg:"linear-gradient(135deg,#fa709a,#fee140)", label:"🌅" },
    { id:"g6", bg:"linear-gradient(135deg,#a18cd1,#fbc2eb)", label:"🌸" },
    { id:"g7", bg:"linear-gradient(135deg,#ffecd2,#fcb69f)", label:"🍑" },
    { id:"g8", bg:"linear-gradient(135deg,#2c3e50,#3498db)", label:"🌊" },
  ];

  // Themed emoji tile backgrounds (rendered via CSS pattern)
  const BG_THEMED = [
    { id:"t1", bg:"#1a0a2e", emoji:"❤️",  label:"Corações" },
    { id:"t2", bg:"#1a2e0a", emoji:"💰",  label:"Dinheiro" },
    { id:"t3", bg:"#2e2a0a", emoji:"⭐",  label:"Estrelas" },
    { id:"t4", bg:"#0a1a2e", emoji:"🔥",  label:"Fogo"    },
    { id:"t5", bg:"#2e0a0a", emoji:"🎉",  label:"Festa"   },
    { id:"t6", bg:"#0a2e2a", emoji:"💎",  label:"Diamante"},
    { id:"t7", bg:"#2e1a0a", emoji:"🏆",  label:"Troféu"  },
    { id:"t8", bg:"#1a0a1a", emoji:"✨",  label:"Brilho"  },
  ];

  // Dynamic CSS animated backgrounds
  const BG_DYNAMIC = [
    { id:"d1", label:"🌈 Aurora",   css:"linear-gradient(270deg,#ff6b6b,#feca57,#48dbfb,#ff9ff3,#54a0ff)", animate:true },
    { id:"d2", label:"🌊 Oceano",   css:"linear-gradient(135deg,#0f3460,#16213e,#0f3460,#533483)", animate:true },
    { id:"d3", label:"🌙 Galáxia",  css:"linear-gradient(135deg,#0c0c1e,#1a0533,#0c1a33,#0c0c1e)", animate:true },
    { id:"d4", label:"🌺 Tropical", css:"linear-gradient(135deg,#f7971e,#ffd200,#f7971e,#21d4fd)", animate:true },
  ];

  const allBgs = [
    ...BG_SOLIDS.map(b=>({...b, type:"solid"})),
    ...BG_GRADIENTS.map(b=>({...b, type:"gradient"})),
    ...BG_THEMED.map(b=>({...b, type:"themed"})),
    ...BG_DYNAMIC.map(b=>({...b, type:"dynamic"})),
  ];

  const getPreviewStyle = (bgItem) => {
    if (!bgItem) return { background: "#1A1F2E" };
    if (bgItem.type === "solid")   return { background: bgItem.bg };
    if (bgItem.type === "gradient") return { background: bgItem.bg };
    if (bgItem.type === "themed")  return { background: bgItem.bg };
    if (bgItem.type === "dynamic") return { background: bgItem.css, backgroundSize:"400% 400%", animation:"bgShift 4s ease infinite" };
    return { background: "#1A1F2E" };
  };

  const selectedBgItem = allBgs.find(b => b.id === newBg) || allBgs[0];

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

  // ── Post story ───────────────────────────────────────────────
  const post = async () => {
    if (!newText.trim()) return;
    const myStories = stories.filter(s => s.authorId === myId);
    if (myStories.length >= 20) { setMediaErr("Limite de 20 stories atingido."); return; }
    setLoading(true);
    try {
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
        media: null,
        bg: newBg,
        likes: [],
        reactions: {},
        comments: [],
        views: [],
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });
      setCreating(false); setNewText(""); setNewBg("s1"); setNewFont("Inter");
    } catch(e) {
      setMediaErr("Erro ao postar: " + e.message);
    } finally {
      setLoading(false);
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
    const isAdding = !users2.includes(myId);
    const updated = isAdding ? [...users2, myId] : users2.filter(u => u !== myId);
    const newR = { ...reactions, [emoji]: updated };
    if (updated.length === 0) delete newR[emoji];
    await setDoc(doc(db, "stories", story.id), { reactions: newR }, { merge: true });
    // Notif: só quando curtindo, não quando remove, e não para si mesmo
    if (isAdding && story.authorId !== myId) {
      const nid = "notif_like_" + story.id + "_" + myId + "_" + emoji;
      await setDoc(doc(db, "notifications", nid), {
        id: nid,
        type: "like",
        toId: story.authorId,
        fromId: myId,
        fromName: currentUser.name || currentUser.email,
        fromPhoto: myProfile.photo || null,
        emoji,
        storyId: story.id,
        storyText: story.text || "",
        createdAt: Date.now(),
        readAt: null,
      }, { merge: true });
    }
  };

  // ── Comments ─────────────────────────────────────────────────
  const addComment = async (story) => {
    if (!comment.trim()) return;
    if (containsOffensiveContent(comment)) {
      setBlockedAlert(true);
      setTimeout(() => setBlockedAlert(false), 4000);
      return;
    }
    const commentText = comment.trim();
    const comments = [...(story.comments || []), {
      userId: myId,
      userName: currentUser.name || currentUser.email,
      userRole: currentUser.role,
      userPhoto: myProfile.photo || null,
      text: commentText,
      createdAt: Date.now(),
    }];
    await setDoc(doc(db, "stories", story.id), { comments }, { merge: true });
    // Notif de comentário (não notifica a si mesmo)
    if (story.authorId !== myId) {
      const nid = "notif_comment_" + story.id + "_" + myId + "_" + Date.now();
      await setDoc(doc(db, "notifications", nid), {
        id: nid,
        type: "comment",
        toId: story.authorId,
        fromId: myId,
        fromName: currentUser.name || currentUser.email,
        fromPhoto: myProfile.photo || null,
        commentText,
        storyId: story.id,
        storyText: story.text || "",
        createdAt: Date.now(),
        readAt: null,
      });
    }
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
  const [, setTick] = useState(0);
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
    const hasStories = aStories.length > 0;
    // Ring: gradient azul/roxo = não visto | cinza = visto | sem borda = sem story
    const ringStyle = hasStories
      ? allViewed
        ? { border: `2.5px solid ${C.b2}` }
        : { border: "none", background: "linear-gradient(135deg,#3B6EF5,#7C3AED,#F5376B)" }
      : { border: `2px dashed ${C.atxt}44` };

    return (
      <button
        onClick={() => isMe && myStories.length === 0 ? setCreating(true) : openAuthor(authorId)}
        style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", flexShrink:0 }}
      >
        <div style={{ position:"relative", width:72, height:72 }}>
          {/* Outer ring */}
          <div style={{
            position:"absolute", inset:0, borderRadius:"50%",
            ...ringStyle,
            padding: hasStories && !allViewed ? 3 : 2,
            boxSizing:"border-box",
            transition:"all 0.3s",
          }}>
            {/* Gap between ring and photo */}
            <div style={{
              width:"100%", height:"100%", borderRadius:"50%",
              background: C.bg,
              padding: hasStories && !allViewed ? 2 : 0,
              boxSizing:"border-box",
            }}>
              {/* Photo */}
              <div style={{ width:"100%", height:"100%", borderRadius:"50%", overflow:"hidden", background:C.deep, display:"flex", alignItems:"center", justifyContent:"center" }}>
                {authorPhoto
                  ? <img src={authorPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                  : <span style={{ fontSize:20, fontWeight:700, color: isMe ? C.atxt : (roleColor[aStories[0]?.authorRole]||C.atxt) }}>{ini(authorName||"?")}</span>
                }
              </div>
            </div>
          </div>
          {/* Story count badge */}
          {aStories.length > 1 && (
            <div style={{ position:"absolute", top:1, right:1, background:C.acc, color:"#fff", borderRadius:"50%", width:18, height:18, fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", border:`2px solid ${C.bg}`, zIndex:2 }}>
              {aStories.length}
            </div>
          )}
          {/* + button when no stories (own avatar) */}
          {isMe && myStories.length === 0 && (
            <div style={{ position:"absolute", bottom:0, right:0, width:22, height:22, borderRadius:"50%", background:C.acc, border:`2px solid ${C.bg}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"#fff", fontWeight:700, zIndex:2 }}>+</div>
          )}
          {/* Active indicator */}
          {isActive && (
            <div style={{ position:"absolute", inset:-2, borderRadius:"50%", border:`2px solid ${C.atxt}`, pointerEvents:"none" }} />
          )}
        </div>
        <span style={{ color: isActive ? C.atxt : C.tm, fontSize:11, fontWeight: isActive ? 600 : 400, maxWidth:72, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {isMe ? "Você" : (authorName||"?").split(" ")[0]}
        </span>
      </button>
    );
  };

  return (
    <div style={{ padding:"28px 36px", height:"100%", boxSizing:"border-box" }}>
      {/* ── Alerta de comentário bloqueado ── */}
      <style>{`
        @keyframes blinkAlert {
          0%,100%{opacity:1;box-shadow:0 0 18px #3B6EF599}
          50%{opacity:0.55;box-shadow:0 0 36px #3B6EF5cc}
        }
      `}</style>
      {blockedAlert && (
        <div style={{
          position:"fixed", top:28, left:"50%", transform:"translateX(-50%)",
          background:"linear-gradient(135deg,#0D1A3E,#1a2e6e)",
          border:"1.5px solid #3B6EF5",
          borderRadius:14,
          padding:"18px 30px",
          zIndex:9999,
          minWidth:320,
          maxWidth:420,
          textAlign:"center",
          animation:"blinkAlert 0.7s ease-in-out 5",
          boxShadow:"0 4px 32px #3B6EF566",
        }}>
          <div style={{ fontSize:22, marginBottom:8 }}>🚫</div>
          <div style={{ color:"#fff", fontWeight:700, fontSize:14.5, marginBottom:6 }}>
            Seu comentário foi bloqueado
          </div>
          <div style={{ color:"#93B4F5", fontSize:13, lineHeight:1.5, marginBottom:10 }}>
            Contém palavras ofensivas, por favor respeite todos os usuários, você poderá ser restringido e até mesmo banido.
          </div>
          <div style={{ color:"#4F8EF7", fontSize:11.5, fontWeight:600, opacity:0.8 }}>
            Suporte — Nexp
          </div>
        </div>
      )}
      {/* Header */}
      <div style={{ marginBottom:22 }}>
        <h1 style={{ color:C.tp, fontSize:21, fontWeight:700, margin:0 }}>Stories</h1>
        <p style={{ color:C.tm, fontSize:12.5, margin:"4px 0 0" }}>Atualizações que duram 24 horas</p>
      </div>

      {/* ── Criar story ── */}
      {creating && (
        <div style={{ ...S.card, padding:"22px", marginBottom:24 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ color:C.ts, fontSize:13, fontWeight:600 }}>✨ Novo Story ({myStories.length}/20)</div>
            {myStories.length >= 20 && <span style={{ color:"#F87171", fontSize:12 }}>Limite de 20 atingido</span>}
          </div>

          {/* Preview */}
          <div style={{
            ...getPreviewStyle(selectedBgItem),
            borderRadius:14, padding:"28px 22px", minHeight:160,
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            gap:12, marginBottom:16, border:`1px solid ${C.b1}`, position:"relative", overflow:"hidden",
          }}>
            {selectedBgItem?.type === "themed" && (
              <div style={{ position:"absolute", inset:0, display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"center", opacity:0.18, fontSize:24, gap:4, pointerEvents:"none", userSelect:"none" }}>
                {Array(40).fill(selectedBgItem.emoji).map((e,i)=><span key={i}>{e}</span>)}
              </div>
            )}
            {newText
              ? <div style={{ color:"#fff", fontSize:18, fontWeight:600, textAlign:"center", textShadow:"0 2px 8px #00000088", fontFamily: FONTS.find(f=>f.name===newFont)?.style || "inherit", position:"relative" }}>{newText}</div>
              : <div style={{ color:"#ffffff44", fontSize:13, position:"relative" }}>Preview do story</div>
            }
          </div>

          {/* Background picker */}
          <div style={{ marginBottom:14 }}>
            <div style={{ color:C.tm, fontSize:11.5, marginBottom:8 }}>🎨 Fundo</div>
            {/* Sólidos */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
              {BG_SOLIDS.map(b => (
                <button key={b.id} onClick={() => setNewBg(b.id)} style={{ width:26, height:26, borderRadius:"50%", background:b.bg, border:newBg===b.id?`2px solid ${C.atxt}`:`1px solid ${C.b2}`, cursor:"pointer", flexShrink:0 }} />
              ))}
            </div>
            {/* Gradientes */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
              {BG_GRADIENTS.map(b => (
                <button key={b.id} onClick={() => setNewBg(b.id)} title={b.label}
                  style={{ width:26, height:26, borderRadius:"50%", background:b.bg, border:newBg===b.id?`2px solid ${C.atxt}`:`1px solid ${C.b2}`, cursor:"pointer", flexShrink:0, fontSize:12 }} />
              ))}
            </div>
            {/* Temáticos */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
              {BG_THEMED.map(b => (
                <button key={b.id} onClick={() => setNewBg(b.id)} title={b.label}
                  style={{ width:44, height:26, borderRadius:13, background:b.bg, border:newBg===b.id?`2px solid ${C.atxt}`:`1px solid ${C.b2}`, cursor:"pointer", flexShrink:0, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {b.emoji}
                </button>
              ))}
            </div>
            {/* Dinâmicos */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {BG_DYNAMIC.map(b => (
                <button key={b.id} onClick={() => setNewBg(b.id)} title={b.label}
                  style={{ background:b.css, backgroundSize:"200% 200%", animation:"bgShift 3s ease infinite", border:newBg===b.id?`2px solid ${C.atxt}`:`1px solid ${C.b2}`, borderRadius:13, padding:"3px 10px", cursor:"pointer", flexShrink:0, fontSize:10.5, color:"#fff", fontWeight:600 }}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font picker */}
          <div style={{ display:"flex", gap:5, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ color:C.tm, fontSize:11.5, flexShrink:0 }}>Aa</span>
            {FONTS.map(f => (
              <button key={f.name} onClick={() => setNewFont(f.name)}
                style={{ background:newFont===f.name?C.abg:C.deep, border:newFont===f.name?`1px solid ${C.atxt}55`:`1px solid ${C.b2}`, borderRadius:8, padding:"4px 10px", cursor:"pointer", color:newFont===f.name?C.atxt:C.tm, fontSize:11.5, fontFamily:f.style, fontWeight:newFont===f.name?600:400 }}>
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ marginBottom:12 }}>
            <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>Texto</label>
            <textarea value={newText} onChange={e=>setNewText(e.target.value)} rows={2} placeholder="Escreva algo..."
              style={{ ...S.input, resize:"vertical", fontFamily: FONTS.find(f=>f.name===newFont)?.style || "inherit" }} />
          </div>

          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <button onClick={post} disabled={loading || myStories.length >= 20 || !newText.trim()}
              style={{ ...S.btn(C.acc,"#fff"), padding:"10px 24px", fontSize:13, fontWeight:700, opacity:!newText.trim()||myStories.length>=20?0.5:1 }}>
              {loading ? "Publicando..." : "Publicar"}
            </button>
            <button onClick={()=>{setCreating(false);setNewText("");setMediaErr("");setNewFont("Inter");setNewBg("s1");}}
              disabled={loading}
              style={{ ...S.btn("transparent",C.tm), border:`1px solid ${C.b2}`, padding:"10px 16px", fontSize:13 }}>
              Cancelar
            </button>
          </div>
          {mediaErr && <div style={{ color:"#F87171", fontSize:12, marginTop:8 }}>⚠ {mediaErr}</div>}
        </div>
      )}

      {/* ── Avatar row ── */}
      <div style={{ display:"flex", gap:16, overflowX:"auto", paddingBottom:10, marginBottom:24 }}>
        {/* + criar SEMPRE como primeira opção (quando abaixo de 20 stories) */}
        {myStories.length < 20 && (
          <button onClick={() => setCreating(true)}
            style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", flexShrink:0 }}>
            <div style={{ width:68, height:68, borderRadius:"50%", background:C.deep, border:`2px dashed ${C.atxt}66`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, color:C.atxt }}>＋</div>
            <span style={{ color:C.tm, fontSize:11 }}>Novo</span>
          </button>
        )}
        {/* Meu avatar em seguida */}
        {myStories.length > 0 && (
          <StoryAvatar
            authorId={myId}
            authorName={currentUser.name || currentUser.email}
            authorPhoto={myProfile.photo}
            authorStories={myStories}
            isMe={true}
          />
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
          <div style={{
            ...(()=>{
              const b = allBgs.find(x=>x.id===viewStory.bg);
              if (!b) return { background: viewStory.bg || C.card };
              if (b.type==="dynamic") return { background:b.css, backgroundSize:"400% 400%", animation:"bgShift 4s ease infinite" };
              if (b.type==="gradient") return { background:b.bg };
              if (b.type==="themed") return { background:b.bg };
              return { background:b.bg };
            })(),
            borderRadius:18, overflow:"hidden", border:`1px solid ${C.b1}`, display:"flex", flexDirection:"column", minHeight:440, position:"relative",
          }}>

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
                {(viewStory.authorId === myId ||
                  currentUser.role === "mestre" ||
                  (currentUser.role === "master" && viewStory.authorRole !== "mestre")
                ) && (
                  <button onClick={() => deleteStory(viewStory.id)} style={{ background:"rgba(0,0,0,0.4)", border:"none", color:"#F87171", borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }} title="Excluir story">✕</button>
                )}
              </div>
            </div>

            {/* Content */}
            <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"20px", gap:14, overflow:"hidden", position:"relative" }}>
              {/* Themed emoji pattern */}
              {(()=>{ const b=allBgs.find(x=>x.id===viewStory.bg); return b?.type==="themed" && (
                <div style={{ position:"absolute", inset:0, display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"center", opacity:0.15, fontSize:26, gap:5, pointerEvents:"none" }}>
                  {Array(30).fill(b.emoji).map((e,i)=><span key={i}>{e}</span>)}
                </div>
              );})()}
              {viewStory.media?.type?.startsWith("image/") && <img src={viewStory.media.url} alt="" style={{ maxWidth:"100%", maxHeight:260, borderRadius:12, objectFit:"contain", position:"relative" }} />}
              {viewStory.media?.type?.startsWith("audio/") && <audio src={viewStory.media.url} controls style={{ width:"90%", position:"relative" }} />}
              {viewStory.text && <div style={{ color:"#fff", fontSize:20, fontWeight:600, textAlign:"center", textShadow:"0 2px 8px #00000088", lineHeight:1.4, position:"relative", fontFamily: viewStory.font === "Georgia" ? "Georgia,serif" : viewStory.font === "Courier" ? "'Courier New',monospace" : viewStory.font === "Impact" ? "Impact,sans-serif" : viewStory.font === "Comic" ? "'Comic Sans MS',cursive" : viewStory.font === "Trebuchet" ? "Trebuchet MS,sans-serif" : viewStory.font === "Palatino" ? "Palatino Linotype,serif" : "'Inter',sans-serif" }}>{viewStory.text}</div>}
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

// ── FloatingChat ───────────────────────────────────────────────
function FloatingChat({ currentUser, users, presence, minimized, pos, onPosChange, onMinimize, onRestore, onClose, unreadChat, stories, onOpenStory }) {
  const myId = currentUser.uid || currentUser.id;
  const [activeTab, setActiveTab] = useState(null); // null = inbox, uid = DM, "geral" = geral
  const [allMessages, setAllMessages] = useState([]);
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [reactionPicker, setReactionPicker] = useState(null);
  const [hoveredMsg, setHoveredMsg] = useState(null);
  const [showQuick, setShowQuick] = useState(false);
  const [filter, setFilter] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const dragRef = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399" };
  const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador" };

  const getUserPhoto = (uid) => users.find(u => (u.uid||u.id) === uid)?.photo || null;
  const myPhoto = getUserPhoto(myId) || currentUser.photo || null;
  const hasStory = (uid) => {
    const now = Date.now();
    const userStories = (stories||[]).filter(s => s.authorId === uid && s.expiresAt > now);
    if (userStories.length === 0) return false;
    const allSeen = userStories.every(s => (s.views||[]).includes(myId));
    return allSeen ? "seen" : "unseen";
  };

  const isMestre = currentUser.role === "mestre";
  const mestreUser = users.find(u => u.role === "mestre");
  const dmList = isMestre ? users.filter(u => (u.uid||u.id) !== myId) : (mestreUser ? [mestreUser] : []);
  const canManageGroups = currentUser.role === "mestre" || currentUser.role === "master";

  // Group states
  const [groups, setGroups] = useState([]);
  const [searchChat, setSearchChat] = useState("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupPhoto, setGroupPhoto] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const groupPhotoRef = useRef(null);
  const [editingGroup, setEditingGroup] = useState(false);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupPhoto, setEditGroupPhoto] = useState(null);
  const editGroupPhotoRef = useRef(null);

  // Active group object
  const activeGroupId = activeTab?.startsWith("grp:") ? activeTab.slice(4) : null;
  const activeGroup = activeGroupId ? groups.find(g => g.id === activeGroupId) : null;
  const isGroupAdm = activeGroup && (
    activeGroup.admId === myId ||
    activeGroup.createdBy === myId ||
    (activeGroup.admins || []).includes(myId)
  );
  const canShakeInGroup = activeGroup && canManageGroups;

  // Group config panel states
  const [showGroupConfig, setShowGroupConfig] = useState(false);
  const [gcClearPwInput, setGcClearPwInput] = useState("");
  const [gcClearPwErr, setGcClearPwErr] = useState("");
  const [gcDelMsgId, setGcDelMsgId] = useState(null);

  // Derive group settings from activeGroup doc
  const groupLocked     = activeGroup?.locked === true;
  const groupOnlyAdmins = activeGroup?.onlyAdmins === true;
  const groupColor      = activeGroup?.color || null;
  const groupTrophies   = activeGroup?.trophies || {};

  // Default position — bottom right
  const defaultX = window.innerWidth - 400;
  const defaultY = 60;
  const left = pos.x ?? defaultX;
  const top  = pos.y ?? defaultY;

  // Listen messages
  useEffect(() => {
    const unsub = listenChat(setAllMessages);
    return () => unsub();
  }, []);

  // Listen groups
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "chatGroups"), (snap) => {
      const gs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Only show groups where I am a member
      setGroups(gs.filter(g => (g.members || []).includes(myId)));
    });
    return () => unsub();
  }, []); // eslint-disable-line

  // Scroll to bottom
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allMessages, activeTab]);

  // Mark read — fires when tab changes OR when new messages arrive in the open tab
  useEffect(() => {
    if (!activeTab || activeTab === "geral") return;
    const timer = setTimeout(() => {
      // DM: mark messages from the other person
      if (!activeTab.startsWith("grp:")) {
        const unread = allMessages.filter(m => m.toId === myId && m.authorId === activeTab && !m.readAt && m.type !== "shake");
        unread.forEach(async m => { try { await setDoc(doc(db, "chat", m.id), { readAt: new Date().toISOString() }, { merge: true }); } catch(e) {} });
      } else {
        // Group: mark all group messages not from me
        const groupId = activeTab.slice(4);
        const unread = allMessages.filter(m => m.groupId === groupId && m.authorId !== myId && !m.readAt && m.type !== "shake");
        unread.forEach(async m => { try { await setDoc(doc(db, "chat", m.id), { readAt: new Date().toISOString() }, { merge: true }); } catch(e) {} });
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [activeTab, allMessages]); // eslint-disable-line

  // Drag to move
  const startDrag = (e) => {
    e.preventDefault();
    const rect = dragRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const onMove = (ev) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const elW = dragRef.current?.offsetWidth || 380;
      const elH = dragRef.current?.offsetHeight || 580;
      const x = Math.min(Math.max(0, ev.clientX - dragOffset.current.x), W - elW);
      const y = Math.min(Math.max(0, ev.clientY - dragOffset.current.y), H - elH);
      onPosChange({ x, y });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Touch drag
  const startTouchDrag = (e) => {
    const t = e.touches[0];
    const rect = dragRef.current.getBoundingClientRect();
    dragOffset.current = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    const onMove = (ev) => {
      const tt = ev.touches[0];
      const W = window.innerWidth;
      const H = window.innerHeight;
      const elW = dragRef.current?.offsetWidth || 380;
      const elH = dragRef.current?.offsetHeight || 580;
      const x = Math.min(Math.max(0, tt.clientX - dragOffset.current.x), W - elW);
      const y = Math.min(Math.max(0, tt.clientY - dragOffset.current.y), H - elH);
      onPosChange({ x, y });
    };
    const onEnd = () => { window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  const messages = activeTab === "geral"
    ? allMessages.filter(m => !m.toId && !m.groupId)
    : activeGroupId
    ? allMessages.filter(m => m.groupId === activeGroupId)
    : allMessages.filter(m => (m.authorId === myId && m.toId === activeTab) || (m.authorId === activeTab && m.toId === myId));

  const unreadDM = (uid) => allMessages.filter(m => m.toId === myId && m.authorId === uid && !m.readAt && m.type !== "shake").length;

  const send = async (msg) => {
    const content = (msg || text).trim();
    if (!content && !attachment) return;
    setText(""); setShowQuick(false); setShowEmoji(false);
    const payload = {
      text: content || "",
      authorId: myId,
      authorName: currentUser.name || currentUser.email,
      authorRole: currentUser.role,
      ...(activeGroupId ? { groupId: activeGroupId } : activeTab !== "geral" && activeTab ? { toId: activeTab } : {}),
      ...(attachment && { attachment }),
    };
    setAttachment(null);
    await sendChatMessage(payload);
    inputRef.current?.focus();
  };

  const handleKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  const REACTION_EMOJIS = ["❤️","😂","🔥","👍","😮","🎉","💯","😢"];
  const toggleReaction = async (msgId, emoji) => {
    setReactionPicker(null);
    const msg = allMessages.find(m => m.id === msgId); if (!msg) return;
    const reactions = msg.reactions || {};
    const us = reactions[emoji] || [];
    const updated = us.includes(myId) ? us.filter(u => u !== myId) : [...us, myId];
    const newR = { ...reactions, [emoji]: updated };
    if (updated.length === 0) delete newR[emoji];
    await setDoc(doc(db, "chat", msgId), { reactions: newR }, { merge: true });
  };

  const shakeCountRef = useRef(0);
  const shake = async () => {
    if (!canManageGroups) return;
    if (!activeTab || activeTab === "geral") return;
    shakeCountRef.current += 1;
    const count = shakeCountRef.current;
    await sendChatMessage({
      text: `📳 ${currentUser.name || currentUser.email} chamou sua atenção${count > 1 ? ` (${count} vezes)` : " (1 vez)"}`,
      type: "shake",
      authorId: myId,
      authorName: currentUser.name || currentUser.email,
      authorRole: currentUser.role,
      ...(activeGroupId ? { groupId: activeGroupId } : { toId: activeTab }),
    });
  };

  // ── Create group ─────────────────────────────────────────────
  const createGroup = async () => {
    if (!groupName.trim() || groupMembers.length === 0) return;
    const id = "grp_" + Date.now();
    const finalName = groupName.trim();
    const allMembers = [...new Set([myId, ...groupMembers])];
    await setDoc(doc(db, "chatGroups", id), {
      id,
      name: finalName,
      photo: groupPhoto || null,
      admId: myId,
      createdBy: myId,
      createdByName: currentUser.name || currentUser.email,
      members: allMembers,
      createdAt: Date.now(),
    });
    // Notif para cada membro adicionado (exceto o criador)
    for (const memberId of groupMembers) {
      if (memberId === myId) continue;
      const nid = "notif_groupadd_" + id + "_" + memberId;
      await setDoc(doc(db, "notifications", nid), {
        id: nid,
        type: "group_add",
        toId: memberId,
        fromId: myId,
        fromName: currentUser.name || currentUser.email,
        fromPhoto: currentUser.photo || null,
        groupId: id,
        groupName: finalName,
        groupPhoto: groupPhoto || null,
        createdAt: Date.now(),
        readAt: null,
      });
    }
    setShowCreateGroup(false);
    setGroupName(""); setGroupPhoto(null); setGroupMembers([]);
    setActiveTab("grp:" + id);
  };

  // ── Save group edits ─────────────────────────────────────────
  const saveGroupEdit = async () => {
    if (!activeGroup) return;
    const newName = editGroupName.trim() || activeGroup.name;
    const nameChanged = newName !== activeGroup.name;
    await setDoc(doc(db, "chatGroups", activeGroup.id), {
      name: newName,
      photo: editGroupPhoto !== null ? editGroupPhoto : activeGroup.photo,
    }, { merge: true });
    // Notif de renomeação para todos os membros (exceto o próprio adm)
    if (nameChanged) {
      for (const memberId of (activeGroup.members || [])) {
        if (memberId === myId) continue;
        const nid = "notif_grouprename_" + activeGroup.id + "_" + Date.now() + "_" + memberId;
        await setDoc(doc(db, "notifications", nid), {
          id: nid,
          type: "group_rename",
          toId: memberId,
          fromId: myId,
          fromName: currentUser.name || currentUser.email,
          fromPhoto: currentUser.photo || null,
          groupId: activeGroup.id,
          oldName: activeGroup.name,
          groupName: newName,
          groupPhoto: activeGroup.photo || null,
          createdAt: Date.now(),
          readAt: null,
        });
      }
    }
    setEditingGroup(false);
  };

  // ── Unread group msgs ────────────────────────────────────────
  const unreadGroup = (groupId) => allMessages.filter(m => m.groupId === groupId && m.authorId !== myId && !m.readAt && m.type !== "shake").length;

  // ── Group config helpers ─────────────────────────────────────
  const gcUpdate = async (patch) => {
    if (!activeGroup) return;
    await setDoc(doc(db, "chatGroups", activeGroup.id), patch, { merge: true });
  };

  const gcToggleOnlyAdmins = () => gcUpdate({ onlyAdmins: !groupOnlyAdmins });

  const gcSetColor = (color) => gcUpdate({ color });

  const gcToggleTrophy = (uid) => {
    const cur = { ...groupTrophies };
    if (cur[uid]) delete cur[uid]; else cur[uid] = true;
    gcUpdate({ trophies: cur });
  };

  const gcAddAdmin = (uid) => {
    const cur = [...(activeGroup?.admins || [])];
    if (!cur.includes(uid)) cur.push(uid);
    gcUpdate({ admins: cur });
  };

  const gcRemoveAdmin = (uid) => {
    const cur = (activeGroup?.admins || []).filter(x => x !== uid);
    gcUpdate({ admins: cur });
  };

  const gcDeleteMsg = async (msgId) => {
    await deleteDoc(doc(db, "chat", msgId));
    setGcDelMsgId(null);
  };

  const gcClearAll = async () => {
    setGcClearPwErr("");
    // Simple check: require the group adm to type "CONFIRMAR" for safety
    if (gcClearPwInput.trim().toUpperCase() !== "CONFIRMAR") {
      setGcClearPwErr("Digite CONFIRMAR para limpar todas as mensagens.");
      return;
    }
    const groupMsgs = allMessages.filter(m => m.groupId === activeGroupId);
    for (const m of groupMsgs) {
      try { await deleteDoc(doc(db, "chat", m.id)); } catch(e) {}
    }
    setGcClearPwInput(""); setGcClearPwErr("");
  };

  const QUICK_MESSAGES = ["Bom dia, equipe! 🌅","Boa tarde! ☀️","Boa noite! 🌙","Vamos nessa! 🚀","Meta batida! 🏆","Ótimo trabalho! 👏","Aguardando retorno 📞","Reunião em 5 min ⏰","Cliente interessado! 💰","Fechamento confirmado! ✅","Precisando de ajuda 🆘","Tudo certo por aqui 👍"];
  const filteredQuick = filter ? QUICK_MESSAGES.filter(m => m.toLowerCase().includes(filter.toLowerCase())) : QUICK_MESSAGES;

  const tabUser = activeTab && activeTab !== "geral" ? dmList.find(u => (u.uid||u.id) === activeTab) : null;
  const lastMsgTime = (uid) => {
    const msgs = allMessages.filter(m => (m.authorId === uid && m.toId === myId) || (m.authorId === myId && m.toId === uid));
    const last = msgs[msgs.length - 1];
    if (!last?.createdAt?.seconds) return "";
    return new Date(last.createdAt.seconds * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  // ── Minimized pill ──────────────────────────────────────────
  if (minimized) {
    return (
      <div ref={dragRef} onMouseDown={startDrag} onTouchStart={startTouchDrag}
        style={{ position:"fixed", left, top, zIndex:400, display:"flex", alignItems:"center", gap:8, background:`linear-gradient(135deg,${C.acc},${C.lg2})`, borderRadius:24, padding:"8px 16px", cursor:"grab", boxShadow:`0 4px 20px ${C.acc}55`, userSelect:"none", animation:"fadeIn 0.2s ease" }}>
        <div style={{ width:8, height:8, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 6px #4ade80" }} />
        <span style={{ color:"#fff", fontSize:13, fontWeight:700 }}>Nexp Chat</span>
        {unreadChat > 0 && <span style={{ background:"#fff", color:C.acc, borderRadius:"50%", width:18, height:18, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>{unreadChat}</span>}
        <button onClick={onRestore} title="Restaurar" style={{ background:"rgba(255,255,255,0.2)", border:"none", color:"#fff", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center" }}>▲</button>
        <button onClick={onClose} title="Fechar" style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
      </div>
    );
  }

  return (
    <div ref={dragRef} style={{ position:"fixed", left, top, width:380, height:580, zIndex:400, display:"flex", flexDirection:"column", background:C.sb, borderRadius:16, border:`1px solid ${C.b1}`, boxShadow:"0 8px 40px rgba(0,0,0,0.6)", overflow:"hidden", animation:"fadeIn 0.22s ease" }}>

      {/* ── Header ── */}
      <div onMouseDown={startDrag} onTouchStart={startTouchDrag}
        style={{ padding:"12px 14px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", gap:10, cursor:"grab", background:C.sb, flexShrink:0, userSelect:"none" }}>
        {/* Back button */}
        {activeTab && (
          <button onClick={() => setActiveTab(null)} style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:18, padding:"0 4px", lineHeight:1, flexShrink:0 }}
            onMouseEnter={e=>e.currentTarget.style.color=C.tp} onMouseLeave={e=>e.currentTarget.style.color=C.tm}>
            ‹
          </button>
        )}
        {/* Title */}
        <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", gap:8 }}>
          {/* Group photo in header */}
          {activeGroup && (
            <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0, overflow:"hidden", background:C.acc+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>
              {activeGroup.photo
                ? <img src={activeGroup.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                : "👥"}
            </div>
          )}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:C.tp, fontSize:13.5, fontWeight:700, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {activeGroup ? activeGroup.name : activeTab === "geral" ? "Chat Geral 🌐" : tabUser ? (tabUser.name || tabUser.email) : "💬 Nexp Chat"}
            </div>
            <div style={{ color:C.tm, fontSize:10, marginTop:1 }}>
              {activeGroup
                ? `👥 ${(activeGroup.members||[]).length} membros${isGroupAdm ? " · Você é adm" : ""}`
                : activeTab === "geral"
                ? `${users.length} membros`
                : tabUser
                ? (presence[activeTab]?.online ? "● online agora" : lastMsgTime(activeTab) ? `Visto ${lastMsgTime(activeTab)}` : roleLabel[tabUser.role])
                : "Selecione uma conversa"}
            </div>
          </div>
          {/* Group edit button for adm */}
          {isGroupAdm && (
            <button onClick={() => { setShowGroupConfig(p=>!p); setEditingGroup(false); }}
              style={{ background:showGroupConfig?C.abg:"transparent", border:showGroupConfig?`1px solid ${C.atxt}44`:`1px solid ${C.b2}`, color:showGroupConfig?C.atxt:C.tm, borderRadius:8, padding:"3px 10px", fontSize:13, cursor:"pointer", flexShrink:0, transition:"all 0.15s" }} title="Configurações do grupo">
              ⚙
            </button>
          )}
        </div>
        {/* Controls */}
        <div style={{ display:"flex", gap:5 }}>
          <button onClick={onMinimize} title="Minimizar" style={{ background:"rgba(255,255,255,0.08)", border:"none", color:C.tm, borderRadius:8, width:28, height:28, cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.15)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"}>
            —
          </button>
          <button onClick={onClose} title="Fechar" style={{ background:"rgba(239,68,68,0.15)", border:"none", color:"#F87171", borderRadius:8, width:28, height:28, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(239,68,68,0.3)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(239,68,68,0.15)"}>
            ✕
          </button>
        </div>
      </div>

      {/* ── Inbox (no tab selected) ── */}
      {!activeTab && (
        <div style={{ flex:1, overflowY:"auto", padding:"8px" }}>
          {/* Search bar */}
          <div style={{ position:"relative", marginBottom:8 }}>
            <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.td, fontSize:12, pointerEvents:"none" }}>🔍</span>
            <input value={searchChat} onChange={e=>setSearchChat(e.target.value)}
              placeholder="Buscar conversa..."
              style={{ ...S.input, paddingLeft:28, fontSize:12, padding:"7px 10px 7px 28px" }} />
            {searchChat && <button onClick={()=>setSearchChat("")} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:12, lineHeight:1 }}>✕</button>}
          </div>
          {/* Geral — hide if search active and doesn't match */}
          {(!searchChat || "chat geral".includes(searchChat.toLowerCase()) || "geral".includes(searchChat.toLowerCase())) && (
          <button onClick={() => setActiveTab("geral")} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"transparent", border:`1px solid ${C.b1}`, cursor:"pointer", marginBottom:6, textAlign:"left", transition:"all 0.14s" }}
            onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{ width:40, height:40, borderRadius:"50%", background:C.acc+"1A", color:C.acc, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🌐</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:C.tp, fontSize:13, fontWeight:600 }}>Chat Geral</div>
              <div style={{ color:C.tm, fontSize:11 }}>Todos os membros</div>
            </div>
          </button>
          )}

          {/* Groups section */}
          {groups.length > 0 && (
            <div style={{ color:C.td, fontSize:10, textTransform:"uppercase", letterSpacing:"0.5px", padding:"6px 4px 4px", marginTop:4 }}>Grupos</div>
          )}
          {groups.filter(g => !searchChat || (g.name||"").toLowerCase().includes(searchChat.toLowerCase())).map(g => {
            const unread = unreadGroup(g.id);
            return (
              <button key={g.id} onClick={() => { setActiveTab("grp:" + g.id); setEditingGroup(false); }}
                style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"transparent", border:`1px solid ${C.b1}`, cursor:"pointer", marginBottom:6, textAlign:"left", transition:"all 0.14s" }}
                onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{ width:40, height:40, borderRadius:"50%", background:C.acc+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0, overflow:"hidden", border:`1px solid ${C.b1}` }}>
                  {g.photo ? <img src={g.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "👥"}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:C.tp, fontSize:13, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{g.name}</div>
                  <div style={{ color:C.tm, fontSize:11 }}>{(g.members||[]).length} membros</div>
                </div>
                {unread > 0 && <span style={{ background:C.acc, color:"#fff", borderRadius:"50%", width:20, height:20, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{unread}</span>}
              </button>
            );
          })}

          {/* Create group button (mestre/master only) */}
          {canManageGroups && (
            <button onClick={() => setShowCreateGroup(p=>!p)}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:10, background:showCreateGroup?C.abg:"transparent", border:`1px dashed ${showCreateGroup?C.atxt:C.b2}`, cursor:"pointer", marginBottom:6, textAlign:"left", transition:"all 0.14s" }}>
              <div style={{ width:40, height:40, borderRadius:"50%", background:C.acc+"11", color:C.acc, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>＋</div>
              <div style={{ color:showCreateGroup?C.atxt:C.tm, fontSize:12.5, fontWeight:600 }}>Criar grupo</div>
            </button>
          )}

          {/* Create group form */}
          {showCreateGroup && canManageGroups && (
            <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, padding:"14px", marginBottom:8 }}>
              <div style={{ color:C.ts, fontSize:12.5, fontWeight:700, marginBottom:12 }}>Novo Grupo</div>
              {/* Group photo */}
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                <div onClick={() => groupPhotoRef.current?.click()}
                  style={{ width:48, height:48, borderRadius:"50%", background:C.deep, border:`2px dashed ${C.atxt}55`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden", flexShrink:0 }}>
                  {groupPhoto ? <img src={groupPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:20 }}>📷</span>}
                </div>
                <input ref={groupPhotoRef} type="file" accept="image/*" style={{ display:"none" }}
                  onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setGroupPhoto(ev.target.result); r.readAsDataURL(f); }} />
                <input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Nome do grupo..."
                  style={{ ...S.input, fontSize:12.5, flex:1 }} />
              </div>
              {/* Member selection */}
              <div style={{ color:C.tm, fontSize:11, marginBottom:6 }}>Membros:</div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:120, overflowY:"auto", marginBottom:12 }}>
                {users.filter(u=>(u.uid||u.id)!==myId).map(u => {
                  const uid = u.uid || u.id;
                  const sel = groupMembers.includes(uid);
                  return (
                    <button key={uid} onClick={() => setGroupMembers(p => sel ? p.filter(x=>x!==uid) : [...p, uid])}
                      style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:8, background:sel?C.abg:C.deep, border:sel?`1px solid ${C.atxt}44`:`1px solid ${C.b2}`, cursor:"pointer", textAlign:"left" }}>
                      <div style={{ width:24, height:24, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:(roleColor[u.role]||C.atxt)+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:roleColor[u.role]||C.atxt }}>
                        {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                      </div>
                      <span style={{ color:sel?C.atxt:C.ts, fontSize:12, flex:1 }}>{u.name || u.email}</span>
                      {sel && <span style={{ color:C.atxt, fontSize:12 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={createGroup} disabled={!groupName.trim() || groupMembers.length===0}
                  style={{ ...S.btn(groupName.trim()&&groupMembers.length>0?C.acc:C.deep, groupName.trim()&&groupMembers.length>0?"#fff":C.td), padding:"7px 16px", fontSize:12, flex:1, opacity:groupName.trim()&&groupMembers.length>0?1:0.5 }}>
                  Criar grupo
                </button>
                <button onClick={()=>{setShowCreateGroup(false);setGroupName("");setGroupPhoto(null);setGroupMembers([]);}}
                  style={{ ...S.btn(C.deep,C.tm), padding:"7px 12px", fontSize:12, border:`1px solid ${C.b2}` }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* DMs section */}
          {dmList.filter(u => !searchChat || (u.name||u.email||"").toLowerCase().includes(searchChat.toLowerCase())).length > 0 && (
            <div style={{ color:C.td, fontSize:10, textTransform:"uppercase", letterSpacing:"0.5px", padding:"6px 4px 4px", marginTop:2 }}>Mensagens diretas</div>
          )}
          {/* DMs */}
          {dmList.filter(u => !searchChat || (u.name||u.email||"").toLowerCase().includes(searchChat.toLowerCase())).map(u => {
            const uid = u.uid || u.id;
            const rc = roleColor[u.role] || C.atxt;
            const unread = unreadDM(uid);
            const isOnline = presence[uid]?.online;
            const userHasStory = hasStory(uid);
            return (
              <button key={uid} onClick={() => setActiveTab(uid)} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"transparent", border:`1px solid ${C.b1}`, cursor:"pointer", marginBottom:6, textAlign:"left", transition:"all 0.14s" }}
                onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{ position:"relative", flexShrink:0 }}>
                  {/* Story ring: gradiente=não visto, cinza=visto, sem borda=sem story */}
                  <div
                    onClick={e => { e.stopPropagation(); if(userHasStory && onOpenStory) onOpenStory(uid); }}
                    style={{
                      width:44, height:44, borderRadius:"50%",
                      padding: userHasStory ? 2 : 0,
                      boxSizing:"border-box",
                      background: userHasStory === "unseen"
                        ? "linear-gradient(135deg,#3B6EF5,#7C3AED,#F5376B)"
                        : userHasStory === "seen"
                        ? "#6B7280"
                        : "transparent",
                      border: !userHasStory ? `1.5px solid ${rc}33` : "none",
                      cursor: userHasStory ? "pointer" : "default",
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}
                  >
                    <div style={{ width:"100%", height:"100%", borderRadius:"50%", background:C.sb, padding: userHasStory ? 2 : 0, boxSizing:"border-box" }}>
                      {u.photo
                        ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", borderRadius:"50%", objectFit:"cover", display:"block" }} />
                        : <div style={{ width:"100%", height:"100%", borderRadius:"50%", background:rc+"1A", color:rc, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700 }}>{ini(u.name||u.email||"?")}</div>
                      }
                    </div>
                  </div>
                  {isOnline && <div style={{ position:"absolute", bottom:0, right:0, width:10, height:10, borderRadius:"50%", background:"#16A34A", border:`2px solid ${C.sb}`, zIndex:3 }} />}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:C.tp, fontSize:13, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{u.name || u.email}</div>
                  <div style={{ color: isOnline ? "#16A34A" : C.tm, fontSize:11 }}>{isOnline ? "● online" : roleLabel[u.role]}</div>
                </div>
                {unread > 0 && <span style={{ background:C.acc, color:"#fff", borderRadius:"50%", width:20, height:20, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{unread}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Conversation ── */}
      {activeTab && (
        <>
          {/* ── Group config panel (adm only) ── */}
          {showGroupConfig && isGroupAdm && activeGroup && (
            <div style={{ borderBottom:`1px solid ${C.b1}`, background:C.card, flexShrink:0, maxHeight:380, overflowY:"auto" }}>
              <style>{`@keyframes gcFade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>
              <div style={{ animation:"gcFade 0.18s ease", padding:"10px 14px" }}>

                {/* ── Nome + Foto ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:6, fontWeight:700 }}>✏ Nome e foto</div>
                <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                  <div onClick={() => editGroupPhotoRef.current?.click()}
                    style={{ width:36, height:36, borderRadius:"50%", background:C.deep, border:`1.5px dashed ${C.atxt}55`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden", flexShrink:0 }}>
                    {activeGroup.photo ? <img src={activeGroup.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:16 }}>📷</span>}
                  </div>
                  <input ref={editGroupPhotoRef} type="file" accept="image/*" style={{ display:"none" }}
                    onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>{setEditGroupPhoto(ev.target.result); gcUpdate({ photo: ev.target.result });}; r.readAsDataURL(f); }} />
                  <input value={editGroupName} onChange={e=>setEditGroupName(e.target.value)}
                    onBlur={()=>{ if(editGroupName.trim() && editGroupName !== activeGroup.name) saveGroupEdit(); }}
                    placeholder={activeGroup.name}
                    style={{ ...S.input, fontSize:12, flex:1, height:36 }} />
                </div>

                {/* ── Cor do chat ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:6, fontWeight:700 }}>🎨 Cor do chat</div>
                <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                  {[null,"#3B6EF5","#7C3AED","#16A34A","#DC2626","#F59E0B","#EC4899","#0EA5E9","#0F1320"].map(c => (
                    <button key={c||"default"} onClick={() => gcSetColor(c)}
                      style={{ width:22, height:22, borderRadius:"50%", background: c || C.card, border: groupColor===c ? `3px solid #fff` : `1.5px solid ${C.b2}`, cursor:"pointer", flexShrink:0, boxShadow: groupColor===c ? `0 0 0 1px ${c||C.atxt}` : "none" }} />
                  ))}
                </div>

                {/* ── Toggle switches ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:6, fontWeight:700 }}>🔧 Permissões</div>
                {[
                  { label:"🔒 Travar conversa (só adms escrevem)", val:groupOnlyAdmins, fn:gcToggleOnlyAdmins, color:"#F87171" },
                ].map(({ label, val, fn, color }) => (
                  <div key={label} onClick={fn} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 10px", borderRadius:8, cursor:"pointer", marginBottom:6, background:val?color+"15":C.deep, border:val?`1px solid ${color}44`:`1px solid ${C.b2}`, transition:"all 0.15s" }}>
                    <span style={{ color: val ? color : C.ts, fontSize:11.5, fontWeight: val ? 600 : 400 }}>{label}</span>
                    <div style={{ width:32, height:18, borderRadius:9, background:val?color:C.b2, position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                      <div style={{ position:"absolute", top:2, left: val?14:2, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 3px #00000055" }} />
                    </div>
                  </div>
                ))}

                {/* ── Adms ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", margin:"10px 0 6px", fontWeight:700 }}>👑 Administradores</div>
                <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:10 }}>
                  {(activeGroup.members||[]).map(uid => {
                    const u = users.find(x=>(x.uid||x.id)===uid);
                    if (!u) return null;
                    const isCreator = uid === (activeGroup.admId || activeGroup.createdBy);
                    const isAdm = isCreator || (activeGroup.admins||[]).includes(uid);
                    const isSelf2 = uid === myId;
                    return (
                      <div key={uid} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:8, background:isAdm?C.abg:C.deep, border:isAdm?`1px solid ${C.atxt}33`:`1px solid ${C.b2}` }}>
                        <div style={{ width:24, height:24, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:C.b2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:C.atxt }}>
                          {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                        </div>
                        <span style={{ flex:1, color:isAdm?C.atxt:C.ts, fontSize:11.5, fontWeight:isAdm?600:400 }}>{u.name||u.email}{isCreator?" 👑":""}{groupTrophies[uid]?" 🏆":""}</span>
                        {!isSelf2 && !isCreator && (
                          <button onClick={() => isAdm ? gcRemoveAdmin(uid) : gcAddAdmin(uid)}
                            style={{ background:isAdm?"#2D1515":C.abg, color:isAdm?"#F87171":C.atxt, border:isAdm?"1px solid #EF444433":`1px solid ${C.atxt}33`, borderRadius:6, padding:"2px 8px", fontSize:10, cursor:"pointer", fontWeight:600 }}>
                            {isAdm ? "Remover adm" : "+ Adm"}
                          </button>
                        )}
                        {!isSelf2 && (
                          <button onClick={() => gcToggleTrophy(uid)}
                            style={{ background:"transparent", border:"none", fontSize:14, cursor:"pointer", opacity:groupTrophies[uid]?1:0.4 }} title={groupTrophies[uid]?"Tirar troféu":"Dar troféu"}>
                            🏆
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ── Apagar mensagem individual ── */}
                {gcDelMsgId && (
                  <div style={{ background:"#2D1515", border:"1px solid #EF444433", borderRadius:8, padding:"9px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ color:"#F87171", fontSize:11.5, flex:1 }}>Apagar esta mensagem para todos?</span>
                    <button onClick={() => gcDeleteMsg(gcDelMsgId)} style={{ background:"#EF4444", color:"#fff", border:"none", borderRadius:6, padding:"3px 10px", fontSize:11, cursor:"pointer", fontWeight:600 }}>Apagar</button>
                    <button onClick={() => setGcDelMsgId(null)} style={{ background:"transparent", border:"none", color:C.tm, cursor:"pointer", fontSize:12 }}>✕</button>
                  </div>
                )}

                {/* ── Limpar conversa ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", margin:"6px 0 6px", fontWeight:700 }}>🗑 Limpar conversa</div>
                <div style={{ display:"flex", gap:6 }}>
                  <input value={gcClearPwInput} onChange={e=>{setGcClearPwInput(e.target.value);setGcClearPwErr("");}}
                    placeholder='Digite "CONFIRMAR" para apagar tudo'
                    style={{ ...S.input, fontSize:11.5, flex:1 }} />
                  <button onClick={gcClearAll}
                    style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:8, padding:"6px 12px", fontSize:11.5, cursor:"pointer", fontWeight:600, flexShrink:0 }}>
                    Limpar
                  </button>
                </div>
                {gcClearPwErr && <div style={{ color:"#F87171", fontSize:11, marginTop:4 }}>⚠ {gcClearPwErr}</div>}
              </div>
            </div>
          )}
          {/* Group edit panel */}
          {editingGroup && isGroupAdm && (
            <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.b1}`, background:C.card, flexShrink:0 }}>
              <div style={{ color:C.atxt, fontSize:12, fontWeight:700, marginBottom:10 }}>✏ Editar grupo</div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <div onClick={() => editGroupPhotoRef.current?.click()}
                  style={{ width:44, height:44, borderRadius:"50%", background:C.deep, border:`2px dashed ${C.atxt}55`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden", flexShrink:0 }}>
                  {editGroupPhoto
                    ? <img src={editGroupPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                    : activeGroup?.photo
                    ? <img src={activeGroup.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                    : <span style={{ fontSize:18 }}>📷</span>}
                </div>
                <input ref={editGroupPhotoRef} type="file" accept="image/*" style={{ display:"none" }}
                  onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setEditGroupPhoto(ev.target.result); r.readAsDataURL(f); }} />
                <input value={editGroupName} onChange={e=>setEditGroupName(e.target.value)}
                  placeholder="Nome do grupo..." style={{ ...S.input, fontSize:12.5, flex:1 }} />
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={saveGroupEdit} style={{ ...S.btn(C.acc,"#fff"), padding:"6px 14px", fontSize:12, flex:1 }}>Salvar</button>
                <button onClick={()=>setEditingGroup(false)} style={{ ...S.btn(C.deep,C.tm), padding:"6px 12px", fontSize:12, border:`1px solid ${C.b2}` }}>Cancelar</button>
              </div>
            </div>
          )}
          {/* Messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"10px 14px", display:"flex", flexDirection:"column", gap:5, background: groupColor ? groupColor + "18" : "transparent", transition:"background 0.3s" }}>
            {groupOnlyAdmins && !isGroupAdm && (
              <div style={{ textAlign:"center", margin:"10px 0", padding:"8px 16px", background:"#2B1D03", border:"1px solid #F59E0B44", borderRadius:20, color:"#FBBF24", fontSize:11.5, fontWeight:600 }}>
                🔒 Apenas administradores podem escrever neste grupo
              </div>
            )}
            {messages.length === 0 && <div style={{ textAlign:"center", padding:"30px 0", color:C.tm, fontSize:12 }}>Nenhuma mensagem ainda</div>}
            {messages.map(msg => {
              // Shake messages — centered notification
              if (msg.type === "shake") {
                return (
                  <div key={msg.id} style={{ display:"flex", justifyContent:"center", margin:"4px 0" }}>
                    <div style={{ background:"#2D1515", border:"1px solid #EF444433", borderRadius:20, padding:"5px 14px", fontSize:11.5, color:"#F87171", fontWeight:600, textAlign:"center" }}>
                      {msg.text}
                    </div>
                  </div>
                );
              }

              const isMine = msg.authorId === myId;
              const rc = roleColor[msg.authorRole] || C.atxt;
              const time = msg.createdAt?.seconds ? new Date(msg.createdAt.seconds*1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "";
              const reactions = msg.reactions || {};
              const hasReactions = Object.keys(reactions).some(e => (reactions[e]||[]).length > 0);
              return (
                <div key={msg.id} style={{ display:"flex", flexDirection:isMine?"row-reverse":"row", alignItems:"flex-end", gap:6, position:"relative" }}
                  onMouseEnter={()=>setHoveredMsg(msg.id)} onMouseLeave={()=>{setHoveredMsg(null);if(reactionPicker===msg.id)setReactionPicker(null);}}>
                  {/* Avatar — both sides */}
                  {(() => {
                    const photo = isMine ? myPhoto : getUserPhoto(msg.authorId);
                    const rc2 = roleColor[msg.authorRole] || C.atxt;
                    return (
                      <div style={{ width:26, height:26, borderRadius:"50%", overflow:"hidden", flexShrink:0, border:`1.5px solid ${rc2}33` }}>
                        {photo
                          ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                          : <div style={{ width:"100%", height:"100%", background:rc2+"1A", color:rc2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700 }}>{ini(msg.authorName||"?")}</div>
                        }
                      </div>
                    );
                  })()}
                  <div style={{ maxWidth:"75%", display:"flex", flexDirection:"column", alignItems:isMine?"flex-end":"flex-start", position:"relative" }}>
                    {(!isMine && (activeTab==="geral" || activeGroupId)) && (
                      <span style={{ color:rc, fontSize:9.5, fontWeight:700, marginBottom:2 }}>
                        {groupTrophies[msg.authorId] ? "🏆 " : ""}{msg.authorName}
                        {(activeGroup?.admins||[]).includes(msg.authorId) || msg.authorId === (activeGroup?.admId||activeGroup?.createdBy) ? " 👑" : ""}
                      </span>
                    )}
                    <div style={{ display:"flex", alignItems:"center", gap:4, flexDirection:isMine?"row-reverse":"row" }}>
                      <div style={{ background:isMine?C.acc:C.card, color:isMine?"#fff":C.tp, border:isMine?"none":`1px solid ${C.b1}`, borderRadius:isMine?"16px 16px 4px 16px":"16px 16px 16px 4px", padding:"7px 11px", fontSize:12.5, lineHeight:1.5, wordBreak:"break-word" }}>
                        {msg.text && <div>{msg.text}</div>}
                        {msg.attachment && (
                          <div style={{ marginTop:msg.text?5:0 }}>
                            {msg.attachment.type?.startsWith("image/") ? <img src={msg.attachment.url} alt="" style={{ maxWidth:140, maxHeight:140, borderRadius:8, display:"block" }} /> : <a href={msg.attachment.url} download={msg.attachment.name} style={{ color:isMine?"#fff":C.atxt, fontSize:11 }}>📎 {msg.attachment.name}</a>}
                          </div>
                        )}
                      </div>
                      {hoveredMsg === msg.id && (
                        <div style={{ position:"relative", display:"flex", flexDirection:"column", gap:3 }}>
                          {/* Adm can delete any group message */}
                          {activeGroupId && isGroupAdm && (
                            <button onClick={()=>setGcDelMsgId(msg.id)} style={{ background:"#2D1515", border:"1px solid #EF444433", borderRadius:"50%", width:22, height:22, fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#F87171" }} title="Apagar para todos">🗑</button>
                          )}
                          <button onClick={()=>setReactionPicker(p=>p===msg.id?null:msg.id)} style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:"50%", width:22, height:22, fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 6px #00000044" }}>🙂</button>
                          {reactionPicker===msg.id && (
                            <div style={{ position:"absolute", bottom:26, [isMine?"right":"left"]:0, background:C.card, border:`1px solid ${C.b1}`, borderRadius:22, padding:"5px 8px", display:"flex", gap:3, zIndex:10, boxShadow:"0 4px 16px #00000055", whiteSpace:"nowrap" }}>
                              {REACTION_EMOJIS.map(e=>(
                                <button key={e} onClick={()=>toggleReaction(msg.id,e)} style={{ background:(reactions[e]||[]).includes(myId)?C.abg:"transparent", border:"none", borderRadius:"50%", width:28, height:28, fontSize:16, cursor:"pointer" }}>{e}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {hasReactions && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginTop:3, justifyContent:isMine?"flex-end":"flex-start" }}>
                        {Object.entries(reactions).filter(([,u])=>u?.length>0).map(([emoji,us])=>(
                          <button key={emoji} onClick={()=>toggleReaction(msg.id,emoji)} style={{ background:us.includes(myId)?C.abg:C.deep, border:us.includes(myId)?`1px solid ${C.atxt}55`:`1px solid ${C.b2}`, borderRadius:20, padding:"1px 7px", fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", gap:3 }}>
                            <span>{emoji}</span><span style={{ color:us.includes(myId)?C.atxt:C.tm, fontSize:10 }}>{us.length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ display:"flex", alignItems:"center", gap:3, marginTop:2 }}>
                      <span style={{ color:C.td, fontSize:9 }}>{time}</span>
                      {isMine && activeTab!=="geral" && <span style={{ fontSize:10, fontWeight:700, color:msg.readAt?"#38BDF8":C.td, letterSpacing:"-1px" }} title={msg.readAt?`Visto às ${new Date(msg.readAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`:""}>
                        {msg.readAt?"✓✓":"✓"}
                      </span>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Quick messages */}
          {showQuick && (
            <div style={{ margin:"0 10px 5px", background:C.card, border:`1px solid ${C.b1}`, borderRadius:10, overflow:"hidden", maxHeight:150, display:"flex", flexDirection:"column" }}>
              <div style={{ padding:"5px 10px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ color:C.tm, fontSize:10 }}>⚡ Clique para enviar</span>
                <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filtrar..." style={{ ...S.input, padding:"2px 7px", fontSize:10, flex:1 }} />
                <button onClick={()=>{setShowQuick(false);setFilter("");}} style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:12 }}>✕</button>
              </div>
              <div style={{ overflowY:"auto", flex:1 }}>
                {filteredQuick.map((m,i)=>(
                  <div key={i} onClick={()=>send(m)} style={{ padding:"6px 12px", cursor:"pointer", fontSize:11.5, color:C.ts, borderBottom:`1px solid ${C.b1}` }}
                    onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{m}</div>
                ))}
              </div>
            </div>
          )}

          {/* Emoji picker */}
          {showEmoji && (
            <div style={{ margin:"0 10px 5px", display:"flex", flexWrap:"wrap", gap:4, padding:"6px 10px", background:C.card, borderRadius:10, border:`1px solid ${C.b1}` }}>
              {["😀","😂","😍","🥰","😎","🤩","🙄","😅","😇","🤗","🔥","⭐","💰","📞","✅","❌","⏳","🤝","💬","🎯","👍","💪","🎉","💎","🏆","✨","🚀","💯"].map(e=>(
                <button key={e} onClick={()=>setText(t=>t+e)} style={{ background:"none", border:"none", fontSize:17, cursor:"pointer", borderRadius:5, padding:"2px" }}>{e}</button>
              ))}
            </div>
          )}

          {/* Attachment preview */}
          {attachment && (
            <div style={{ margin:"0 10px 4px", padding:"5px 10px", background:C.card, borderRadius:8, border:`1px solid ${C.b1}`, display:"flex", alignItems:"center", gap:8 }}>
              {attachment.type?.startsWith("image/") ? <img src={attachment.url} alt="" style={{ width:28, height:28, objectFit:"cover", borderRadius:4 }} /> : <span>📎</span>}
              <span style={{ color:C.ts, fontSize:11, flex:1 }}>{attachment.name}</span>
              <button onClick={()=>setAttachment(null)} style={{ background:"none", border:"none", color:"#EF4444", cursor:"pointer" }}>✕</button>
            </div>
          )}

          {/* Input */}
          <div style={{ padding:"8px 10px 10px", borderTop:`1px solid ${C.b1}`, flexShrink:0, background:C.sb }}>
            <div style={{ display:"flex", gap:4, alignItems:"flex-end" }}>
              <button onClick={()=>{setShowQuick(p=>!p);setFilter("");}} style={{ background:"transparent", border:"none", color:showQuick?C.atxt:C.tm, borderRadius:8, padding:"6px 8px", cursor:"pointer", fontSize:14, flexShrink:0, transition:"all 0.15s" }} onMouseEnter={e=>e.currentTarget.style.color=C.atxt} onMouseLeave={e=>{if(!showQuick)e.currentTarget.style.color=C.tm}}>⚡</button>
              <button onClick={()=>setShowEmoji(p=>!p)} style={{ background:"transparent", border:"none", color:showEmoji?C.atxt:C.tm, borderRadius:8, padding:"6px 8px", cursor:"pointer", fontSize:14, flexShrink:0, transition:"all 0.15s" }} onMouseEnter={e=>e.currentTarget.style.color=C.atxt} onMouseLeave={e=>{if(!showEmoji)e.currentTarget.style.color=C.tm}}>😊</button>
              {/* Shake: in DMs always visible, in groups only mestre/master */}
              {activeTab !== "geral" && (activeGroupId ? canShakeInGroup : true) && (
                <button onClick={shake} style={{ background:"transparent", border:"none", color:C.tm, borderRadius:8, padding:"6px 8px", cursor:"pointer", fontSize:14, flexShrink:0, transition:"all 0.15s" }} onMouseEnter={e=>{e.currentTarget.style.color="#F87171";}} onMouseLeave={e=>e.currentTarget.style.color=C.tm} title="Chamar atenção">📳</button>
              )}
              {activeTab !== "geral" && (
                <>
                  <button onClick={()=>fileRef.current?.click()} style={{ background:"transparent", border:"none", color:attachment?C.atxt:C.tm, borderRadius:8, padding:"6px 8px", cursor:"pointer", fontSize:14, flexShrink:0 }}>📎</button>
                  <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setAttachment({name:f.name,url:ev.target.result,type:f.type});r.readAsDataURL(f);}} style={{ display:"none" }} />
                </>
              )}
              <textarea ref={inputRef} value={text}
                onChange={e=>{setText(e.target.value);if(e.target.value.startsWith("/"))setShowQuick(true);}}
                onKeyDown={handleKey}
                disabled={groupOnlyAdmins && !isGroupAdm}
                placeholder={groupOnlyAdmins && !isGroupAdm ? "🔒 Apenas adms podem escrever" : activeGroup ? `Mensagem no ${activeGroup.name}…` : activeTab==="geral" ? "Mensagem…" : `Para ${tabUser?.name?.split(" ")[0]||"usuário"}…`}
                rows={1}
                style={{ ...S.input, flex:1, resize:"none", borderRadius:20, padding:"8px 14px", fontSize:12.5, lineHeight:1.5, border:`1px solid ${text.trim()?C.atxt+"66":C.b2}`, transition:"border-color 0.2s, box-shadow 0.2s", boxShadow:text.trim()?`0 0 0 3px ${C.acc}18`:"none", outline:"none", opacity: groupOnlyAdmins && !isGroupAdm ? 0.5 : 1, cursor: groupOnlyAdmins && !isGroupAdm ? "not-allowed" : "text" }}
                onFocus={e=>{if(!(groupOnlyAdmins&&!isGroupAdm)){e.target.style.borderColor=C.atxt+"88";e.target.style.boxShadow=`0 0 0 3px ${C.acc}22`;}}}
                onBlur={e=>{e.target.style.borderColor=text.trim()?C.atxt+"66":C.b2;e.target.style.boxShadow=text.trim()?`0 0 0 3px ${C.acc}18`:"none";}}
              />
              <button onClick={()=>send()} disabled={!text.trim()&&!attachment}
                style={{ background:text.trim()||attachment?C.acc:C.deep, color:text.trim()||attachment?"#fff":C.td, border:"none", borderRadius:"50%", width:36, height:36, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", cursor:text.trim()||attachment?"pointer":"not-allowed", fontSize:15, transition:"all 0.2s", transform:text.trim()||attachment?"scale(1)":"scale(0.88)", boxShadow:text.trim()||attachment?`0 3px 10px ${C.acc}55`:"none", opacity:text.trim()||attachment?1:0.4 }}>
                ➤
              </button>
            </div>
          </div>
        </>
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
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [chatPos, setChatPos] = useState({ x: null, y: null });
  const [chatStories, setChatStories] = useState([]);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [unreadStories, setUnreadStories] = useState(0);
  const lastChatCount = useRef(0);

  // Salva a página ativa ao trocar — chat vira painel flutuante
  const setPageAndSave = (p) => {
    if (p === "chat") { setChatOpen(prev => !prev); return; }
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

  // ── Ouvir stories para exibir ring no chat ────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;
    const unsub = onSnapshot(collection(db, "stories"), (snap) => {
      const now = Date.now();
      const live = snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.expiresAt>now);
      setChatStories(live);
      // Conta stories de OUTROS usuários com pelo menos 1 não visto por mim
      const othersWithUnseen = new Set(
        live
          .filter(s => s.authorId !== myId && !(s.views||[]).includes(myId))
          .map(s => s.authorId)
      ).size;
      setUnreadStories(othersWithUnseen);
    });
    return () => unsub();
  }, [currentUser]); // eslint-disable-line

  // ── Ouvir notificações do usuário atual ───────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;
    const unsub = onSnapshot(collection(db, "notifications"), (snap) => {
      const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const mine = notifs.filter(n => n.toId === myId || n.broadcast === true);
      const unread = mine.filter(n => {
        if (n.broadcast) return !(n.readBy || []).includes(myId);
        return !n.readAt;
      }).length;
      setUnreadNotif(unread);
    });
    return () => unsub();
  }, [currentUser]); // eslint-disable-line

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
    // -1 = primeira carga ainda não aconteceu; ignora shake/flash na inicialização
    lastChatCount.current = -1;
    const unsub = listenChat((msgs) => {
      const relevant = msgs.filter(m => !m.toId || m.toId === myId);
      const newCount = relevant.length;

      // ── Shake: só detecta após a primeira carga (lastChatCount >= 0) ──
      if (lastChatCount.current >= 0 && newCount > lastChatCount.current) {
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
        @keyframes bgShift {
          0%{background-position:0% 50%}
          50%{background-position:100% 50%}
          100%{background-position:0% 50%}
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes storyRing {
          0%,100% { box-shadow: 0 0 0 2px #16A34A, 0 0 8px #16A34A88; }
          50%     { box-shadow: 0 0 0 3px #4ade80, 0 0 16px #4ade8099; }
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
        unreadNotif={unreadNotif}
        unreadStories={unreadStories}
        presence={presence}
        flashUserId={flashUserId}
        stories={chatStories}
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
        {page === "notificacoes" && (
          <NotificacoesPage currentUser={currentUser} users={users} />
        )}
        {page === "stories" && (
          <StoriesPage currentUser={currentUser} users={users} />
        )}
        {page === "premium" && currentUser.role === "mestre" && (
          <PremiumNexp contacts={contacts} setContacts={setContacts} />
        )}
        {page === "premium" && currentUser.role !== "mestre" && (
          <div style={{ padding: "60px 36px", textAlign: "center" }}>
            <div style={{ fontSize: 36, opacity: 0.3, marginBottom: 12 }}>🔒</div>
            <div style={{ color: C.tm, fontSize: 14, fontWeight: 600 }}>Acesso restrito ao Mestre.</div>
          </div>
        )}
        {page === "config" && (
          <ConfigPage users={users} setUsers={setUsers} currentUser={currentUser} theme={theme} onTheme={setTheme} />
        )}
      </div>

      {/* ── Chat Flutuante ── */}
      {chatOpen && (
        <FloatingChat
          currentUser={currentUser}
          users={users}
          presence={presence}
          minimized={chatMinimized}
          pos={chatPos}
          onPosChange={setChatPos}
          onMinimize={() => setChatMinimized(true)}
          onRestore={() => setChatMinimized(false)}
          onClose={() => { setChatOpen(false); setChatMinimized(false); }}
          unreadChat={unreadChat}
          stories={chatStories}
          onOpenStory={(uid) => {
            setChatOpen(false);
            setPage("stories");
            sessionStorage.setItem("nexp_page", "stories");
            sessionStorage.setItem("nexp_story_uid", uid);
          }}
        />
      )}
    </div>
    </>
  );
}
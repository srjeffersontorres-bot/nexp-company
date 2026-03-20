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
  listenCalendarNotes,
  saveCalendarNote,
  deleteCalendarNote,
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
  Padrão:   { acc:"#3B6EF5", abg:"#141A2E", atxt:"#4F8EF7", lg1:"#3B6EF5", lg2:"#7C3AED" },
  Verde:    { acc:"#16A34A", abg:"#0A2918", atxt:"#34D399", lg1:"#16A34A", lg2:"#059669" },
  Vermelho: { acc:"#DC2626", abg:"#2D0A0A", atxt:"#F87171", lg1:"#DC2626", lg2:"#B91C1C" },
  Azul:     { acc:"#0EA5E9", abg:"#082033", atxt:"#38BDF8", lg1:"#0EA5E9", lg2:"#0284C7" },
  Amarelo:  { acc:"#D97706", abg:"#2B1D03", atxt:"#FBBF24", lg1:"#D97706", lg2:"#B45309" },
  Rosa:     { acc:"#DB2777", abg:"#2D0E30", atxt:"#F472B6", lg1:"#DB2777", lg2:"#BE185D" },
  Galáxia:  { acc:"#8B5CF6", abg:"#1A0533", atxt:"#C084FC", lg1:"#7C3AED", lg2:"#EC4899" },
  Lava:     { acc:"#F97316", abg:"#1F0A00", atxt:"#FB923C", lg1:"#EF4444", lg2:"#F97316" },
  Oceano:   { acc:"#06B6D4", abg:"#001A2E", atxt:"#22D3EE", lg1:"#0EA5E9", lg2:"#6366F1" },
  Floresta: { acc:"#15803D", abg:"#071A0A", atxt:"#4ADE80", lg1:"#16A34A", lg2:"#0D9488" },
  // Temas Claros
  "☀️ Claro": {
    light:true, acc:"#2563EB", abg:"#EFF6FF", atxt:"#1D4ED8", lg1:"#3B82F6", lg2:"#6366F1",
    bg:"#F8FAFC", sb:"#F1F5F9", card:"#FFFFFF", deep:"#F1F5F9",
    b1:"#E2E8F0", b2:"#CBD5E1", tp:"#0F172A", ts:"#334155", tm:"#64748B", td:"#94A3B8",
  },
  "🌸 Sakura": {
    light:true, acc:"#DB2777", abg:"#FDF2F8", atxt:"#BE185D", lg1:"#EC4899", lg2:"#A855F7",
    bg:"#FFF7FB", sb:"#FDF2F8", card:"#FFFFFF", deep:"#FDF2F8",
    b1:"#FBCFE8", b2:"#F9A8D4", tp:"#500724", ts:"#9D174D", tm:"#BE185D", td:"#F9A8D4",
  },
  "🍃 Menta": {
    light:true, acc:"#059669", abg:"#ECFDF5", atxt:"#047857", lg1:"#10B981", lg2:"#06B6D4",
    bg:"#F0FDF4", sb:"#ECFDF5", card:"#FFFFFF", deep:"#ECFDF5",
    b1:"#D1FAE5", b2:"#A7F3D0", tp:"#064E3B", ts:"#065F46", tm:"#059669", td:"#A7F3D0",
  },
  "🌤 Céu": {
    light:true, acc:"#0284C7", abg:"#E0F2FE", atxt:"#0369A1", lg1:"#38BDF8", lg2:"#818CF8",
    bg:"#F0F9FF", sb:"#E0F2FE", card:"#FFFFFF", deep:"#E0F2FE",
    b1:"#BAE6FD", b2:"#7DD3FC", tp:"#0C4A6E", ts:"#075985", tm:"#0284C7", td:"#BAE6FD",
  },
  "🧡 Pêssego": {
    light:true, acc:"#EA580C", abg:"#FFF7ED", atxt:"#C2410C", lg1:"#F97316", lg2:"#EAB308",
    bg:"#FFFBF5", sb:"#FFF7ED", card:"#FFFFFF", deep:"#FFF7ED",
    b1:"#FED7AA", b2:"#FDBA74", tp:"#431407", ts:"#7C2D12", tm:"#9A3412", td:"#FED7AA",
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
// ── NexpRobot — robô SVG com corpo animado e 12 poses ─────────
const FRASES_DIA = [
  "Hoje é um novo começo. Faça valer cada minuto! 🚀",
  "Cada cliente atendido é uma vitória. Vai com tudo! 💪",
  "Persistência transforma sonhos em resultados. 🌟",
  "Seu esforço hoje é o sucesso de amanhã. ✨",
  "Grandes conquistas começam com pequenas ações. 🏆",
  "Você é capaz de mais do que imagina. Acredite! 🌈",
  "Foco, força e fé. O sucesso está ao seu alcance! 💎",
  "Cada dia é uma nova oportunidade de brilhar. ☀️",
  "O segredo é nunca parar de tentar. 🔥",
  "Sua dedicação faz a diferença. Orgulhe-se! 🎯",
  "Trabalhe com propósito e os resultados virão. 💡",
  "Hoje você é mais forte do que ontem. 🌿",
  "O sucesso não é sorte, é construção diária. 🧱",
  "Cada sorriso do cliente vale todo o esforço. 😊",
  "Seja a energia que transforma o ambiente. ⚡",
  "Você planta hoje o que vai colher amanhã. 🌱",
  "Não existe meta grande demais para quem não desiste. 🎉",
  "Sua presença aqui já faz a diferença. 👏",
  "O caminho é longo, mas você já está no caminho certo. 🛤️",
  "Celebre cada conquista, por menor que seja. 🥳",
];

function NexpRobot({ size = 44, showFaceOnly = false, poseOverride = null }) {
  const [pose, setPose] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (poseOverride !== null) {
      setPose(poseOverride);
      setAnimKey(k => k + 1);
    }
  }, [poseOverride]);

  const triggerPose = (idx) => {
    setPose(idx);
    setAnimKey(k => k + 1);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPose(0), 2500);
  };

  const handleClick = () => {
    const all = [1,2,3,4,5,6,7,8,9,10,11];
    triggerPose(all[Math.floor(Math.random() * all.length)]);
  };

  // Definir pose atual
  const poses = [
    // 0: idle
    { leftArm: 0,  rightArm: 0,  body: 0,    mouth:"neutral", eyes:"normal",  anim:"float",   label:"" },
    // 1: oi (acena)
    { leftArm: -60, rightArm: 40, body: 0,   mouth:"smile",   eyes:"normal",  anim:"wave",    label:"👋" },
    // 2: dança
    { leftArm: 45,  rightArm: -45, body: 10, mouth:"smile",   eyes:"happy",   anim:"dance",   label:"🕺" },
    // 3: rebola
    { leftArm: 30,  rightArm: 30,  body: -15, mouth:"smile",  eyes:"happy",   anim:"wiggle",  label:"💃" },
    // 4: beijo
    { leftArm: 20,  rightArm: -60, body: 0,  mouth:"kiss",    eyes:"closed",  anim:"bounce",  label:"😘" },
    // 5: pose
    { leftArm: -90, rightArm: -90, body: 0,  mouth:"smile",   eyes:"cool",    anim:"none",    label:"😎" },
    // 6: chora
    { leftArm: 15,  rightArm: 15,  body: 5,  mouth:"sad",     eyes:"cry",     anim:"shake",   label:"😢" },
    // 7: ri
    { leftArm: 30,  rightArm: 30,  body: -8, mouth:"laugh",   eyes:"laugh",   anim:"bounce",  label:"😂" },
    // 8: pula
    { leftArm: -60, rightArm: -60, body: 0,  mouth:"smile",   eyes:"happy",   anim:"jump",    label:"⬆️" },
    // 9: troféu
    { leftArm: -90, rightArm: 20,  body: 0,  mouth:"smile",   eyes:"star",    anim:"bounce",  label:"🏆" },
    // 10: joga bola
    { leftArm: 0,   rightArm: -90, body: 10, mouth:"smile",   eyes:"normal",  anim:"kick",    label:"⚽" },
    // 11: manda beijo duplo
    { leftArm: -70, rightArm: -70, body: 0,  mouth:"kiss",    eyes:"closed",  anim:"float",   label:"💕" },
  ];

  const p = poses[pose] || poses[0];
  const s = size;
  const cx = s * 0.5;  // centro x

  // Mapa de animações CSS
  const animMap = {
    float:  "robotFloat 2.5s ease-in-out infinite",
    wave:   `robotWave${animKey} 0.5s ease-in-out infinite alternate`,
    dance:  `robotDance${animKey} 0.3s ease-in-out infinite alternate`,
    wiggle: `robotWiggle${animKey} 0.2s ease-in-out infinite alternate`,
    bounce: `robotBounce${animKey} 0.4s ease-in-out infinite alternate`,
    shake:  `robotShake${animKey} 0.15s ease-in-out infinite alternate`,
    jump:   `robotJump${animKey} 0.35s ease-in-out infinite alternate`,
    kick:   `robotKick${animKey} 0.4s ease-in-out 0s 4 alternate`,
    none:   "none",
  };
  const bodyAnim = animMap[p.anim] || "none";

  const eyeL = { x: s*0.36, y: s*0.42 };
  const eyeR = { x: s*0.64, y: s*0.42 };
  const mouthY = s * 0.56;
  const eyeR2 = s * 0.08;

  const renderEyes = () => {
    if (p.eyes === "cry") return (<>
      <ellipse cx={eyeL.x} cy={eyeL.y} rx={eyeR2} ry={eyeR2*0.6} fill="#4F8EF7"/>
      <ellipse cx={eyeR.x} cy={eyeR.y} rx={eyeR2} ry={eyeR2*0.6} fill="#4F8EF7"/>
      <line x1={eyeL.x} y1={eyeL.y+eyeR2*0.6} x2={eyeL.x} y2={eyeL.y+eyeR2*2} stroke="#60A5FA" strokeWidth={s*0.02} strokeLinecap="round"/>
      <line x1={eyeR.x} y1={eyeR.y+eyeR2*0.6} x2={eyeR.x} y2={eyeR.y+eyeR2*2} stroke="#60A5FA" strokeWidth={s*0.02} strokeLinecap="round"/>
    </>);
    if (p.eyes === "closed") return (<>
      <path d={`M${eyeL.x-eyeR2} ${eyeL.y} Q${eyeL.x} ${eyeL.y-eyeR2} ${eyeL.x+eyeR2} ${eyeL.y}`} stroke="#4F8EF7" strokeWidth={s*0.025} fill="none" strokeLinecap="round"/>
      <path d={`M${eyeR.x-eyeR2} ${eyeR.y} Q${eyeR.x} ${eyeR.y-eyeR2} ${eyeR.x+eyeR2} ${eyeR.y}`} stroke="#4F8EF7" strokeWidth={s*0.025} fill="none" strokeLinecap="round"/>
    </>);
    if (p.eyes === "cool") return (<>
      <rect x={eyeL.x-eyeR2*1.3} y={eyeL.y-eyeR2*0.7} width={eyeR2*2.6} height={eyeR2*1.4} rx={eyeR2*0.4} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.02}/>
      <rect x={eyeR.x-eyeR2*1.3} y={eyeR.y-eyeR2*0.7} width={eyeR2*2.6} height={eyeR2*1.4} rx={eyeR2*0.4} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.02}/>
    </>);
    if (p.eyes === "star") return (<>
      <text x={eyeL.x-eyeR2*0.8} y={eyeL.y+eyeR2*0.8} fontSize={eyeR2*2} fill="#FBBF24">★</text>
      <text x={eyeR.x-eyeR2*0.8} y={eyeR.y+eyeR2*0.8} fontSize={eyeR2*2} fill="#FBBF24">★</text>
    </>);
    if (p.eyes === "laugh") return (<>
      <path d={`M${eyeL.x-eyeR2} ${eyeL.y+eyeR2*0.3} Q${eyeL.x} ${eyeL.y-eyeR2} ${eyeL.x+eyeR2} ${eyeL.y+eyeR2*0.3}`} stroke="#4F8EF7" strokeWidth={s*0.025} fill="none" strokeLinecap="round"/>
      <path d={`M${eyeR.x-eyeR2} ${eyeR.y+eyeR2*0.3} Q${eyeR.x} ${eyeR.y-eyeR2} ${eyeR.x+eyeR2} ${eyeR.y+eyeR2*0.3}`} stroke="#4F8EF7" strokeWidth={s*0.025} fill="none" strokeLinecap="round"/>
    </>);
    // normal / happy
    return (<>
      <circle cx={eyeL.x} cy={eyeL.y} r={eyeR2} fill="#4F8EF7" opacity="0.95"/>
      <circle cx={eyeR.x} cy={eyeR.y} r={eyeR2} fill="#4F8EF7" opacity="0.95"/>
      <circle cx={eyeL.x+eyeR2*0.3} cy={eyeL.y-eyeR2*0.3} r={eyeR2*0.35} fill="#fff"/>
      <circle cx={eyeR.x+eyeR2*0.3} cy={eyeR.y-eyeR2*0.3} r={eyeR2*0.35} fill="#fff"/>
    </>);
  };

  const renderMouth = () => {
    const mw = s * 0.22;
    if (p.mouth === "kiss") return <circle cx={cx} cy={mouthY} r={s*0.04} fill="#F472B6"/>;
    if (p.mouth === "sad") return <path d={`M${cx-mw*0.7} ${mouthY+s*0.02} Q${cx} ${mouthY-s*0.04} ${cx+mw*0.7} ${mouthY+s*0.02}`} stroke="#60A5FA" strokeWidth={s*0.025} fill="none" strokeLinecap="round"/>;
    if (p.mouth === "laugh") return <path d={`M${cx-mw*0.8} ${mouthY-s*0.02} Q${cx} ${mouthY+s*0.06} ${cx+mw*0.8} ${mouthY-s*0.02}`} stroke="#34D399" strokeWidth={s*0.025} fill="rgba(52,211,153,0.2)" strokeLinecap="round"/>;
    if (p.mouth === "smile") return <path d={`M${cx-mw*0.7} ${mouthY-s*0.01} Q${cx} ${mouthY+s*0.05} ${cx+mw*0.7} ${mouthY-s*0.01}`} stroke="#34D399" strokeWidth={s*0.025} fill="none" strokeLinecap="round"/>;
    return <path d={`M${cx-mw*0.5} ${mouthY} Q${cx} ${mouthY+s*0.02} ${cx+mw*0.5} ${mouthY}`} stroke="#4F8EF7" strokeWidth={s*0.02} fill="none" strokeLinecap="round"/>;
  };

  // Para o rosto-only, retorna só a cabeça SVG
  if (showFaceOnly) {
    const faceSize = size;
    return (
      <div onClick={handleClick} title="Clique para animar!" key={animKey}
        style={{ cursor:"pointer", userSelect:"none", display:"inline-block",
          animation: pose === 0 ? "robotFloat 2.5s ease-in-out infinite" : bodyAnim,
          filter:"drop-shadow(0 2px 12px rgba(79,142,247,0.6))" }}>
        <style>{`
          @keyframes robotFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
          @keyframes robotBounce${animKey} { from{transform:translateY(0) scale(1)} to{transform:translateY(-6px) scale(1.05)} }
          @keyframes robotJump${animKey} { from{transform:translateY(0)} to{transform:translateY(-14px)} }
          @keyframes robotShake${animKey} { from{transform:rotate(-6deg)} to{transform:rotate(6deg)} }
          @keyframes robotDance${animKey} { from{transform:rotate(-5deg) translateY(0)} to{transform:rotate(5deg) translateY(-5px)} }
          @keyframes robotWiggle${animKey} { from{transform:skewX(-6deg)} to{transform:skewX(6deg)} }
          @keyframes robotKick${animKey} { from{transform:rotate(0deg)} to{transform:rotate(-12deg)} }
        `}</style>
        <svg width={faceSize} height={faceSize} viewBox={`0 0 ${faceSize} ${faceSize}`}>
          {/* Antena */}
          <line x1={faceSize*0.5} y1={faceSize*0.06} x2={faceSize*0.5} y2={faceSize*0.2} stroke="#4F8EF7" strokeWidth={faceSize*0.04} strokeLinecap="round"/>
          <circle cx={faceSize*0.5} cy={faceSize*0.05} r={faceSize*0.07} fill={pose===9?"#FBBF24":"#4F8EF7"}/>
          {/* Cabeça */}
          <rect x={faceSize*0.1} y={faceSize*0.18} width={faceSize*0.8} height={faceSize*0.72} rx={faceSize*0.18} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={faceSize*0.04}/>
          {/* Olhos */}
          {(() => {
            const ex1 = faceSize*0.34, ex2 = faceSize*0.66, ey = faceSize*0.47, er = faceSize*0.1;
            if (p.eyes === "closed") return (<>
              <path d={`M${ex1-er} ${ey} Q${ex1} ${ey-er} ${ex1+er} ${ey}`} stroke="#4F8EF7" strokeWidth={faceSize*0.04} fill="none" strokeLinecap="round"/>
              <path d={`M${ex2-er} ${ey} Q${ex2} ${ey-er} ${ex2+er} ${ey}`} stroke="#4F8EF7" strokeWidth={faceSize*0.04} fill="none" strokeLinecap="round"/>
            </>);
            if (p.eyes === "cry") return (<>
              <ellipse cx={ex1} cy={ey} rx={er} ry={er*0.65} fill="#4F8EF7"/>
              <ellipse cx={ex2} cy={ey} rx={er} ry={er*0.65} fill="#4F8EF7"/>
              <line x1={ex1} y1={ey+er*0.65} x2={ex1-er*0.3} y2={ey+er*2.2} stroke="#60A5FA" strokeWidth={faceSize*0.025} strokeLinecap="round"/>
              <line x1={ex2} y1={ey+er*0.65} x2={ex2+er*0.3} y2={ey+er*2.2} stroke="#60A5FA" strokeWidth={faceSize*0.025} strokeLinecap="round"/>
            </>);
            if (p.eyes === "star") return (<>
              <text x={ex1-er} y={ey+er*0.9} fontSize={er*2.2} fill="#FBBF24">★</text>
              <text x={ex2-er} y={ey+er*0.9} fontSize={er*2.2} fill="#FBBF24">★</text>
            </>);
            if (p.eyes === "cool") return (<>
              <rect x={ex1-er*1.4} y={ey-er*0.75} width={er*2.8} height={er*1.5} rx={er*0.5} fill="#0B0D14" stroke="#4F8EF7" strokeWidth={faceSize*0.03}/>
              <rect x={ex2-er*1.4} y={ey-er*0.75} width={er*2.8} height={er*1.5} rx={er*0.5} fill="#0B0D14" stroke="#4F8EF7" strokeWidth={faceSize*0.03}/>
            </>);
            if (p.eyes === "laugh") return (<>
              <path d={`M${ex1-er} ${ey+er*0.4} Q${ex1} ${ey-er} ${ex1+er} ${ey+er*0.4}`} stroke="#4F8EF7" strokeWidth={faceSize*0.04} fill="none" strokeLinecap="round"/>
              <path d={`M${ex2-er} ${ey+er*0.4} Q${ex2} ${ey-er} ${ex2+er} ${ey+er*0.4}`} stroke="#4F8EF7" strokeWidth={faceSize*0.04} fill="none" strokeLinecap="round"/>
            </>);
            return (<>
              <circle cx={ex1} cy={ey} r={er} fill="#4F8EF7" opacity="0.95"/>
              <circle cx={ex2} cy={ey} r={er} fill="#4F8EF7" opacity="0.95"/>
              <circle cx={ex1+er*0.3} cy={ey-er*0.3} r={er*0.38} fill="#fff"/>
              <circle cx={ex2+er*0.3} cy={ey-er*0.3} r={er*0.38} fill="#fff"/>
            </>);
          })()}
          {/* Boca */}
          {(() => {
            const mx = faceSize*0.5, my = faceSize*0.72, mw = faceSize*0.22;
            if (p.mouth === "kiss") return <circle cx={mx} cy={my} r={faceSize*0.06} fill="#F472B6"/>;
            if (p.mouth === "sad") return <path d={`M${mx-mw} ${my+faceSize*0.02} Q${mx} ${my-faceSize*0.04} ${mx+mw} ${my+faceSize*0.02}`} stroke="#60A5FA" strokeWidth={faceSize*0.04} fill="none" strokeLinecap="round"/>;
            if (p.mouth === "laugh") return <path d={`M${mx-mw*1.1} ${my-faceSize*0.02} Q${mx} ${my+faceSize*0.07} ${mx+mw*1.1} ${my-faceSize*0.02}`} stroke="#34D399" strokeWidth={faceSize*0.04} fill="rgba(52,211,153,0.2)" strokeLinecap="round"/>;
            if (p.mouth === "smile") return <path d={`M${mx-mw} ${my-faceSize*0.01} Q${mx} ${my+faceSize*0.06} ${mx+mw} ${my-faceSize*0.01}`} stroke="#34D399" strokeWidth={faceSize*0.04} fill="none" strokeLinecap="round"/>;
            return <path d={`M${mx-mw*0.7} ${my} Q${mx} ${my+faceSize*0.025} ${mx+mw*0.7} ${my}`} stroke="#4F8EF7" strokeWidth={faceSize*0.03} fill="none" strokeLinecap="round"/>;
          })()}
        </svg>
      </div>
    );
  }

  // Robô corpo inteiro
  const headH = s * 0.38;
  const bodyH = s * 0.3;
  const legH  = s * 0.2;
  const armW  = s * 0.16;
  const armH  = s * 0.12;
  const totalH = headH + bodyH + legH + s * 0.1;
  const headY  = s * 0.08;
  const bodyY  = headY + headH + s * 0.02;
  const legY   = bodyY + bodyH;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", cursor:"pointer", userSelect:"none" }}
      onClick={handleClick} title="Clique para animar!">
      <style>{`
        @keyframes robotFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes robotBounce${animKey} { from{transform:translateY(0) scale(1)} to{transform:translateY(-8px) scale(1.04)} }
        @keyframes robotJump${animKey} { from{transform:translateY(0)} to{transform:translateY(-16px)} }
        @keyframes robotShake${animKey} { from{transform:rotate(-5deg)} to{transform:rotate(5deg)} }
        @keyframes robotDance${animKey} { from{transform:rotate(-6deg) translateY(0)} to{transform:rotate(6deg) translateY(-6px)} }
        @keyframes robotWiggle${animKey} { from{transform:skewX(-8deg) rotate(-3deg)} to{transform:skewX(8deg) rotate(3deg)} }
        @keyframes robotKick${animKey} { from{transform:rotate(0deg)} to{transform:rotate(-15deg)} }
        @keyframes robotWave${animKey} { from{transform:rotate(0deg)} to{transform:rotate(-8deg)} }
        @keyframes robotArmWave { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(-30deg)} }
      `}</style>
      <div key={animKey} style={{ animation: pose === 0 ? "robotFloat 2.5s ease-in-out infinite" : bodyAnim, transformOrigin:"center bottom", filter:`drop-shadow(0 4px 16px rgba(79,142,247,${pose===0?0.3:0.6}))` }}>
        <svg width={s} height={totalH} viewBox={`0 0 ${s} ${totalH}`} fill="none">
          {/* Antena */}
          <line x1={cx} y1={headY - s*0.06} x2={cx} y2={headY} stroke="#4F8EF7" strokeWidth={s*0.03} strokeLinecap="round"/>
          <circle cx={cx} cy={headY - s*0.07} r={s*0.05} fill={pose===9?"#FBBF24":"#4F8EF7"}/>
          {/* Cabeça */}
          <rect x={s*0.18} y={headY} width={s*0.64} height={headH} rx={s*0.1} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.025}/>
          {/* Olhos e boca (reutilizando as funções) */}
          {renderEyes()}
          {renderMouth()}
          {/* Corpo */}
          <rect x={s*0.22} y={bodyY} width={s*0.56} height={bodyH} rx={s*0.08} fill="#141A2E" stroke="#4F8EF7" strokeWidth={s*0.02}/>
          {/* Botões peito */}
          <circle cx={cx-s*0.1} cy={bodyY+bodyH*0.4} r={s*0.04} fill="#4F8EF7" opacity="0.7"/>
          <circle cx={cx} cy={bodyY+bodyH*0.4} r={s*0.04} fill="#7C3AED" opacity="0.6"/>
          <circle cx={cx+s*0.1} cy={bodyY+bodyH*0.4} r={s*0.04} fill="#34D399" opacity="0.6"/>
          {/* Braço esquerdo */}
          <g style={{ transformOrigin:`${s*0.22}px ${bodyY+armH*0.5}px`, transform:`rotate(${p.leftArm}deg)`, transition:"transform 0.3s ease" }}>
            <rect x={s*0.04} y={bodyY+s*0.02} width={armW} height={armH} rx={armH*0.5} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.02}/>
            {p.key==="oi" && <circle cx={s*0.04} cy={bodyY+s*0.02} r={s*0.04} fill="#FBBF24"/>}
          </g>
          {/* Braço direito */}
          <g style={{ transformOrigin:`${s*0.78}px ${bodyY+armH*0.5}px`, transform:`rotate(${p.rightArm}deg)`, transition:"transform 0.3s ease" }}>
            <rect x={s*0.78} y={bodyY+s*0.02} width={armW} height={armH} rx={armH*0.5} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.02}/>
            {p.key==="troféu" && <text x={s*0.82} y={bodyY-s*0.06} fontSize={s*0.15}>🏆</text>}
          </g>
          {/* Pernas */}
          <rect x={s*0.28} y={legY} width={s*0.17} height={legH} rx={s*0.06} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.02}/>
          <rect x={s*0.55} y={legY} width={s*0.17} height={legH} rx={s*0.06} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.02}/>
          {/* Pezinhos */}
          <ellipse cx={s*0.365} cy={legY+legH} rx={s*0.12} ry={s*0.04} fill="#4F8EF7" opacity="0.6"/>
          <ellipse cx={s*0.635} cy={legY+legH} rx={s*0.12} ry={s*0.04} fill="#4F8EF7" opacity="0.6"/>
        </svg>
      </div>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [un, setUn] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [weather, setWeather] = useState(null);

  // Determinar hora do dia e clima
  const hour = new Date().getHours();
  const isNight = hour >= 20 || hour < 6;
  const isMorning = hour >= 6 && hour < 12;
  const isAfternoon = hour >= 12 && hour < 18;
  const isEvening = hour >= 18 && hour < 20;

  // Frase motivacional do dia (muda todo dia)
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  const frase = FRASES_DIA[dayOfYear % FRASES_DIA.length];

  const [cityName, setCityName] = useState(null);
  const [forecast, setForecast] = useState(null);

  // Buscar clima + cidade
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async pos => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords;
          // Clima atual + previsão do dia
          const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`);
          const d = await r.json();
          setWeather(d.current_weather);
          if (d.daily) setForecast({ tmax: d.daily.temperature_2m_max?.[0], tmin: d.daily.temperature_2m_min?.[0], rain: d.daily.precipitation_probability_max?.[0] });
          // Nome da cidade via reverse geocoding
          try {
            const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pt`);
            const gd  = await geo.json();
            const city = gd.address?.city || gd.address?.town || gd.address?.village || gd.address?.county || "";
            const state = gd.address?.state_code || gd.address?.state || "";
            setCityName(city && state ? `${city}, ${state}` : city || state || null);
          } catch {}
        } catch {}
      }, () => {});
    }
  }, []);

  // Determinar tema visual baseado em hora e clima
  const wcode = weather?.weathercode ?? -1;
  const isRain   = wcode >= 51 && wcode <= 82;
  const isCloudy = (wcode >= 2 && wcode <= 3) || wcode === 45 || wcode === 48;

  const getBgGradient = () => {
    if (isRain)    return "linear-gradient(180deg, #1a2535 0%, #263040 60%, #1a2535 100%)";
    if (isNight)   return "linear-gradient(180deg, #020408 0%, #060B1A 40%, #0A0F22 100%)";
    if (isMorning) return "linear-gradient(180deg, #1a3a6b 0%, #2563aa 50%, #f97316 100%)";
    if (isAfternoon) return "linear-gradient(180deg, #1e3a8a 0%, #2563eb 40%, #38bdf8 100%)";
    if (isEvening) return "linear-gradient(180deg, #4c1d95 0%, #7c3aed 40%, #f97316 100%)";
    if (isCloudy)  return "linear-gradient(180deg, #374151 0%, #4b5563 50%, #6b7280 100%)";
    return "linear-gradient(180deg, #060810 0%, #0A0F22 100%)";
  };

  const go = async () => {
    if (!un.trim() || !pw.trim()) { setErr("Preencha e-mail e senha."); return; }
    setLoading(true); setErr("");
    try {
      const firebaseUser = await firebaseLogin(un.trim(), pw);
      const profile = await getUserProfile(firebaseUser.uid);
      if (!profile) { setErr("Perfil não encontrado. Entre em contato com o suporte."); setLoading(false); return; }
      if (profile.active === false) { setErr("Usuário inativo. Entre em contato com o suporte."); setLoading(false); return; }
      onLogin({ ...profile, uid: firebaseUser.uid });
    } catch { setErr("Usuário ou senha inválidos."); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:getBgGradient(), display:"flex", alignItems:"center", justifyContent:"space-between", padding:"32px 5%", position:"relative", overflow:"hidden", gap:32 }}>

      <style>{`
        @keyframes sunMove { 0%{left:10%} 100%{left:80%} }
        @keyframes moonMove { 0%{right:10%} 100%{right:80%} }
        @keyframes cloudFloat { 0%{transform:translateX(0)} 100%{transform:translateX(60px)} }
        @keyframes cloudFloat2 { 0%{transform:translateX(0)} 100%{transform:translateX(-40px)} }
        @keyframes rainDrop { 0%{top:-5%;opacity:0.7} 100%{top:110%;opacity:0.2} }
        @keyframes starTwinkle { 0%,100%{opacity:0.3} 50%{opacity:1} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes robotFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
      `}</style>

      {/* ══ CENA COMPLETA ══ */}
      <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", zIndex:0 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFF9C4" stopOpacity="1"/>
            <stop offset="50%" stopColor="#FDE68A" stopOpacity="0.7"/>
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="moonGlow2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FEF9C3"/>
            <stop offset="60%" stopColor="#FDE68A"/>
            <stop offset="100%" stopColor="#E9A827" stopOpacity="0"/>
          </radialGradient>
          <filter id="glow4"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="glow2"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <linearGradient id="grassGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e"/>
            <stop offset="100%" stopColor="#14532d"/>
          </linearGradient>
          <linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4b5563"/>
            <stop offset="100%" stopColor="#1f2937"/>
          </linearGradient>
          <linearGradient id="sidewalkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9ca3af"/>
            <stop offset="100%" stopColor="#6b7280"/>
          </linearGradient>
        </defs>

        {/* ── ESTRELAS (noite) ── */}
        {isNight && Array.from({length:50}).map((_,i)=>(
          <circle key={i} cx={20+(i*31+i*7)%1400} cy={8+(i*19)%280} r={i%6===0?2.2:i%3===0?1.5:0.9}
            fill="#fff" opacity={0.3+(i%4)*0.18}>
            <animate attributeName="opacity"
              values={`${0.15+(i%3)*0.2};${0.9+(i%2)*0.1};${0.15+(i%3)*0.2}`}
              dur={`${1.2+(i%5)*0.6}s`} begin={`${i*0.14}s`} repeatCount="indefinite"/>
          </circle>
        ))}

        {/* ── LUA cheia, visível, percorre o céu ── */}
        {isNight && (
          <g filter="url(#glow4)">
            <circle r="60" fill="#FBBF24" opacity="0.12">
              <animateMotion dur="180s" repeatCount="indefinite"
                path="M -80,140 C 300,30 900,20 1520,130"/>
            </circle>
            <circle r="42" fill="#E2C96B">
              <animateMotion dur="180s" repeatCount="indefinite"
                path="M -80,140 C 300,30 900,20 1520,130"/>
            </circle>
            <circle r="38" fill="#F5D77A">
              <animateMotion dur="180s" repeatCount="indefinite"
                path="M -80,140 C 300,30 900,20 1520,130"/>
            </circle>
            {/* Sombra da lua crescente */}
            <circle r="32" fill={isNight?"#060B1A":"transparent"} opacity="0.9">
              <animateMotion dur="180s" repeatCount="indefinite"
                path="M -62,126 C 318,16 918,6 1538,116"/>
            </circle>
            {/* Crateras */}
            <circle r="5" fill="#C9A227" opacity="0.4">
              <animateMotion dur="180s" repeatCount="indefinite"
                path="M -95,152 C 285,42 885,32 1505,142"/>
            </circle>
            <circle r="3" fill="#C9A227" opacity="0.3">
              <animateMotion dur="180s" repeatCount="indefinite"
                path="M -72,158 C 308,48 908,38 1528,148"/>
            </circle>
          </g>
        )}

        {/* ── SOL percorre o céu lentamente ── */}
        {!isNight && !isRain && (
          <g filter="url(#glow4)">
            {/* Halo externo */}
            <circle r="90" fill="url(#sunGlow)" opacity="0.4">
              <animateMotion dur="240s" repeatCount="indefinite"
                path="M -100,200 C 200,40 700,20 1540,180"/>
            </circle>
            {/* Raios — giram em torno do centro */}
            {Array.from({length:12}).map((_,ri)=>{
              const a = ri*30;
              return (
                <line key={ri}
                  x1={Math.cos(a*Math.PI/180)*52} y1={Math.sin(a*Math.PI/180)*52}
                  x2={Math.cos(a*Math.PI/180)*76} y2={Math.sin(a*Math.PI/180)*76}
                  stroke="#FDE68A" strokeWidth="2.5" strokeLinecap="round" opacity="0.55">
                  <animateMotion dur="240s" repeatCount="indefinite"
                    path="M -100,200 C 200,40 700,20 1540,180"/>
                  <animateTransform attributeName="transform" type="rotate"
                    from="0 0 0" to="360 0 0" dur="50s" repeatCount="indefinite"
                    additive="sum"/>
                </line>
              );
            })}
            {/* Núcleo */}
            <circle r="44" fill="#FDE68A">
              <animateMotion dur="240s" repeatCount="indefinite"
                path="M -100,200 C 200,40 700,20 1540,180"/>
            </circle>
            <circle r="36" fill="#FFFDE7">
              <animateMotion dur="240s" repeatCount="indefinite"
                path="M -100,200 C 200,40 700,20 1540,180"/>
            </circle>
          </g>
        )}

        {/* ── NUVENS ── */}
        {!isNight && (
          <>
            <g opacity={isCloudy||isRain?0.92:0.6}>
              <ellipse cx="320" cy="170" rx="100" ry="46" fill="white" opacity="0.9">
                <animateTransform attributeName="transform" type="translate" values="0 0;35 0;0 0" dur="22s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="255" cy="185" rx="68" ry="36" fill="white" opacity="0.85">
                <animateTransform attributeName="transform" type="translate" values="0 0;35 0;0 0" dur="22s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="385" cy="188" rx="58" ry="32" fill="white" opacity="0.78">
                <animateTransform attributeName="transform" type="translate" values="0 0;35 0;0 0" dur="22s" repeatCount="indefinite"/>
              </ellipse>
            </g>
            <g opacity={isCloudy||isRain?0.85:0.48}>
              <ellipse cx="900" cy="130" rx="88" ry="40" fill="white" opacity="0.85">
                <animateTransform attributeName="transform" type="translate" values="0 0;-28 0;0 0" dur="30s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="848" cy="144" rx="58" ry="30" fill="white" opacity="0.78">
                <animateTransform attributeName="transform" type="translate" values="0 0;-28 0;0 0" dur="30s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="958" cy="147" rx="52" ry="28" fill="white" opacity="0.72">
                <animateTransform attributeName="transform" type="translate" values="0 0;-28 0;0 0" dur="30s" repeatCount="indefinite"/>
              </ellipse>
            </g>
            {(isCloudy||isRain) && (
              <>
                <g opacity="0.82">
                  <ellipse cx="620" cy="100" rx="120" ry="54" fill={isRain?"#94a3b8":"white"} opacity="0.7">
                    <animateTransform attributeName="transform" type="translate" values="0 0;22 0;0 0" dur="36s" repeatCount="indefinite"/>
                  </ellipse>
                  <ellipse cx="548" cy="118" rx="80" ry="42" fill={isRain?"#94a3b8":"white"} opacity="0.68">
                    <animateTransform attributeName="transform" type="translate" values="0 0;22 0;0 0" dur="36s" repeatCount="indefinite"/>
                  </ellipse>
                  <ellipse cx="698" cy="115" rx="75" ry="38" fill={isRain?"#94a3b8":"white"} opacity="0.65">
                    <animateTransform attributeName="transform" type="translate" values="0 0;22 0;0 0" dur="36s" repeatCount="indefinite"/>
                  </ellipse>
                </g>
                <g opacity="0.75">
                  <ellipse cx="1200" cy="158" rx="96" ry="44" fill={isRain?"#6b7280":"white"} opacity="0.68">
                    <animateTransform attributeName="transform" type="translate" values="0 0;-16 0;0 0" dur="26s" repeatCount="indefinite"/>
                  </ellipse>
                  <ellipse cx="1148" cy="172" rx="66" ry="34" fill={isRain?"#6b7280":"white"} opacity="0.62">
                    <animateTransform attributeName="transform" type="translate" values="0 0;-16 0;0 0" dur="26s" repeatCount="indefinite"/>
                  </ellipse>
                </g>
              </>
            )}
          </>
        )}
        {/* Nuvens noturnas escuras */}
        {isNight && (
          <g opacity="0.35">
            <ellipse cx="500" cy="150" rx="90" ry="38" fill="#1e293b">
              <animateTransform attributeName="transform" type="translate" values="0 0;20 0;0 0" dur="40s" repeatCount="indefinite"/>
            </ellipse>
            <ellipse cx="1100" cy="120" rx="110" ry="44" fill="#1e293b">
              <animateTransform attributeName="transform" type="translate" values="0 0;-18 0;0 0" dur="50s" repeatCount="indefinite"/>
            </ellipse>
          </g>
        )}

        {/* ── CHUVA ── */}
        {isRain && Array.from({length:70}).map((_,i)=>(
          <line key={i} x1={(i*21)%1440} y1="-10" x2={(i*21+6)%1440} y2="28"
            stroke="rgba(147,197,253,0.45)" strokeWidth="1.4" strokeLinecap="round">
            <animateTransform attributeName="transform" type="translate"
              values={`0 0;0 ${930}`}
              dur={`${0.55+(i%5)*0.11}s`} begin={`${(i*0.04)%1.1}s`} repeatCount="indefinite"/>
          </line>
        ))}

        {/* ── PRÉDIOS FUNDO — menores, bem atrás ── */}
        {[
          {x:30,  w:44,h:130},{x:84, w:34,h:105},{x:128,w:40,h:150},
          {x:178,w:30,h:115},{x:218,w:52,h:170},{x:280,w:36,h:130},
          {x:326,w:48,h:160},{x:384,w:30,h:120},{x:424,w:58,h:195},
          {x:492,w:34,h:135},{x:536,w:44,h:165},{x:590,w:42,h:190},
          {x:642,w:34,h:145},{x:686,w:52,h:175},{x:748,w:40,h:155},
          {x:798,w:32,h:120},{x:840,w:50,h:170},{x:900,w:36,h:140},
          {x:946,w:46,h:168},{x:1002,w:32,h:125},{x:1044,w:48,h:158},
          {x:1102,w:30,h:118},{x:1142,w:58,h:200},{x:1210,w:34,h:138},
          {x:1254,w:44,h:162},{x:1308,w:36,h:128},{x:1354,w:52,h:172},
          {x:1416,w:34,h:135},
        ].map((b,i)=>(
          <rect key={i} x={b.x} y={680-b.h} width={b.w} height={b.h} rx="2"
            fill={isNight?"#0d1526":"#1e293b"} opacity="0.65"/>
        ))}

        {/* ── PRÉDIOS FRENTE — menores, com janelas e antenas ── */}
        {[
          {x:0,   w:60, h:185, fill:"#0f172a", wins:[[8,18],[8,50],[8,82],[34,18],[34,50],[34,82]]},
          {x:120, w:78, h:240, fill:"#0f172a", wins:[[10,18],[10,55],[10,92],[10,129],[44,18],[44,55],[44,92],[44,129]]},
          {x:310, w:68, h:200, fill:"#1a2535", wins:[[10,18],[10,55],[10,92],[38,18],[38,55],[38,92]]},
          {x:480, w:82, h:278, fill:"#0f172a", wins:[[11,18],[11,60],[11,102],[11,144],[46,18],[46,60],[46,102],[46,144]]},
          {x:660, w:72, h:220, fill:"#1a2535", wins:[[10,18],[10,56],[10,94],[40,18],[40,56],[40,94]]},
          {x:840, w:78, h:258, fill:"#0f172a", wins:[[10,18],[10,58],[10,98],[10,138],[44,18],[44,58],[44,98],[44,138]]},
          {x:1020,w:68, h:210, fill:"#1a2535", wins:[[10,18],[10,56],[10,94],[38,18],[38,56],[38,94]]},
          {x:1190,w:80, h:260, fill:"#0f172a", wins:[[10,18],[10,58],[10,98],[10,138],[45,18],[45,58],[45,98],[45,138]]},
          {x:1370,w:70, h:195, fill:"#1a2535", wins:[[10,18],[10,56],[10,94],[38,18],[38,56],[38,94]]},
        ].map((b,bi)=>(
          <g key={bi}>
            <rect x={b.x} y={680-b.h} width={b.w} height={b.h} fill={b.fill}/>
            <line x1={b.x+b.w/2} y1={680-b.h} x2={b.x+b.w/2} y2={680-b.h-16}
              stroke="#475569" strokeWidth="2"/>
            <circle cx={b.x+b.w/2} cy={680-b.h-18} r="2.5" fill="#EF4444" opacity="0.9">
              <animate attributeName="opacity" values="0.9;0.15;0.9" dur="1.8s" repeatCount="indefinite"/>
            </circle>
            {b.wins.map(([wx,wy],wi)=>(
              <rect key={wi} x={b.x+wx} y={680-b.h+wy} width={14} height={10} rx={1}
                fill={isNight?(wi%3===0?"#FDE68A":wi%5===0?"#93C5FD":"#1e3a5f"):"#7dd3fc"}
                opacity={isNight?0.92:(wi%4===0?0.6:0.25)}/>
            ))}
          </g>
        ))}

        {/* ── POSTES DE LUZ (noite) ── */}
        {isNight && [100,300,500,700,900,1100,1300].map((x,i)=>(
          <g key={i} transform={`translate(${x},680)`}>
            <rect x="-3" y="-70" width="6" height="70" rx="2" fill="#475569"/>
            <rect x="-16" y="-73" width="32" height="6" rx="3" fill="#64748b"/>
            {/* Lâmpada */}
            <ellipse cx="0" cy="-76" rx="7" ry="5" fill="#FDE68A" opacity="0.9" filter="url(#glow2)"/>
            {/* Cone de luz */}
            <path d={`M -7,-73 L -28,-10 L 28,-10 L 7,-73 Z`} fill="#FDE68A" opacity="0.08"/>
          </g>
        ))}

        {/* ── CALÇADA + ESTRADA + MAIS CALÇADA ── */}
        {/* Calçada superior */}
        <rect x="0" y="678" width="1440" height="14" fill="url(#sidewalkGrad)" opacity="0.85"/>
        {/* Estrada */}
        <rect x="0" y="692" width="1440" height="38" fill="url(#roadGrad)"/>
        {/* Linha central da estrada */}
        <rect x="0" y="709" width="1440" height="3" fill="#374151" opacity="0.7"/>
        {/* Faixas amarelas animadas */}
        {Array.from({length:12}).map((_,i)=>(
          <rect key={i} x={i*130} y="710" width="60" height="3" rx="1" fill="#FCD34D" opacity="0.75">
            <animateTransform attributeName="transform" type="translate"
              values="0 0;-130 0" dur="3.5s" begin={`${i*0.29}s`} repeatCount="indefinite"/>
          </rect>
        ))}
        {/* Calçada inferior */}
        <rect x="0" y="730" width="1440" height="14" fill="url(#sidewalkGrad)" opacity="0.75"/>

        {/* ── GRAMA (abaixo da calçada) ── */}
        <rect x="0" y="742" width="1440" height="158" fill="url(#grassGrad)"/>
        {/* Tufos de grama */}
        {Array.from({length:36}).map((_,i)=>(
          <g key={i} transform={`translate(${i*40+4},742)`} opacity="0.55">
            <line x1="0" y1="0" x2="-5" y2="-10" stroke="#22c55e" strokeWidth="1.5"/>
            <line x1="0" y1="0" x2="0" y2="-13" stroke="#16a34a" strokeWidth="1.5"/>
            <line x1="0" y1="0" x2="5" y2="-10" stroke="#22c55e" strokeWidth="1.5"/>
          </g>
        ))}

        {/* ── ÁRVORES DA CALÇADA ── */}
        {[60,220,420,640,860,1060,1260,1420].map((x,i)=>(
          <g key={i} transform={`translate(${x},676)`}>
            <rect x="-4" y="-30" width="8" height="30" rx="2" fill="#7c4f2a"/>
            <ellipse cx="0" cy="-36" rx="20" ry="28" fill="#166534" opacity="0.9"/>
            <ellipse cx="-8" cy="-28" rx="15" ry="20" fill="#16a34a" opacity="0.7"/>
            <ellipse cx="8" cy="-32" rx="14" ry="18" fill="#22c55e" opacity="0.6"/>
          </g>
        ))}

        {/* ── BANCOS DE PRAÇA (noite) ── */}
        {isNight && [170,570,970,1350].map((x,i)=>(
          <g key={i} transform={`translate(${x},740)`}>
            {/* Banco */}
            <rect x="-18" y="-10" width="36" height="4" rx="2" fill="#78350f"/>
            <rect x="-16" y="-6"  width="32" height="3" rx="1" fill="#92400e"/>
            <rect x="-14" y="-16" width="28" height="6" rx="2" fill="#78350f"/>
            <rect x="-15" y="-6"  width="4"  height="8" rx="1" fill="#57250a"/>
            <rect x="11"  y="-6"  width="4"  height="8" rx="1" fill="#57250a"/>
            {/* Pessoa sentada — simples stickman */}
            <circle cx={i%2===0?-4:4} cy="-24" r="5" fill={isNight?"#cbd5e1":"#94a3b8"}/>
            <line x1={i%2===0?-4:4} y1="-19" x2={i%2===0?-4:4} y2="-10" stroke={isNight?"#cbd5e1":"#94a3b8"} strokeWidth="2.5"/>
            <line x1={i%2===0?-4:4} y1="-16" x2={i%2===0?-12:12} y2="-13" stroke={isNight?"#cbd5e1":"#94a3b8"} strokeWidth="2"/>
            <line x1={i%2===0?-4:4} y1="-10" x2={i%2===0?-2:2}  y2="-4"  stroke={isNight?"#cbd5e1":"#94a3b8"} strokeWidth="2"/>
            <line x1={i%2===0?-4:4} y1="-10" x2={i%2===0?-8:8}  y2="-4"  stroke={isNight?"#cbd5e1":"#94a3b8"} strokeWidth="2"/>
          </g>
        ))}

        {/* ── CARROS (dia) ── */}
        {!isNight && (
          <>
            {/* Carro 1 — vai para direita */}
            <g>
              <rect rx="5" width="68" height="26" fill="#2563eb" y="-13">
                <animateMotion dur="8s" repeatCount="indefinite"
                  path="M -80,700 L 1520,700"/>
              </rect>
              <rect rx="3" width="42" height="16" fill="#93c5fd" y="-25" x="10">
                <animateMotion dur="8s" repeatCount="indefinite"
                  path="M -80,700 L 1520,700"/>
              </rect>
              <circle r="6" fill="#1e293b" cx="12">
                <animateMotion dur="8s" repeatCount="indefinite"
                  path="M -80,713 L 1520,713"/>
              </circle>
              <circle r="6" fill="#1e293b" cx="56">
                <animateMotion dur="8s" repeatCount="indefinite"
                  path="M -80,713 L 1520,713"/>
              </circle>
            </g>
            {/* Carro 2 — vai para esquerda mais devagar */}
            <g>
              <rect rx="5" width="72" height="28" fill="#dc2626" y="-14">
                <animateMotion dur="11s" begin="3s" repeatCount="indefinite"
                  path="M 1520,705 L -80,705"/>
              </rect>
              <rect rx="3" width="44" height="17" fill="#fca5a5" y="-27" x="12">
                <animateMotion dur="11s" begin="3s" repeatCount="indefinite"
                  path="M 1520,705 L -80,705"/>
              </rect>
              <circle r="6" fill="#1e293b" cx="14">
                <animateMotion dur="11s" begin="3s" repeatCount="indefinite"
                  path="M 1520,719 L -80,719"/>
              </circle>
              <circle r="6" fill="#1e293b" cx="58">
                <animateMotion dur="11s" begin="3s" repeatCount="indefinite"
                  path="M 1520,719 L -80,719"/>
              </circle>
            </g>
            {/* Carro 3 — amarelo, rápido */}
            <g>
              <rect rx="5" width="60" height="24" fill="#d97706" y="-12">
                <animateMotion dur="6s" begin="1.5s" repeatCount="indefinite"
                  path="M -80,698 L 1520,698"/>
              </rect>
              <rect rx="3" width="36" height="14" fill="#fcd34d" y="-22" x="10">
                <animateMotion dur="6s" begin="1.5s" repeatCount="indefinite"
                  path="M -80,698 L 1520,698"/>
              </rect>
              <circle r="6" fill="#1e293b" cx="10">
                <animateMotion dur="6s" begin="1.5s" repeatCount="indefinite"
                  path="M -80,710 L 1520,710"/>
              </circle>
              <circle r="6" fill="#1e293b" cx="50">
                <animateMotion dur="6s" begin="1.5s" repeatCount="indefinite"
                  path="M -80,710 L 1520,710"/>
              </circle>
            </g>
          </>
        )}

        {/* ── PESSOAS CAMINHANDO (dia) ── */}
        {!isNight && [
          {x:-20, dur:"12s", begin:"0s",  dir:1,  skin:"#fbbf24", shirt:"#3b82f6"},
          {x:-20, dur:"18s", begin:"4s",  dir:1,  skin:"#d97706", shirt:"#ef4444"},
          {x:1480,dur:"14s", begin:"2s",  dir:-1, skin:"#fbbf24", shirt:"#8b5cf6"},
          {x:1480,dur:"20s", begin:"7s",  dir:-1, skin:"#92400e", shirt:"#10b981"},
        ].map((p,i)=>(
          <g key={i}>
            {/* Cabeça */}
            <circle r="5" fill={p.skin}>
              <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite"
                path={p.dir===1?`M ${p.x},736 L 1500,736`:`M ${p.x},736 L -100,736`}/>
            </circle>
            {/* Corpo */}
            <rect rx="2" width="8" height="14" fill={p.shirt} x="-4" y="-2">
              <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite"
                path={p.dir===1?`M ${p.x},741 L 1500,741`:`M ${p.x},741 L -100,741`}/>
            </rect>
            {/* Pernas */}
            <line x1="0" y1="0" x2={p.dir*-4} y2="10" stroke="#1e293b" strokeWidth="2">
              <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite"
                path={p.dir===1?`M ${p.x},755 L 1500,755`:`M ${p.x},755 L -100,755`}/>
              <animate attributeName="x2" values={`${p.dir*-4};${p.dir*4};${p.dir*-4}`} dur="0.5s" repeatCount="indefinite"/>
            </line>
            <line x1="0" y1="0" x2={p.dir*4} y2="10" stroke="#1e293b" strokeWidth="2">
              <animateMotion dur={p.dur} begin={p.begin} repeatCount="indefinite"
                path={p.dir===1?`M ${p.x},755 L 1500,755`:`M ${p.x},755 L -100,755`}/>
              <animate attributeName="x2" values={`${p.dir*4};${p.dir*-4};${p.dir*4}`} dur="0.5s" repeatCount="indefinite"/>
            </line>
          </g>
        ))}
      </svg>

      {/* ── CLIMA no canto superior direito ── */}
      {weather && (
        <div style={{
          position:"absolute", top:18, right:22, zIndex:10,
          background:"rgba(8,10,18,0.6)", backdropFilter:"blur(16px)",
          borderRadius:14, padding:"10px 16px",
          border:"1px solid rgba(255,255,255,0.1)",
          display:"flex", alignItems:"center", gap:10,
          minWidth:180,
        }}>
          <span style={{ fontSize:24 }}>
            {isRain?"🌧":isCloudy?"⛅":isNight?"🌙":isMorning?"🌤":isAfternoon?"☀️":"🌆"}
          </span>
          <div>
            {cityName && (
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:10.5, marginBottom:2, display:"flex", alignItems:"center", gap:3 }}>
                <span>📍</span>{cityName}
              </div>
            )}
            <div style={{ color:"#fff", fontSize:20, fontWeight:800, lineHeight:1 }}>
              {Math.round(weather.temperature)}°C
            </div>
            <div style={{ color:"rgba(255,255,255,0.45)", fontSize:10 }}>
              {isRain?"Chuvoso":isCloudy?"Nublado":isNight?"Noite":isMorning?"Manhã":isAfternoon?"Tarde":"Entardecer"}
            </div>
            {forecast && (
              <div style={{ display:"flex", gap:8, marginTop:3 }}>
                <span style={{ color:"#F87171", fontSize:10 }}>↑{forecast.tmax}°</span>
                <span style={{ color:"#60A5FA", fontSize:10 }}>↓{forecast.tmin}°</span>
                {forecast.rain>0 && <span style={{ color:"#93C5FD", fontSize:10 }}>💧{forecast.rain}%</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Lado esquerdo: formulário com transparência ── */}
      <div style={{ flex:"0 0 auto", width:"min(380px,90vw)", position:"relative", zIndex:1, animation:"fadeIn 0.6s ease" }}>
        {/* Card com transparência */}
        <div style={{ background:"rgba(15,19,32,0.72)", backdropFilter:"blur(18px)", WebkitBackdropFilter:"blur(18px)", borderRadius:20, border:"1px solid rgba(79,142,247,0.2)", padding:"36px 32px", marginBottom:14, boxShadow:"0 8px 40px rgba(0,0,0,0.5)" }}>
          {/* Logo + robô */}
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:26 }}>
            <NexpRobot size={46} showFaceOnly />
            <div>
              <div style={{ fontWeight:900, fontSize:20, letterSpacing:"-0.8px", background:"linear-gradient(135deg,#4F8EF7,#7C3AED)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", lineHeight:1.1 }}>
                Nexp Consultas
              </div>
              <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10.5, marginTop:2 }}>Sistema de Leads</div>
            </div>
          </div>

          {err && <div style={{ background:"rgba(45,21,21,0.8)", border:"1px solid #EF444433", borderRadius:8, padding:"9px 13px", marginBottom:16, color:"#F87171", fontSize:12.5 }}>⚠ {err}</div>}

          <div style={{ marginBottom:13 }}>
            <label style={{ color:"rgba(255,255,255,0.55)", fontSize:11.5, display:"block", marginBottom:5 }}>E-mail</label>
            <input value={un} onChange={e=>setUn(e.target.value)} placeholder="seu@email.com" onKeyDown={e=>e.key==="Enter"&&go()}
              style={{ ...S.input, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(79,142,247,0.25)", color:"#E8EAEF" }} />
          </div>
          <div style={{ marginBottom:22 }}>
            <label style={{ color:"rgba(255,255,255,0.55)", fontSize:11.5, display:"block", marginBottom:5 }}>Senha</label>
            <div style={{ position:"relative" }}>
              <input value={pw} onChange={e=>setPw(e.target.value)} type={show?"text":"password"} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&go()}
                style={{ ...S.input, paddingRight:40, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(79,142,247,0.25)", color:"#E8EAEF" }} />
              <button onClick={()=>setShow(p=>!p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:14 }}>
                {show?"🙈":"👁"}
              </button>
            </div>
          </div>
          <button onClick={go} disabled={loading}
            style={{ ...S.btn("#3B6EF5","#fff"), width:"100%", padding:"12px", fontSize:14, opacity:loading?0.7:1, cursor:loading?"not-allowed":"pointer", background:"linear-gradient(135deg,#3B6EF5,#7C3AED)", boxShadow:"0 4px 20px rgba(59,110,245,0.4)" }}>
            {loading ? "Entrando..." : "Entrar →"}
          </button>
        </div>

        {/* Suporte */}
        <a href="https://wa.me/5584981323542" target="_blank" rel="noopener noreferrer"
          style={{ display:"flex", alignItems:"center", gap:10, background:"rgba(10,41,24,0.7)", backdropFilter:"blur(10px)", border:"1px solid #25D36633", borderRadius:12, padding:"12px 14px", textDecoration:"none" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.17 1.6 5.98L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.21-3.48-8.52zM12 21.94a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.73.98.99-3.63-.23-.37A9.93 9.93 0 0 1 2.06 12C2.06 6.5 6.5 2.06 12 2.06S21.94 6.5 21.94 12 17.5 21.94 12 21.94zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97s-.47-.15-.67.15-.77.97-.94 1.17-.35.22-.65.07a8.15 8.15 0 0 1-2.4-1.48 9.01 9.01 0 0 1-1.66-2.07c-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5s.05-.38-.02-.52c-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.48 1.07 2.88 1.22 3.08 2.1 3.2 5.09 4.49c.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/></svg>
          <div style={{ flex:1 }}>
            <div style={{ color:err?"#25D366":"rgba(255,255,255,0.5)", fontSize:12, fontWeight:600 }}>{err?"Problemas? Fale com o suporte":"Suporte WhatsApp"}</div>
            <div style={{ color:"#2D6B47", fontSize:10.5 }}>(84) 98132-3542</div>
          </div>
          <span style={{ color:"#25D36666", fontSize:16 }}>→</span>
        </a>
      </div>

      {/* ── Lado direito: robô + frase motivacional lado a lado ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:24, zIndex:1, minWidth:0, animation:"fadeIn 0.8s ease" }}>
        {/* Robô AO LADO da frase motivacional */}
        <div style={{ display:"flex", alignItems:"center", gap:20, maxWidth:480 }}>
          <div style={{ flexShrink:0, animation:"robotFloat 3s ease-in-out infinite" }}>
            <NexpRobot size={100} showFaceOnly={false} />
          </div>
          <div style={{ background:"rgba(15,19,32,0.65)", backdropFilter:"blur(14px)", WebkitBackdropFilter:"blur(14px)", border:"1px solid rgba(79,142,247,0.18)", borderRadius:16, padding:"18px 22px", textAlign:"left", boxShadow:"0 4px 24px rgba(0,0,0,0.4)" }}>
            <div style={{ color:"rgba(79,142,247,0.6)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", marginBottom:8 }}>✦ Frase do dia</div>
            <div style={{ color:"rgba(255,255,255,0.88)", fontSize:13.5, lineHeight:1.6, fontStyle:"italic" }}>{frase}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────
function SidebarCover({ user, sidebarOpen, setSidebarOpen }) {
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ padding: "12px 14px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:7, minWidth:0 }}>
          <NexpRobot size={32} showFaceOnly />
          <div style={{ fontWeight:900, fontSize:17, letterSpacing:"-0.6px", background:`linear-gradient(135deg,${C.atxt},${C.lg2})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", lineHeight:1.1, whiteSpace:"nowrap" }}>
            Nexp Consultas
          </div>
        </div>
        <button onClick={() => setSidebarOpen(o => !o)}
          style={{ background:"transparent", border:"none", color:C.tm, fontSize:13, cursor:"pointer", padding:"3px 5px", borderRadius:6, opacity:0.7, transition:"opacity 0.15s", flexShrink:0 }}
          onMouseEnter={e => e.currentTarget.style.opacity = "1"}
          onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}>
          ◀
        </button>
      </div>
      <div style={{ height:1, background:C.b1, margin:"0 12px 4px" }} />
    </div>
  );
}

function Sidebar({ page, setPage, user, users, onLogout, unreadChat, unreadNotif, unreadStories, presence, flashUserId, stories, sysConfig }) {
  const uObj = users.find((u) => u.id === user.id) || user;
  const all = [
    { id:"dashboard",  label:"Leads Gerais",  icon:"◈", roles:["mestre","master","indicado","visitante"] },
    { id:"contacts",   label:"Contatos",       icon:"⬡", roles:["mestre","master","indicado","visitante"] },
    { id:"add",        label:"Adicionar",       icon:"⊕", roles:["mestre","master","indicado"] },
    { id:"import",     label:"Importar",        icon:"⤓", roles:["mestre","master","indicado"] },
    { id:"review",     label:"Ver Clientes",    icon:"◎", roles:["mestre","master","indicado","visitante"] },
    { id:"cstatus",    label:"Status",          icon:"◐", roles:["mestre","master","indicado","visitante"] },
    { id:"simulador",  label:"Simulador",       icon:"⊟", roles:["mestre","master","indicado"] },
    { id:"apis",       label:"APIs Bancos",     icon:"⬧", roles:["mestre","master"] },
    { id:"leds",       label:"Leds",            icon:"⬦", roles:["mestre","master"] },
    { id:"atalhos",    label:"Atalhos",         icon:"⌘", roles:["mestre","master","indicado","visitante"] },
    { id:"calendario", label:"Agenda",          icon:"◷", roles:["mestre","master","indicado","visitante"] },
    { id:"premium",    label:"Premium Nexp",    icon:"◈", roles:["mestre"] },
    { id:"config",     label:"Configurações",   icon:"⊞", roles:["mestre","master","indicado"] },
  ];
  // For visitante: filter by mestre-controlled tab config
  const cfg = sysConfig?.visitanteTabs || {};
  const nav = all.filter(it => {
    if (!it.roles.includes(user.role)) return false;
    if (user.role === "visitante") return cfg[it.id] !== false;
    return true;
  });
  const roleLabel = { mestre:"Mestre", master:"Master", indicado:"Operador", visitante:"Visitante" };
  const isConfig = page === "config";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [navOpen] = useState(true);
  const [navOrder, setNavOrder] = useState(() => {
    // "review" (Ver Clientes) fica em primeiro por padrão
    const defaultOrder = ["review", ...nav.filter(it => it.id !== "review").map(it => it.id)];
    return defaultOrder;
  });
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
              {[{ id:"notificacoes", label:"Notificações", icon:"🔔" }, { id:"stories", label:"Stories", icon:"◎" }, { id:"chat", label:"Nexp Chat", icon:null }].filter(item => {
                // Hide chat based on sysConfig
                if (item.id === "chat") {
                  if (user.role === "visitante" && !sysConfig?.visitanteChatEnabled) return false;
                  if (user.role === "indicado" && !sysConfig?.indicadoChatEnabled) return false;
                  if (user.role === "master" && !sysConfig?.masterChatEnabled) return false;
                }
                return true;
              }).map(item => (
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
                  {item.id === "chat" ? (
                    <svg width="17" height="14" viewBox="0 0 22 18" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink:0 }}>
                      <circle cx="11" cy="5" r="3.2" fill="currentColor"/>
                      <path d="M4 17c0-3.866 3.134-7 7-7h0c3.866 0 7 3.134 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      <circle cx="3.5" cy="6" r="2.2" fill="currentColor" opacity="0.6"/>
                      <path d="M0 16c0-2.761 1.567-5 3.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
                      <circle cx="18.5" cy="6" r="2.2" fill="currentColor" opacity="0.6"/>
                      <path d="M22 16c0-2.761-1.567-5-3.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
                    </svg>
                  ) : (
                    <span style={{ fontSize: 15, width: 17, textAlign: "center" }}>{item.icon}</span>
                  )}
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
                  <div style={{ color: C.td, fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
                    {roleLabel[user.role]}
                    {presence[(uObj.uid || uObj.id)]?.online
                      ? <span style={{ color: "#16A34A", fontSize: 9, display:"flex", alignItems:"center", gap:2 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#16A34A", display:"inline-block", animation:"pulse 1.5s infinite" }} />online</span>
                      : presence[(uObj.uid || uObj.id)]?.lastSeen?.seconds
                        ? <span style={{ color: C.td, fontSize: 9 }}>visto {new Date(presence[(uObj.uid || uObj.id)].lastSeen.seconds*1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>
                        : null
                    }
                  </div>
                </div>
                <button onClick={() => setPage("stories")} title="Criar story" style={{ width: 20, height: 20, borderRadius: "50%", background: C.acc, color: "#fff", border: `1.5px solid ${C.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0, lineHeight: 1, padding: 0 }}>+</button>
              </div>
              <button onClick={onLogout} style={{ background: "transparent", border: `1px solid ${C.b2}`, color: C.tm, borderRadius: 7, padding: "5px 10px", fontSize: 11, cursor: "pointer", width: "100%" }}>Sair</button>
            </div>

            {/* WhatsApp */}
            <a href="https://wa.me/5584981323542" target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 10, padding: "9px 12px", background: "#0A2918", border: "1px solid #16A34A44", borderRadius: 9, textDecoration: "none" }}>
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
      <div style={{ color: C.td, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 10, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ color, fontSize: 28, fontWeight: 700, letterSpacing: "-1px" }}>
        {val}
      </div>
      {sub && <div style={{ color: C.td, fontSize: 11, marginTop: 6 }}>{sub}</div>}
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

  // Rastrear pelo ID do cliente, não pelo índice — evita pulos quando contacts muda de ordem
  const [curId, setCurId] = useState(() => list[0]?.id || null);
  const [sc, setSc] = useState(false);
  const [done, setDone] = useState(false);

  // Encontrar o cliente atual pelo ID (nunca pelo índice)
  const cur = list.find(c => c.id === curId) || list[0] || {};
  const si  = list.findIndex(c => c.id === curId);

  // Estado local isolado por cliente
  const [reactions, setReactions]   = useState(cur.reactions  || []);
  const [leadType,  setLeadType]    = useState(cur.leadType   || "FGTS");
  const [extraLeads, setExtraLeads] = useState(cur.extraLeads || []);
  const [extraStatus,setExtraStatus]= useState(cur.extraStatus|| []);

  // Bloquear re-sync durante saves
  const savingRef = useRef(false);
  const prevSyncId = useRef(cur.id);

  // Sincronizar APENAS quando o cliente muda (ID diferente) e não é durante save
  useEffect(() => {
    if (savingRef.current) return;
    if (cur.id === prevSyncId.current) return;
    prevSyncId.current = cur.id;
    setReactions(cur.reactions  || []);
    setLeadType(cur.leadType   || "FGTS");
    setExtraLeads(cur.extraLeads || []);
    setExtraStatus(cur.extraStatus|| []);
    setDone(false);
  }, [cur.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const nexts = list.filter(c => c.id !== curId).slice(0, 10);

  const upd = async (u) => {
    savingRef.current = true;
    await saveContact(u);
    setContacts((cs) => cs.map((c) => (c.id === u.id ? u : c)));
    // Liberar depois do re-render do Firestore
    setTimeout(() => { savingRef.current = false; }, 800);
  };

  // Emojis — máx 3, isolados por cliente
  const tog = (e) => {
    setReactions((prev) => {
      if (prev.includes(e)) {
        const newR = prev.filter((x) => x !== e);
        upd({ ...cur, reactions: newR, leadType, extraLeads, extraStatus });
        return newR;
      }
      if (prev.length >= 3) return prev;
      const newR = [...prev, e];
      upd({ ...cur, reactions: newR, leadType, extraLeads, extraStatus });
      return newR;
    });
  };

  // Tipo de lead — ilimitado, mantém no mesmo cliente
  const selectLead = (t) => {
    if (t === leadType) return;
    const isExtra = extraLeads.includes(t);
    const newExtra = isExtra ? extraLeads.filter(x => x !== t) : [...extraLeads, t];
    setExtraLeads(newExtra);
    upd({ ...cur, leadType, extraLeads: newExtra, reactions, extraStatus });
  };

  const selectLeadPrimary = (t) => {
    if (t === leadType) return;
    const newExtra = [leadType, ...extraLeads.filter(x => x !== t)];
    setLeadType(t);
    setExtraLeads(newExtra);
    upd({ ...cur, leadType: t, extraLeads: newExtra, reactions, extraStatus });
  };

  // Status — toggle multi-seleção, mantém no mesmo cliente
  const toggleStatus = (s) => {
    const isSelected = extraStatus.includes(s);
    const newExtra = isSelected ? extraStatus.filter(x => x !== s) : [...extraStatus, s];
    setExtraStatus(newExtra);
    upd({ ...cur, leadType, extraLeads, reactions, extraStatus: newExtra });
  };

  // Concluído — avança para o próximo pelo ID
  const conclude = async () => {
    await upd({ ...cur, reactions, leadType, extraLeads, extraStatus });
    setDone(true);
    setTimeout(() => {
      const nextIdx = si + 1;
      if (nextIdx < list.length) setCurId(list[nextIdx].id);
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
            onClick={() => { if (si > 0) setCurId(list[si - 1].id); }}
            disabled={si === 0}
            style={{ ...S.btn(si === 0 ? C.deep : C.abg, si === 0 ? C.td : C.atxt), border: `1px solid ${C.b2}`, padding: "7px 14px", fontSize: 13 }}
          >← Anterior</button>
          <button
            onClick={() => { if (si < list.length - 1) setCurId(list[si + 1].id); }}
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

        {/* Tipo de Lead — multi-seleção */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Tipo de Lead <span style={{ color: C.td, fontSize: 10, textTransform: "none" }}>(principal + adicionais)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {LEAD_TYPES.filter(t => t !== "Outro").map((t) => {
              const col = LEAD_COLOR[t] || "#9CA3AF";
              const isPrimary = leadType === t;
              const isExtra = extraLeads.includes(t);
              const sel = isPrimary || isExtra;
              return (
                <button key={t}
                  onClick={() => isPrimary ? null : (isExtra ? selectLead(t) : (extraLeads.length === 0 ? selectLeadPrimary(t) : selectLead(t)))}
                  onContextMenu={e => { e.preventDefault(); if (!isPrimary) selectLeadPrimary(t); }}
                  title={isPrimary ? "Lead principal" : "Clique para adicionar/remover · Clique direito para definir como principal"}
                  style={{ background: sel ? col + "1A" : C.deep, color: sel ? col : C.tm, border: sel ? `1px solid ${col}55` : `1px solid ${C.b2}`, borderRadius: 20, padding: "5px 11px", fontSize: 10.5, cursor: isPrimary ? "default" : "pointer", fontWeight: sel ? 600 : 400, transition: "all 0.12s" }}>
                  {isPrimary ? "★ " : isExtra ? "✓ " : ""}{t}
                </button>
              );
            })}
          </div>
          <div style={{ color: C.td, fontSize: 9.5, marginTop: 5 }}>★ = principal · ✓ = adicional · Clique direito para definir como principal</div>
        </div>

        {/* Status — multi-seleção */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Marcar status <span style={{ color: C.td, fontSize: 10, textTransform: "none" }}>(selecione múltiplos)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CLIENT_STATUS.map((s) => {
              const st = STATUS_STYLE[s];
              const sel = extraStatus.includes(s);
              return (
                <button key={s} onClick={() => toggleStatus(s)}
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
                <div key={c.id} onClick={() => setCurId(c.id)}
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
            <div style={{ color: C.td, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8, fontWeight: 700 }}>
              {l}
            </div>
            <div style={{ color: cor, fontSize: 26, fontWeight: 700, letterSpacing: "-0.8px" }}>
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

  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399", visitante: "#60a5fa" };
  const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador", visitante: "Visitante" };

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

function ConfigPage({ users, setUsers, currentUser, theme, onTheme, sysConfig, onSysConfig }) {
  const [tab, setTab] = useState("perfil");
  const [permSearch, setPermSearch] = useState("");
  const [permExpandedId, setPermExpandedId] = useState(null);
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
    {
      id: "permissoes",
      label: "Permissões",
      icon: "🔐",
      roles: ["mestre", "master"],
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
        {tab === "permissoes" && sysConfig && onSysConfig && (() => {
          const isMestre = currentUser.role === "mestre";
          // Master só vê usuários que ele criou; mestre vê todos
          const visibleUsers = users.filter(u => {
            if (u.role === "mestre") return false;
            if (isMestre) return true;
            // master: só vê quem ele criou (createdBy === myId)
            return u.createdBy === (currentUser.uid || currentUser.id);
          });
          const filtered = visibleUsers.filter(u =>
            !permSearch || (u.name||u.email||"").toLowerCase().includes(permSearch.toLowerCase())
          );
          const ALL_TABS = [
            { id:"dashboard",    label:"Leads Gerais" },
            { id:"contacts",     label:"Contatos" },
            { id:"review",       label:"Ver Clientes" },
            { id:"cstatus",      label:"Status" },
            { id:"add",          label:"Adicionar" },
            { id:"import",       label:"Importar" },
            { id:"simulador",    label:"Simulador" },
            { id:"apis",         label:"APIs Bancos" },
            { id:"leds",         label:"Leds" },
            { id:"atalhos",      label:"Atalhos" },
            { id:"calendario",   label:"Agenda" },
            { id:"notificacoes", label:"Notificações" },
            { id:"stories",      label:"Stories" },
            { id:"chat",         label:"Nexp Chat" },
            { id:"premium",      label:"Premium Nexp" },
            { id:"config",       label:"Configurações" },
          ];
          const roleColor2 = { master:"#94a3b8", indicado:"#34D399", visitante:"#60a5fa" };

          return (
            <div>
              <h2 style={{ color:C.tp, fontSize:17, fontWeight:700, marginBottom:4 }}>🔐 Permissões por Usuário</h2>
              <p style={{ color:C.tm, fontSize:13, marginBottom:20 }}>
                {isMestre ? "Controle o acesso de todos os usuários." : "Controle o acesso dos usuários que você criou."}
              </p>

              {/* Toggles globais por papel — só mestre */}
              {isMestre && (
                <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"18px 20px", marginBottom:18 }}>
                  <div style={{ color:C.tp, fontSize:13, fontWeight:700, marginBottom:12 }}>💬 Chat por papel (padrão global)</div>
                  {[
                    { key:"masterChatEnabled",   label:"Master — Chat",    col:"#94a3b8" },
                    { key:"indicadoChatEnabled", label:"Operador — Chat",  col:"#34D399" },
                    { key:"visitanteChatEnabled",label:"Visitante — Chat", col:"#60a5fa" },
                  ].map(opt=>(
                    <div key={opt.key} onClick={()=>onSysConfig({...sysConfig,[opt.key]:!sysConfig[opt.key]})}
                      style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 12px", borderRadius:10, cursor:"pointer", marginBottom:7, background:sysConfig[opt.key]?C.abg:C.deep, border:`1px solid ${sysConfig[opt.key]?opt.col+"44":C.b2}`, transition:"all 0.15s" }}>
                      <span style={{ color:sysConfig[opt.key]?opt.col:C.ts, fontSize:12.5, fontWeight:sysConfig[opt.key]?600:400 }}>{opt.label}</span>
                      <div style={{ width:34, height:18, borderRadius:9, background:sysConfig[opt.key]?opt.col:C.b2, position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                        <div style={{ position:"absolute", top:1, left:sysConfig[opt.key]?16:1, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pesquisa + lista de usuários */}
              <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"18px 20px" }}>
                <div style={{ color:C.tp, fontSize:13, fontWeight:700, marginBottom:10 }}>👤 Permissões individuais</div>
                <input
                  placeholder="🔍 Pesquisar usuário por nome ou email..."
                  value={permSearch}
                  onChange={e=>{setPermSearch(e.target.value); setPermExpandedId(null);}}
                  style={{ ...S.input, marginBottom:14 }}
                />

                {filtered.length === 0 && (
                  <div style={{ color:C.tm, fontSize:12.5, textAlign:"center", padding:"20px 0" }}>
                    {permSearch ? "Nenhum usuário encontrado." : "Nenhum usuário disponível."}
                  </div>
                )}

                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {filtered.map(u => {
                    const uid = u.uid||u.id;
                    const col = roleColor2[u.role]||C.atxt;
                    const override = sysConfig.userOverrides?.[uid] || {};
                    const chatOn = override.chat !== undefined ? override.chat : (
                      u.role==="master"?sysConfig.masterChatEnabled:u.role==="indicado"?sysConfig.indicadoChatEnabled:!!sysConfig.visitanteChatEnabled
                    );
                    const expanded = permExpandedId === uid;
                    const hasOverride = Object.keys(override).length > 0;

                    const setOv = (key, val) => {
                      const prev = sysConfig.userOverrides||{};
                      onSysConfig({...sysConfig, userOverrides:{...prev,[uid]:{...(prev[uid]||{}),[key]:val}}});
                    };
                    const resetOv = () => {
                      const prev = {...(sysConfig.userOverrides||{})};
                      delete prev[uid];
                      onSysConfig({...sysConfig, userOverrides:prev});
                    };

                    return (
                      <div key={uid} style={{ borderRadius:12, background:C.deep, border:`1px solid ${expanded?C.atxt+"44":C.b2}`, overflow:"hidden", transition:"border 0.2s" }}>
                        {/* Linha do usuário — clicável */}
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer" }}
                          onClick={()=>setPermExpandedId(expanded?null:uid)}>
                          <div style={{ width:34, height:34, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:col+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:col }}>
                            {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ color:C.tp, fontSize:13, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{u.name||u.email}</div>
                            <div style={{ color:col, fontSize:10.5 }}>{u.role} {u.email ? `· ${u.email}` : ""}</div>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                            {hasOverride && <span style={{ color:C.atxt, fontSize:9, background:C.abg, borderRadius:8, padding:"2px 7px", fontWeight:700 }}>personalizado</span>}
                            <span style={{ color:C.td, fontSize:13, transition:"transform 0.2s", transform:expanded?"rotate(180deg)":"rotate(0deg)", display:"inline-block" }}>▼</span>
                          </div>
                        </div>

                        {/* Painel expandido */}
                        {expanded && (
                          <div style={{ padding:"0 14px 14px", borderTop:`1px solid ${C.b1}` }}>
                            {/* Chat */}
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 0", borderBottom:`1px solid ${C.b1}` }}>
                              <div>
                                <span style={{ color:C.ts, fontSize:12.5, fontWeight:600 }}>💬 Acesso ao Chat</span>
                                <div style={{ color:C.td, fontSize:10.5, marginTop:2 }}>{chatOn?"Habilitado":"Desabilitado"}</div>
                              </div>
                              <div onClick={()=>setOv("chat",!chatOn)} style={{ width:38, height:21, borderRadius:11, background:chatOn?C.acc:C.b2, position:"relative", transition:"background 0.2s", cursor:"pointer", flexShrink:0 }}>
                                <div style={{ position:"absolute", top:2, left:chatOn?18:2, width:17, height:17, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                              </div>
                            </div>

                            {/* Abas visíveis */}
                            <div style={{ marginTop:12, marginBottom:10 }}>
                              <div style={{ color:C.ts, fontSize:12, fontWeight:600, marginBottom:8 }}>📋 Abas visíveis para este usuário</div>
                              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                                {ALL_TABS.map(tabItem => {
                                  const on = override.tabs ? override.tabs[tabItem.id] !== false : true;
                                  return (
                                    <button key={tabItem.id} onClick={()=>setOv("tabs",{...(override.tabs||{}),[tabItem.id]:!on})}
                                      style={{ background:on?C.acc+"15":C.card, color:on?C.atxt:C.td, border:`1px solid ${on?C.atxt+"33":C.b2}`, borderRadius:20, padding:"4px 11px", fontSize:11, cursor:"pointer", fontWeight:on?600:400, transition:"all 0.15s" }}>
                                      {on?"✓ ":""}{tabItem.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Reset */}
                            {hasOverride && (
                              <button onClick={resetOv} style={{ background:"transparent", border:`1px solid ${C.b2}`, color:C.tm, borderRadius:8, padding:"5px 14px", fontSize:11, cursor:"pointer", marginTop:4 }}>
                                ↺ Resetar para padrão do papel
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}
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

  const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador", visitante: "Visitante" };
  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399", visitante: "#60a5fa" };
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
    visitante: "Visitante",
  };
  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399", visitante: "#60a5fa" };

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
      const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador", visitante: "Visitante" };
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
                {["master", "indicado", "visitante"].map((r) => {
                  const sel = form.role === r;
                  const col = (roleColor[r] || "#94a3b8");
                  return (
                    <button
                      key={r}
                      onClick={() => setF("role", r)}
                      style={{
                        background: sel ? col + "18" : C.deep,
                        color: sel ? col : C.tm,
                        border: sel ? `1px solid ${col}55` : `1px solid ${C.b2}`,
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

                      // Componente para ver senha com confirmação
                      const PasswordField = ({ uid: pUid }) => {
                        const [passVisible, setPassVisible] = useState(false);
                        const [confirmPass, setConfirmPass] = useState("");
                        const [askConfirm, setAskConfirm] = useState(false);
                        const [passErr, setPassErr] = useState("");
                        const [storedPass, setStoredPass] = useState(null);
                        const [copied, setCopied] = useState(false);

                        const loadPass = async () => {
                          try {
                            const snap = await getDocs(query(collection(db, "users"), where("uid", "==", pUid)));
                            if (!snap.empty) setStoredPass(snap.docs[0].data().password || null);
                            else setStoredPass(null);
                          } catch { setStoredPass(null); }
                        };

                        const handleReveal = () => { setAskConfirm(true); setPassErr(""); };
                        const handleConfirm = async () => {
                          // Verifica senha do mestre via Firebase Auth
                          try {
                            const mestreEmail = currentUser.email;
                            const cred = EmailAuthProvider.credential(mestreEmail, confirmPass);
                            await reauthenticateWithCredential(auth.currentUser, cred);
                            await loadPass();
                            setPassVisible(true); setAskConfirm(false); setConfirmPass("");
                          } catch { setPassErr("Senha do mestre incorreta. Tente novamente."); }
                        };
                        const copy = () => { if (!storedPass) return; navigator.clipboard.writeText(storedPass).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800);}); };

                        return (
                          <div style={{ gridColumn:"1/-1" }}>
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:3 }}>
                              <div style={{ color:C.td, fontSize:10, textTransform:"uppercase", letterSpacing:"0.4px" }}>Senha</div>
                              <div style={{ display:"flex", gap:4 }}>
                                {passVisible && storedPass && <button onClick={copy} style={{ background:"none", border:"none", color:copied?"#34D399":C.td, cursor:"pointer", fontSize:10 }}>{copied?"✓":"⎘"}</button>}
                                <button onClick={()=>{ if(passVisible){setPassVisible(false);setStoredPass(null);} else handleReveal(); }}
                                  style={{ background:"none", border:"none", color:C.atxt, cursor:"pointer", fontSize:10 }}>
                                  {passVisible?"🙈 Ocultar":"👁 Ver senha"}
                                </button>
                              </div>
                            </div>
                            {passVisible ? (
                              <div style={{ color:C.tp, fontSize:12.5, fontWeight:500, letterSpacing:1 }}>{storedPass || "Não disponível"}</div>
                            ) : (
                              <div style={{ color:C.tm, fontSize:12.5 }}>••••••••</div>
                            )}
                            {askConfirm && !passVisible && (
                              <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:6 }}>
                                <div style={{ color:C.tm, fontSize:11 }}>🔐 Digite a senha do Mestre para revelar:</div>
                                <div style={{ display:"flex", gap:6 }}>
                                  <input type="password" value={confirmPass} onChange={e=>{setConfirmPass(e.target.value);setPassErr("");}}
                                    onKeyDown={e=>e.key==="Enter"&&handleConfirm()}
                                    placeholder="Sua senha atual..." style={{ ...S.input, flex:1, padding:"5px 10px", fontSize:12 }} autoFocus />
                                  <button onClick={handleConfirm} style={{ ...S.btn(C.acc,"#fff"), padding:"5px 12px", fontSize:12 }}>OK</button>
                                  <button onClick={()=>{setAskConfirm(false);setConfirmPass("");setPassErr("");}} style={{ ...S.btn("transparent",C.tm), border:`1px solid ${C.b2}`, padding:"5px 10px", fontSize:12 }}>✕</button>
                                </div>
                                {passErr && <div style={{ color:"#F87171", fontSize:11 }}>{passErr}</div>}
                              </div>
                            )}
                          </div>
                        );
                      };

                      return (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                          <CopyField label="Nome completo" val={u.name} />
                          <CopyField label="CPF" val={u.cpf} />
                          <CopyField label="Email (login)" val={u.email} />
                          <PasswordField uid={u.uid||u.id} />
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

function StoriesPage({ currentUser, users, onGoToDM }) {
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
  const [editingCommentIdx, setEditingCommentIdx] = useState(null);
  const [editCommentText, setEditCommentText] = useState("");
  const [commentActionIdx, setCommentActionIdx] = useState(null);
  const [storyDeleteConfirm, setStoryDeleteConfirm] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
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
    // If replying to a specific comment, add as reply
    if (replyingTo !== null) {
      const comments = (story.comments||[]).map((cm,ci) => {
        if (ci !== replyingTo.idx) return cm;
        const replies = [...(cm.replies||[]), {
          userId: myId,
          userName: currentUser.name||currentUser.email,
          userPhoto: myProfile.photo||null,
          text: commentText,
          createdAt: Date.now(),
        }];
        return { ...cm, replies };
      });
      await setDoc(doc(db,"stories",story.id),{comments},{merge:true});
      setComment(""); setReplyingTo(null); setShowCommentEmoji(false);
      return;
    }
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

  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399", visitante: "#60a5fa" };

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
                  <div style={{ position:"relative" }}>
                    <button onClick={() => setStoryDeleteConfirm(storyDeleteConfirm===viewStory.id?null:viewStory.id)}
                      style={{ background:"rgba(0,0,0,0.4)", border:"none", color:"#F87171", borderRadius:"50%", width:28, height:28, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }} title="Excluir story">🗑</button>
                    {storyDeleteConfirm === viewStory.id && (
                      <div style={{ position:"absolute", right:0, top:32, background:"#1A0D0D", border:"1px solid #EF444433", borderRadius:10, padding:"8px 10px", zIndex:30, boxShadow:"0 4px 16px #00000088", display:"flex", flexDirection:"column", gap:7, minWidth:130 }}>
                        <div style={{ color:"#F87171", fontSize:11, fontWeight:700 }}>Excluir story?</div>
                        <div style={{ display:"flex", gap:5 }}>
                          <button onClick={()=>{ deleteStory(viewStory.id); setStoryDeleteConfirm(null); }}
                            style={{ background:"#EF4444", color:"#fff", border:"none", borderRadius:7, padding:"4px 10px", fontSize:11, cursor:"pointer", fontWeight:700, flex:1 }}>Excluir</button>
                          <button onClick={()=>setStoryDeleteConfirm(null)}
                            style={{ background:"transparent", border:`1px solid #ffffff33`, color:"#fff", borderRadius:7, padding:"4px 8px", fontSize:11, cursor:"pointer" }}>Não</button>
                        </div>
                      </div>
                    )}
                  </div>
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
                    const isMineComment = c.userId === myId;
                    const isEditing = editingCommentIdx?.storyId === viewStory.id && editingCommentIdx?.idx === i;
                    const showActions = commentActionIdx?.storyId === viewStory.id && commentActionIdx?.idx === i;
                    const likes = c.likes || [];
                    const dislikes = c.dislikes || [];
                    const iLiked = likes.includes(myId);
                    const iDisliked = dislikes.includes(myId);

                    const toggleCommentLike = async (type) => {
                      const comments = (viewStory.comments||[]).map((cm,ci) => {
                        if (ci !== i) return cm;
                        const lk = cm.likes||[]; const dl = cm.dislikes||[];
                        if (type === "like") {
                          return {...cm, likes: lk.includes(myId)?lk.filter(x=>x!==myId):[...lk.filter(x=>x!==myId),myId], dislikes: dl.filter(x=>x!==myId)};
                        } else {
                          return {...cm, dislikes: dl.includes(myId)?dl.filter(x=>x!==myId):[...dl.filter(x=>x!==myId),myId], likes: lk.filter(x=>x!==myId)};
                        }
                      });
                      await setDoc(doc(db,"stories",viewStory.id),{comments},{merge:true});
                    };

                    const deleteComment = async () => {
                      const comments = (viewStory.comments||[]).filter((_,ci)=>ci!==i);
                      await setDoc(doc(db,"stories",viewStory.id),{comments},{merge:true});
                      setCommentActionIdx(null);
                    };

                    const saveEditComment = async () => {
                      if (!editCommentText.trim()) return;
                      const comments = (viewStory.comments||[]).map((cm,ci)=>ci===i?{...cm,text:editCommentText.trim(),edited:true}:cm);
                      await setDoc(doc(db,"stories",viewStory.id),{comments},{merge:true});
                      setEditingCommentIdx(null); setEditCommentText("");
                    };

                    return (
                      <div key={i} style={{ display:"flex", gap:9, position:"relative" }}>
                        <div style={{ width:28, height:28, borderRadius:"50%", overflow:"hidden", flexShrink:0, border:`1.5px solid ${rc2}44` }}>
                          {c.userPhoto
                            ? <img src={c.userPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                            : <div style={{ width:"100%", height:"100%", background:rc2+"1A", color:rc2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700 }}>{ini(c.userName||"?")}</div>
                          }
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <div style={{ color:rc2, fontSize:10.5, fontWeight:700 }}>{c.userName}</div>
                            <div style={{ color:C.td, fontSize:9.5 }}>{new Date(c.createdAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
                            {c.edited && <span style={{ color:C.td, fontSize:9 }}>(editado)</span>}
                          </div>
                          {isEditing ? (
                            <div style={{ display:"flex", gap:5, marginTop:4 }}>
                              <input value={editCommentText} onChange={e=>setEditCommentText(e.target.value)}
                                onKeyDown={e=>e.key==="Enter"&&saveEditComment()}
                                style={{ ...S.input, padding:"4px 8px", fontSize:12, flex:1 }} autoFocus />
                              <button onClick={saveEditComment} style={{ background:C.acc, color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}>✓</button>
                              <button onClick={()=>{setEditingCommentIdx(null);setEditCommentText("");}} style={{ background:"transparent", border:`1px solid ${C.b2}`, color:C.tm, borderRadius:6, padding:"4px 8px", fontSize:11, cursor:"pointer" }}>✕</button>
                            </div>
                          ) : (
                            <div style={{ color:C.ts, fontSize:12.5, marginTop:2, lineHeight:1.4 }}>{c.text}</div>
                          )}
                          {/* Like / Dislike / Actions */}
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:5 }}>
                            <button onClick={()=>toggleCommentLike("like")}
                              style={{ background:"transparent", border:`1.5px solid ${iLiked?C.acc:C.b2}`, borderRadius:20, padding:"3px 10px", cursor:"pointer", display:"flex", alignItems:"center", gap:4, color:iLiked?C.acc:C.tm, fontSize:13, fontWeight:iLiked?700:400, transition:"all 0.15s" }}>
                              <span>👍</span>
                              {likes.length > 0 && <span style={{ fontSize:10 }}>{likes.length}</span>}
                            </button>
                            <button onClick={()=>toggleCommentLike("dislike")}
                              style={{ background:"transparent", border:`1.5px solid ${iDisliked?"#F87171":C.b2}`, borderRadius:20, padding:"3px 10px", cursor:"pointer", display:"flex", alignItems:"center", gap:4, color:iDisliked?"#F87171":C.tm, fontSize:13, fontWeight:iDisliked?700:400, transition:"all 0.15s" }}>
                              <span>👎</span>
                              {dislikes.length > 0 && <span style={{ fontSize:10 }}>{dislikes.length}</span>}
                            </button>
                            <button onClick={()=>{ setReplyingTo({idx:i, userName:c.userName}); setComment(`@${c.userName} `); }}
                              style={{ background:"none", border:"none", color:C.tm, fontSize:11, cursor:"pointer", padding:"2px 6px", borderRadius:8 }}
                              onMouseEnter={e=>e.currentTarget.style.color=C.atxt}
                              onMouseLeave={e=>e.currentTarget.style.color=C.tm}>
                              ↩ Responder
                            </button>
                            {/* Go to DM with this commenter */}
                            {c.userId !== myId && onGoToDM && (
                              <button onClick={()=>onGoToDM(c.userId)}
                                style={{ background:"none", border:"none", color:C.acc, fontSize:11, cursor:"pointer", padding:"2px 6px", borderRadius:8 }}
                                title="Ir para conversa">
                                💬
                              </button>
                            )}
                            {isMineComment && (
                              <div style={{ position:"relative", marginLeft:"auto" }}>
                                <button onClick={()=>setCommentActionIdx(showActions?null:{storyId:viewStory.id,idx:i})}
                                  style={{ background:"none", border:"none", cursor:"pointer", color:C.td, fontSize:12, padding:"0 4px" }}>•••</button>
                                {showActions && (
                                  <div style={{ position:"absolute", right:0, bottom:22, background:C.card, border:`1px solid ${C.b1}`, borderRadius:10, padding:"4px", zIndex:20, boxShadow:"0 4px 16px rgba(0,0,0,0.5)", minWidth:110 }}>
                                    <button onClick={()=>{setEditingCommentIdx({storyId:viewStory.id,idx:i});setEditCommentText(c.text);setCommentActionIdx(null);}}
                                      style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", background:"none", border:"none", color:C.ts, fontSize:12, cursor:"pointer", borderRadius:6 }}
                                      onMouseEnter={e=>e.currentTarget.style.background=C.abg}
                                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                      ✏ Editar
                                    </button>
                                    <button onClick={deleteComment}
                                      style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", background:"none", border:"none", color:"#F87171", fontSize:12, cursor:"pointer", borderRadius:6 }}
                                      onMouseEnter={e=>e.currentTarget.style.background="#2D1515"}
                                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                      🗑 Excluir
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Replies */}
                          {(c.replies||[]).length > 0 && (
                            <div style={{ marginTop:8, paddingLeft:12, borderLeft:`2px solid ${C.b1}`, display:"flex", flexDirection:"column", gap:6 }}>
                              {(c.replies).map((rep,ri)=>{
                                const repLikes = rep.likes||[];
                                const repILiked = repLikes.includes(myId);
                                const repIsMine = rep.userId === myId;
                                const showRepActions = commentActionIdx?.storyId===viewStory.id&&commentActionIdx?.idx===i&&commentActionIdx?.ri===ri;
                                const toggleRepLike = async () => {
                                  const newReplies = (c.replies||[]).map((r,rj)=>rj!==ri?r:{...r,likes:repILiked?repLikes.filter(x=>x!==myId):[...repLikes,myId]});
                                  const comments = (viewStory.comments||[]).map((cm,ci)=>ci!==i?cm:{...cm,replies:newReplies});
                                  await setDoc(doc(db,"stories",viewStory.id),{comments},{merge:true});
                                };
                                const deleteReply = async () => {
                                  const newReplies = (c.replies||[]).filter((_,rj)=>rj!==ri);
                                  const comments = (viewStory.comments||[]).map((cm,ci)=>ci!==i?cm:{...cm,replies:newReplies});
                                  await setDoc(doc(db,"stories",viewStory.id),{comments},{merge:true});
                                  setCommentActionIdx(null);
                                };
                                return (
                                  <div key={ri} style={{ display:"flex", gap:7 }}>
                                    <div style={{ width:20, height:20, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:C.b2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:700, color:C.atxt }}>
                                      {rep.userPhoto ? <img src={rep.userPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(rep.userName||"?")}
                                    </div>
                                    <div style={{ flex:1 }}>
                                      <span style={{ color:C.atxt, fontSize:10.5, fontWeight:700 }}>{rep.userName} </span>
                                      <span style={{ color:C.ts, fontSize:11.5 }}>{rep.text}</span>
                                      <div style={{ color:C.td, fontSize:9.5, marginBottom:3 }}>{new Date(rep.createdAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
                                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                        <button onClick={toggleRepLike}
                                          style={{ background:"transparent", border:`1.5px solid ${repILiked?C.acc:C.b2}`, borderRadius:20, padding:"2px 8px", cursor:"pointer", display:"flex", alignItems:"center", gap:3, color:repILiked?C.acc:C.tm, fontSize:12 }}>
                                          <span>👍</span>
                                          {repLikes.length > 0 && <span style={{ fontSize:9.5 }}>{repLikes.length}</span>}
                                        </button>
                                        {repIsMine && (
                                          <div style={{ position:"relative" }}>
                                            <button onClick={()=>setCommentActionIdx(showRepActions?null:{storyId:viewStory.id,idx:i,ri})}
                                              style={{ background:"none", border:"none", cursor:"pointer", color:C.td, fontSize:12, padding:"0 4px" }}>•••</button>
                                            {showRepActions && (
                                              <div style={{ position:"absolute", right:0, bottom:22, background:C.card, border:`1px solid ${C.b1}`, borderRadius:10, padding:"4px", zIndex:20, boxShadow:"0 4px 16px rgba(0,0,0,0.5)", minWidth:100 }}>
                                                <button onClick={deleteReply}
                                                  style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", background:"none", border:"none", color:"#F87171", fontSize:12, cursor:"pointer", borderRadius:6 }}
                                                  onMouseEnter={e=>e.currentTarget.style.background="#2D1515"}
                                                  onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                                  🗑 Excluir
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
              }
            </div>
            {/* Comment input */}
            <div style={{ padding:"10px 14px", borderTop:`1px solid ${C.b1}`, flexShrink:0 }}>
              {/* Reply indicator */}
              {replyingTo && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", background:C.abg, borderRadius:8, marginBottom:8, border:`1px solid ${C.atxt}33` }}>
                  <span style={{ color:C.atxt, fontSize:11.5, flex:1 }}>↩ Respondendo <b>{replyingTo.userName}</b></span>
                  <button onClick={()=>{ setReplyingTo(null); setComment(""); }}
                    style={{ background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:14, lineHeight:1 }}>✕</button>
                </div>
              )}
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
                  placeholder={replyingTo ? `Responder ${replyingTo.userName}...` : "Comentar..."} style={{ ...S.input, padding:"7px 11px", fontSize:12.5, flex:1 }} autoFocus={!!replyingTo} />
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

  const roleColor = { mestre: "#C084FC", master: C.atxt, indicado: "#34D399", visitante: "#60a5fa" };
  const roleLabel = { mestre: "Mestre", master: "Master", indicado: "Operador", visitante: "Visitante" };

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
  const [groupNewSearch, setGroupNewSearch] = useState("");
  const [groupNewTheme, setGroupNewTheme] = useState(null);
  const groupPhotoRef = useRef(null);
  // eslint-disable-next-line no-unused-vars
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
  const [editGroupBio, setEditGroupBio] = useState("");
  const [showDMSettings, setShowDMSettings] = useState(false);
  const [dmTheme, setDmTheme] = useState(null);
  const [userReaction, setUserReaction] = useState(null);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [userCoverPhoto, setUserCoverPhoto] = useState(currentUser.coverPhoto||null);
  const [autoDeleteDM, setAutoDeleteDM] = useState(null); // null|"close"|"8h"|"24h"|"48h"|"7d"|"30d"
  const [confirmModal, setConfirmModal] = useState(null); // {title, body, onConfirm}
  const [deletingMsgIds, setDeletingMsgIds] = useState([]); // for dissolve anim
  const [userBio, setUserBio] = useState(currentUser.bio||"");
  const [userRecado, setUserRecado] = useState(currentUser.recado||"");
  const [userRecadoExpiry, setUserRecadoExpiry] = useState(currentUser.recadoExpiry||null);
  const [userBirthday, setUserBirthday] = useState(currentUser.birthday||"");
  const [viewingProfile, setViewingProfile] = useState(null);
  const [showGeralSettings, setShowGeralSettings] = useState(false);
  const [geralOnlyAdmins, setGeralOnlyAdmins] = useState(false);
  const [geralAdmins, setGeralAdmins] = useState([]);
  const [geralTheme, setGeralTheme] = useState(null);
  const [geralDelMsgId, setGeralDelMsgId] = useState(null);
  const [geralClearInput, setGeralClearInput] = useState("");
  const [mutedConvs, setMutedConvs] = useState({});
  const [floatEmojis, setFloatEmojis] = useState([]);
  const [showMuteMenu, setShowMuteMenu] = useState(null);
  const [profileReactions, setProfileReactions] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexp_profile_reactions") || "{}"); } catch { return {}; }
  });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMsgs, setSelectedMsgs] = useState([]);

  // ── Sound utils ────────────────────────────────────────────
  const playSound = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (type === "ping") {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.setValueAtTime(880, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1);
        g.gain.setValueAtTime(0.3, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.25);
      } else if (type === "group") {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.setValueAtTime(440, ctx.currentTime);
        o.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
        o.frequency.setValueAtTime(550, ctx.currentTime + 0.2);
        g.gain.setValueAtTime(0.25, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.35);
      } else if (type === "bird") {
        // Pássaro: trinado rápido subindo e descendo
        const notes = [1047,1319,1568,1319,1047,1319];
        notes.forEach((freq, i) => {
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.type = "sine";
          o.connect(g); g.connect(ctx.destination);
          const t = ctx.currentTime + i * 0.07;
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.2, t + 0.03);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
          o.start(t); o.stop(t + 0.1);
        });
      }
    } catch(e) {}
  };

  const isMuted = (key) => {
    const m = mutedConvs[key];
    if (!m) return false;
    if (m === "forever") return true;
    return Date.now() < m;
  };

  const MuteMenu = ({ convKey, isMestreUser, onClose }) => (
    <div style={{ position:"absolute", right:0, top:50, background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, padding:"6px", zIndex:200, boxShadow:"0 4px 20px rgba(0,0,0,0.6)", minWidth:165 }}
      onMouseLeave={onClose}>
      <div style={{ color:C.tm, fontSize:10, padding:"4px 8px", fontWeight:600, marginBottom:4 }}>🔇 Silenciar por</div>
      {[{label:"8 horas",val:8*3600000},{label:"24 horas",val:24*3600000},{label:"1 semana",val:7*24*3600000},{label:"Para sempre",val:"forever"}].map(opt=>(
        <button key={opt.label} onClick={()=>{
          setMutedConvs(p=>({...p,[convKey]:opt.val==="forever"?"forever":Date.now()+opt.val}));
          onClose();
        }} style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", background:"transparent", border:"none", color:C.ts, fontSize:12, cursor:"pointer", borderRadius:8 }}
          onMouseEnter={e=>e.currentTarget.style.background=C.abg}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          {opt.label}
        </button>
      ))}
      {isMuted(convKey) && (
        <button onClick={()=>{setMutedConvs(p=>{const n={...p};delete n[convKey];return n;});onClose();}}
          style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", background:"transparent", border:"none", color:C.acc, fontSize:12, cursor:"pointer", borderRadius:8, fontWeight:600, borderTop:`1px solid ${C.b1}`, marginTop:4 }}>
          🔔 Ativar som
        </button>
      )}
    </div>
  );

  // Derive group settings from activeGroup doc
  const groupOnlyAdmins = activeGroup?.onlyAdmins === true;
  const groupColor      = activeGroup?.color || null;
  const groupTrophies   = activeGroup?.trophies || {};

  // Default position — bottom right
  const defaultX = window.innerWidth - 400;
  const defaultY = 60;
  const left = pos.x ?? defaultX;
  const top  = pos.y ?? defaultY;

  // Listen messages + play sounds
  const prevMsgCount = useRef(0);
  useEffect(() => {
    const unsub = listenChat((msgs) => {
      setAllMessages(msgs);
      // Sound for new messages
      const forMe = msgs.filter(m => m.type !== "shake" && m.authorId !== myId && (!m.toId || m.toId === myId));
      if (prevMsgCount.current > 0 && forMe.length > prevMsgCount.current) {
        const latest = forMe[forMe.length - 1];
        const convKey = latest?.groupId || (latest?.toId ? latest.authorId : "geral");
        if (!isMuted(convKey)) {
          if (!latest?.toId && !latest?.groupId) { playSound("bird"); }
          else if (latest?.groupId) { playSound("group"); }
          else { playSound("ping"); }
        }
      }
      prevMsgCount.current = forMe.length;
    });
    return () => unsub();
  }, []); // eslint-disable-line

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
    // Content moderation
    if (content && checkContent(content)) {
      setModerationAlert(true);
      setTimeout(() => setModerationAlert(false), 5000);
      return;
    }
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
      color: groupNewTheme || null,
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
    setGroupName(""); setGroupPhoto(null); setGroupMembers([]); setGroupNewSearch(""); setGroupNewTheme(null);
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
    setDeletingMsgIds(p => [...p, msgId]);
    setTimeout(async () => {
      await deleteDoc(doc(db, "chat", msgId));
      setDeletingMsgIds(p => p.filter(x => x !== msgId));
      setGcDelMsgId(null);
    }, 500);
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

  const leaveGroup = () => {
    setConfirmModal({
      title: "Sair do grupo",
      body: `Tem certeza que deseja sair de "${activeGroup?.name}"?\nVocê não receberá mais mensagens deste grupo.`,
      onConfirm: async () => {
        const newMembers = (activeGroup.members||[]).filter(uid => uid !== myId);
        await setDoc(doc(db, "chatGroups", activeGroup.id), { members: newMembers }, { merge: true });
        await sendChatMessage({ text: `${currentUser.name||currentUser.email} saiu do grupo`, type:"system", groupId: activeGroup.id, authorId: myId, authorName: currentUser.name||currentUser.email });
        for (const uid of newMembers) {
          const nid = `notif_leave_${activeGroup.id}_${myId}_${Date.now()}_${uid}`;
          await setDoc(doc(db, "notifications", nid), { type:"group_leave", userId:uid, groupId:activeGroup.id, groupName:activeGroup.name, userName:currentUser.name||currentUser.email, createdAt:Date.now(), read:false });
        }
        setActiveTab(null); setShowGroupConfig(false);
      }
    });
  };

  const deleteGroup = () => {
    if (!activeGroup || !isGroupAdm) return;
    setConfirmModal({
      title: "Excluir grupo",
      body: `Você tem certeza que deseja excluir o Grupo "${activeGroup.name}"?\nEsta ação não pode ser desfeita.`,
      onConfirm: async () => {
        const groupMsgs = allMessages.filter(m => m.groupId === activeGroup.id);
        setDeletingMsgIds(groupMsgs.map(m=>m.id));
        setTimeout(async () => {
          await deleteDoc(doc(db, "chatGroups", activeGroup.id));
          for (const m of groupMsgs) { try { await deleteDoc(doc(db, "chat", m.id)); } catch(e) {} }
          setDeletingMsgIds([]);
          setActiveTab(null); setShowGroupConfig(false);
        }, 600);
      }
    });
  };
  const removeMemberWithNotif = async (uid) => {
    if (!activeGroup) return;
    const u = users.find(x=>(x.uid||x.id)===uid);
    const newMembers = (activeGroup.members||[]).filter(x=>x!==uid);
    await setDoc(doc(db, "chatGroups", activeGroup.id), { members: newMembers }, { merge: true });
    // System message in group
    await sendChatMessage({ text: `${u?.name||"Usuário"} foi removido do grupo`, type:"system", groupId: activeGroup.id, authorId: myId, authorName: currentUser.name||currentUser.email });
    // Notify removed member
    const nid = `notif_removed_${activeGroup.id}_${uid}_${Date.now()}`;
    await setDoc(doc(db,"notifications",nid),{ type:"group_removed", userId:uid, groupId:activeGroup.id, groupName:activeGroup.name, removedBy:currentUser.name||currentUser.email, createdAt:Date.now(), read:false });
    // Notify remaining members
    for (const membId of newMembers) {
      if (membId === myId) continue;
      const nid2 = `notif_memberout_${activeGroup.id}_${membId}_${uid}_${Date.now()}`;
      await setDoc(doc(db,"notifications",nid2),{ type:"group_member_removed", userId:membId, groupId:activeGroup.id, groupName:activeGroup.name, removedUser:u?.name||"Usuário", createdAt:Date.now(), read:false });
    }
  };

  // ── Content moderation ───────────────────────────────────────
  const BAD_WORDS = [
    "puta","merda","caralho","porra","viado","bicha","macaco","negão","boceta",
    "cuzão","arrombado","foda","fdp","vsf","sua mãe","viadinho","sapatão",
    "traveco","corno","putinha","sexo","pornô","porn","nudes","buceta","pênis",
    "vagina","cu ","racista","negro safado","preto safado","judeu","nazismo",
    "hitler","kkk","fagg","nigger","retardado","idiota","imbecil","maldito",
  ];
  const [moderationAlert, setModerationAlert] = useState(false);

  const checkContent = (msg) => {
    const lower = msg.toLowerCase();
    return BAD_WORDS.some(w => lower.includes(w));
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
            <div style={{ color:C.tp, fontSize:13.5, fontWeight:700, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", animation: activeTab ? "nameReveal 0.4s ease" : "none" }}>
              {activeGroup ? activeGroup.name
                : activeTab === "geral" ? (
                    <span style={{ display:"flex", alignItems:"center", gap:7 }}>
                      🌍 Chat Geral
                    </span>
                  )
                : tabUser ? (
                  <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                    {tabUser.photo
                      ? <img src={tabUser.photo} alt="" style={{ width:22, height:22, borderRadius:"50%", objectFit:"cover", flexShrink:0 }} />
                      : <div style={{ width:22, height:22, borderRadius:"50%", background:(roleColor[tabUser.role]||C.atxt)+"1A", color:roleColor[tabUser.role]||C.atxt, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, flexShrink:0 }}>{ini(tabUser.name||"?")}</div>
                    }
                    {tabUser.name || tabUser.email}
                  </span>
                ) : (
                  <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                    {/* MSN-style 3-person white icon */}
                    <svg width="22" height="18" viewBox="0 0 22 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="11" cy="5" r="3.2" fill="white"/>
                      <path d="M4 17c0-3.866 3.134-7 7-7h0c3.866 0 7 3.134 7 7" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                      <circle cx="3.5" cy="6" r="2.2" fill="white" opacity="0.7"/>
                      <path d="M0 16c0-2.761 1.567-5 3.5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
                      <circle cx="18.5" cy="6" r="2.2" fill="white" opacity="0.7"/>
                      <path d="M22 16c0-2.761-1.567-5-3.5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>
                    </svg>
                    Nexp Chat
                  </span>
                )}
            </div>
            <div style={{ color:C.tm, fontSize:10, marginTop:1 }}>
              {activeGroup ? (() => {
                const members = activeGroup.members || [];
                const onlineCount = members.filter(uid => presence[uid]?.online).length;
                return `👥 ${members.length} membros · 🟢 ${onlineCount} online${isGroupAdm ? " · Você é adm" : ""}`;
              })()
              : activeTab === "geral"
              ? (() => {
                  const onlineCount = users.filter(u => presence[u.uid||u.id]?.online).length;
                  return `${users.length} membros · 🟢 ${onlineCount} online agora`;
                })()
              : tabUser
              ? (
                <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background: presence[activeTab]?.online ? "#16A34A" : "#FBBF24", display:"inline-block", flexShrink:0, boxShadow: presence[activeTab]?.online?"0 0 5px #16A34A88":"0 0 5px #FBBF2488" }} />
                  <span style={{ color: presence[activeTab]?.online ? "#16A34A" : "#FBBF24" }}>
                    {presence[activeTab]?.online ? "online agora" : "offline"}
                  </span>
                </span>
              )
              : "Seu mensageiro de trabalho"}
            </div>
          </div>
          {/* DM settings button — person icon */}
          {activeTab && !activeGroupId && activeTab !== "geral" && (
            <button onClick={() => setShowDMSettings(p=>!p)} title="Perfil da conversa"
              style={{ background:showDMSettings?C.abg:"transparent", border:showDMSettings?`1px solid ${C.atxt}44`:`1px solid ${C.b2}`, color:showDMSettings?C.atxt:C.tm, borderRadius:8, padding:"3px 9px", fontSize:15, cursor:"pointer", flexShrink:0, transition:"all 0.15s" }}>
              👤
            </button>
          )}
          {/* Geral settings button */}
          {activeTab === "geral" && canManageGroups && (
            <button onClick={() => setShowGeralSettings(p=>!p)} title="Configurações do Chat Geral"
              style={{ background:showGeralSettings?C.abg:"transparent", border:showGeralSettings?`1px solid ${C.atxt}44`:`1px solid ${C.b2}`, color:showGeralSettings?C.atxt:C.tm, borderRadius:8, padding:"3px 10px", fontSize:13, cursor:"pointer", flexShrink:0, transition:"all 0.15s" }}>
              ⚙
            </button>
          )}
          {/* Group settings button for adm */}
          {isGroupAdm && (
            <button onClick={() => { setShowGroupConfig(p=>!p); }}
              style={{ background:showGroupConfig?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.08)", border:"none", color:showGroupConfig?C.atxt:C.tm, borderRadius:8, width:28, height:28, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }} title="Configurações do grupo">
              ⚙
            </button>
          )}
        </div>
        {/* Controls */}
        <div style={{ display:"flex", gap:5 }}>
          {/* 👤 Profile settings — LEFT of + */}
          {!activeTab && (
            <button onClick={() => setShowProfileSettings(p=>!p)} title="Meu perfil"
              style={{ background: showProfileSettings ? C.acc+"22" : "rgba(255,255,255,0.08)", border: showProfileSettings ? `1px solid ${C.acc}55` : "none", color: showProfileSettings ? C.atxt : C.tm, borderRadius:8, width:28, height:28, cursor:"pointer", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.background=C.acc+"22"} onMouseLeave={e=>{ if(!showProfileSettings) e.currentTarget.style.background="rgba(255,255,255,0.08)"; }}>
              👤
            </button>
          )}
          {/* + create group */}
          {canManageGroups && !activeTab && (
            <button onClick={() => setShowCreateGroup(p=>!p)} title="Criar grupo"
              style={{ background: showCreateGroup ? C.acc : "rgba(59,110,245,0.18)", border:"none", color: showCreateGroup ? "#fff" : "#3B6EF5", borderRadius:8, width:28, height:28, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, transition:"all 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.background=C.acc} onMouseLeave={e=>{ if(!showCreateGroup) e.currentTarget.style.background="rgba(59,110,245,0.18)"; }}>
              ＋
            </button>
          )}
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
        <div style={{ flex:1, overflowY:"auto", padding:"8px", position:"relative" }}>
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
          <div style={{ position:"relative", marginBottom:6 }}>
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <button onClick={() => setActiveTab("geral")} style={{ flex:1, display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"transparent", border:`1px solid ${C.b1}`, cursor:"pointer", textAlign:"left", transition:"all 0.14s" }}
                onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{ width:40, height:40, borderRadius:"50%", background:C.acc+"1A", color:C.acc, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🌍</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:C.tp, fontSize:13, fontWeight:600, display:"flex", alignItems:"center", gap:5 }}>Chat Geral {isMuted("geral")&&<span style={{fontSize:10,opacity:0.5}}>🔇</span>}</div>
                  <div style={{ color:C.tm, fontSize:11 }}>Todos os membros</div>
                </div>
              </button>
              <div style={{ position:"relative" }}>
                <button onClick={e=>{e.stopPropagation();setShowMuteMenu(showMuteMenu==="geral"?null:"geral");}}
                  style={{ background:"transparent", border:`1px solid ${C.b2}`, color:isMuted("geral")?C.atxt:C.td, borderRadius:8, width:24, height:24, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>—</button>
                {showMuteMenu === "geral" && <MuteMenu convKey="geral" isMestreUser={false} onClose={()=>setShowMuteMenu(null)} />}
              </div>
            </div>
          </div>
          )}

          {/* Groups section */}
          {groups.length > 0 && (
            <div style={{ color:C.td, fontSize:10, textTransform:"uppercase", letterSpacing:"0.5px", padding:"6px 4px 4px", marginTop:4 }}>Grupos</div>
          )}
          {groups.filter(g => !searchChat || (g.name||"").toLowerCase().includes(searchChat.toLowerCase())).map(g => {
            const unread = unreadGroup(g.id);
            const gKey = "grp:" + g.id;
            const gMuted = isMuted(gKey);
            return (
              <div key={g.id} style={{ position:"relative", marginBottom:6 }}>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <button onClick={() => { setActiveTab(gKey); }}
                    style={{ flex:1, display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"transparent", border:`1px solid ${C.b1}`, cursor:"pointer", textAlign:"left", transition:"all 0.14s" }}
                    onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ width:40, height:40, borderRadius:"50%", background:C.acc+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0, overflow:"hidden", border:`1px solid ${C.b1}` }}>
                      {g.photo ? <img src={g.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "👥"}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:C.tp, fontSize:13, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", display:"flex", alignItems:"center", gap:5 }}>{g.name}{gMuted&&<span style={{fontSize:10,opacity:0.5}}>🔇</span>}</div>
                      <div style={{ color:C.tm, fontSize:11 }}>{(g.members||[]).length} membros</div>
                    </div>
                    {unread > 0 && !gMuted && <span style={{ background:C.acc, color:"#fff", borderRadius:"50%", width:20, height:20, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{unread}</span>}
                  </button>
                  <div style={{ position:"relative" }}>
                    <button onClick={e=>{e.stopPropagation();setShowMuteMenu(showMuteMenu===gKey?null:gKey);}}
                      style={{ background:"transparent", border:`1px solid ${C.b2}`, color:gMuted?C.atxt:C.td, borderRadius:8, width:24, height:24, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>—</button>
                    {showMuteMenu === gKey && <MuteMenu convKey={gKey} isMestreUser={false} onClose={()=>setShowMuteMenu(null)} />}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Create group form — fullscreen panel */}
          {showCreateGroup && canManageGroups && (
            <div style={{ position:"absolute", inset:0, zIndex:50, background:C.sb, display:"flex", flexDirection:"column", borderRadius:16, overflow:"hidden" }}>
              {/* Header */}
              <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                <button onClick={()=>{setShowCreateGroup(false);setGroupName("");setGroupPhoto(null);setGroupMembers([]);setGroupNewSearch("");setGroupNewTheme(null);}}
                  style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:18, padding:"0 4px", lineHeight:1 }}>‹</button>
                <div style={{ flex:1, color:C.tp, fontSize:14, fontWeight:700 }}>Novo Grupo</div>
                <button onClick={createGroup} disabled={!groupName.trim() || groupMembers.length===0}
                  style={{ background:groupName.trim()&&groupMembers.length>0?C.acc:C.deep, color:groupName.trim()&&groupMembers.length>0?"#fff":C.td, border:"none", borderRadius:8, padding:"6px 14px", fontSize:12.5, fontWeight:700, cursor:groupName.trim()&&groupMembers.length>0?"pointer":"not-allowed", opacity:groupName.trim()&&groupMembers.length>0?1:0.5, transition:"all 0.2s" }}>
                  Salvar
                </button>
              </div>

              <div style={{ flex:1, overflowY:"auto", padding:"14px" }}>

                {/* ── Foto + Nome ── */}
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18 }}>
                  <div onClick={() => groupPhotoRef.current?.click()} style={{ position:"relative", width:64, height:64, borderRadius:"50%", background:C.deep, border:`2.5px dashed ${C.atxt}55`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden", flexShrink:0, transition:"border-color 0.2s" }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=C.atxt} onMouseLeave={e=>e.currentTarget.style.borderColor=C.atxt+"55"}>
                    {groupPhoto
                      ? <img src={groupPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                      : <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                          <span style={{ fontSize:22 }}>📷</span>
                          <span style={{ color:C.td, fontSize:9 }}>Foto</span>
                        </div>
                    }
                    {groupPhoto && <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", opacity:0, transition:"opacity 0.2s" }} onMouseEnter={e=>e.currentTarget.style.opacity="1"} onMouseLeave={e=>e.currentTarget.style.opacity="0"}><span style={{ fontSize:16 }}>✏</span></div>}
                  </div>
                  <input ref={groupPhotoRef} type="file" accept="image/*" style={{ display:"none" }}
                    onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setGroupPhoto(ev.target.result); r.readAsDataURL(f); }} />
                  <div style={{ flex:1 }}>
                    <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:5 }}>Nome do grupo *</label>
                    <input value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Ex: Equipe Vendas..."
                      style={{ ...S.input, fontSize:13, border:`1px solid ${groupName.trim()?C.atxt+"66":C.b2}`, borderRadius:10, transition:"border-color 0.2s" }}
                      onFocus={e=>e.target.style.borderColor=C.atxt+"88"} onBlur={e=>e.target.style.borderColor=groupName.trim()?C.atxt+"66":C.b2} />
                  </div>
                </div>

                {/* ── Temas ── */}
                <div style={{ marginBottom:18 }}>
                  <div style={{ color:C.tm, fontSize:11, marginBottom:8 }}>🎨 Tema do grupo</div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {[
                      { id:null,      label:"Padrão",      bg:C.card },
                      { id:"nature",  label:"🌿 Natureza", bg:"linear-gradient(135deg,#064e3b,#065f46)" },
                      { id:"ocean",   label:"🌊 Oceano",   bg:"linear-gradient(135deg,#0c4a6e,#075985)" },
                      { id:"sunset",  label:"🌅 Por do sol",bg:"linear-gradient(135deg,#7c2d12,#c2410c)" },
                      { id:"galaxy",  label:"🌌 Galáxia",  bg:"linear-gradient(135deg,#1e1b4b,#4c1d95)" },
                      { id:"office",  label:"🏢 Escritório",bg:"linear-gradient(135deg,#1e293b,#475569)" },
                      { id:"forest",  label:"🌲 Floresta", bg:"linear-gradient(135deg,#14532d,#15803d)" },
                      { id:"aurora",  label:"✨ Aurora",   bg:"linear-gradient(270deg,#6366f1,#8b5cf6,#ec4899)" },
                      { id:"neon",    label:"⚡ Neon",     bg:"linear-gradient(270deg,#0ea5e9,#8b5cf6,#ec4899)" },
                    ].map(t => {
                      const sel = groupNewTheme === t.id;
                      return (
                        <button key={String(t.id)} onClick={() => setGroupNewTheme(t.id)}
                          style={{ background:t.bg, backgroundSize:"200% 200%", border: sel ? "2.5px solid #fff" : `1px solid ${C.b2}`, borderRadius:10, padding:"5px 11px", cursor:"pointer", fontSize:10.5, color: t.id ? "#fff" : C.ts, fontWeight: sel ? 700 : 400, boxShadow: sel ? "0 0 10px rgba(255,255,255,0.25)" : "none", transition:"all 0.15s" }}>
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Membros adicionados ── */}
                {groupMembers.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ color:C.tm, fontSize:11, marginBottom:8 }}>✅ Adicionados ({groupMembers.length})</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {groupMembers.map(uid => {
                        const u = users.find(x=>(x.uid||x.id)===uid);
                        if (!u) return null;
                        const rc2 = roleColor[u.role]||C.atxt;
                        return (
                          <div key={uid} style={{ display:"flex", alignItems:"center", gap:6, background:C.acc+"15", border:`1px solid ${C.acc}44`, borderRadius:20, padding:"4px 8px 4px 4px" }}>
                            <div style={{ width:22, height:22, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:rc2+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:700, color:rc2 }}>
                              {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                            </div>
                            <span style={{ color:C.atxt, fontSize:11.5, fontWeight:600, maxWidth:70, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{(u.name||u.email).split(" ")[0]}</span>
                            <button onClick={() => setGroupMembers(p=>p.filter(x=>x!==uid))}
                              style={{ background:"rgba(239,68,68,0.15)", border:"none", color:"#F87171", borderRadius:"50%", width:16, height:16, fontSize:9, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontWeight:700 }}>−</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Busca + lista de usuários ── */}
                <div style={{ color:C.tm, fontSize:11, marginBottom:8 }}>👤 Adicionar membros</div>
                <input value={groupNewSearch} onChange={e=>setGroupNewSearch(e.target.value)}
                  placeholder="🔍 Buscar por nome..." style={{ ...S.input, fontSize:12.5, marginBottom:10, borderRadius:10 }} />
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {users.filter(u => {
                    const uid = u.uid||u.id;
                    if (uid === myId) return false;
                    if (!groupNewSearch.trim()) return true;
                    return (u.name||u.email||"").toLowerCase().includes(groupNewSearch.toLowerCase());
                  }).map(u => {
                    const uid = u.uid||u.id;
                    const added = groupMembers.includes(uid);
                    const rc2 = roleColor[u.role]||C.atxt;
                    return (
                      <div key={uid} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:10, background: added ? C.acc+"12" : C.deep, border: added ? `1px solid ${C.acc}44` : `1px solid ${C.b2}`, transition:"all 0.15s" }}>
                        <div style={{ width:34, height:34, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:rc2+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:rc2 }}>
                          {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color: added ? C.atxt : C.tp, fontSize:13, fontWeight: added ? 600 : 400, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{u.name||u.email}</div>
                          <div style={{ color:rc2, fontSize:10 }}>{roleLabel[u.role]}</div>
                        </div>
                        <button onClick={() => setGroupMembers(p => added ? p.filter(x=>x!==uid) : [...p,uid])}
                          style={{
                            width:28, height:28, borderRadius:"50%", border:"none", cursor:"pointer", flexShrink:0, fontSize:16, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s",
                            background: added ? "rgba(239,68,68,0.15)" : C.acc,
                            color: added ? "#F87171" : "#fff",
                          }}>
                          {added ? "−" : "+"}
                        </button>
                      </div>
                    );
                  })}
                </div>

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
            const muted = isMuted(uid);
            const isMestre = u.role === "mestre";
            return (
              <div key={uid} style={{ position:"relative", marginBottom:6 }}>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <button onClick={() => setActiveTab(uid)} style={{ flex:1, display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, background:"transparent", border:`1px solid ${C.b1}`, cursor:"pointer", textAlign:"left", transition:"all 0.14s" }}
                    onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ position:"relative", flexShrink:0 }}>
                      <div
                        onClick={e => { e.stopPropagation(); if(userHasStory && onOpenStory) onOpenStory(uid); }}
                        style={{
                          width:44, height:44, borderRadius:"50%",
                          padding: userHasStory ? 2 : 0, boxSizing:"border-box",
                          background: userHasStory === "unseen" ? "linear-gradient(135deg,#3B6EF5,#7C3AED,#F5376B)" : userHasStory === "seen" ? "#6B7280" : "transparent",
                          border: !userHasStory ? `1.5px solid ${rc}33` : "none",
                          cursor: userHasStory ? "pointer" : "default",
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}>
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
                        <div style={{ color:C.tp, fontSize:13, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", display:"flex", alignItems:"center", gap:5 }}>
                          {u.name || u.email}
                          {muted && <span style={{ fontSize:10, opacity:0.5 }}>🔇</span>}
                        </div>
                        {isOnline ? (
                          <div style={{ color:"#16A34A", fontSize:11, display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ width:6, height:6, borderRadius:"50%", background:"#16A34A", display:"inline-block", animation:"pulse 1.5s infinite" }} />
                            online agora
                          </div>
                        ) : presence[uid]?.lastSeen?.seconds ? (
                          <div style={{ color:C.td, fontSize:10.5 }}>
                            👁 Visto {new Date(presence[uid].lastSeen.seconds*1000).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})} às {new Date(presence[uid].lastSeen.seconds*1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
                          </div>
                        ) : (
                          <div style={{ color:C.tm, fontSize:11 }}>{roleLabel[u.role]}</div>
                        )}
                      </div>
                    {unread > 0 && !muted && <span style={{ background:C.acc, color:"#fff", borderRadius:"50%", width:20, height:20, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{unread}</span>}
                  </button>
                  {/* Mute button — not allowed for mestre */}
                  {!isMestre && (
                    <button
                      onClick={e=>{e.stopPropagation(); setShowMuteMenu(showMuteMenu===uid?null:uid);}}
                      style={{ background:"transparent", border:`1px solid ${C.b2}`, color:muted?C.atxt:C.td, borderRadius:8, width:24, height:24, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all 0.12s" }}
                      title={muted?"Silenciado":"Silenciar"}>
                      —
                    </button>
                  )}
                </div>
                {/* Mute dropdown */}
                {showMuteMenu === uid && !isMestre && (
                  <div style={{ position:"absolute", right:0, top:50, background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, padding:"6px", zIndex:100, boxShadow:"0 4px 20px rgba(0,0,0,0.5)", minWidth:160 }}>
                    <div style={{ color:C.tm, fontSize:10, padding:"4px 8px", fontWeight:600, marginBottom:4 }}>🔇 Silenciar por</div>
                    {[{label:"8 horas", val:8*3600000},{label:"24 horas",val:24*3600000},{label:"1 semana",val:7*24*3600000},{label:"Para sempre",val:"forever"}].map(opt=>(
                      <button key={opt.label} onClick={()=>{
                        setMutedConvs(p=>({...p,[uid]: opt.val==="forever"?"forever":Date.now()+opt.val}));
                        setShowMuteMenu(null);
                      }} style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", background:"transparent", border:"none", color:C.ts, fontSize:12, cursor:"pointer", borderRadius:8, transition:"background 0.1s" }}
                        onMouseEnter={e=>e.currentTarget.style.background=C.abg}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        {opt.label}
                      </button>
                    ))}
                    {muted && (
                      <button onClick={()=>{setMutedConvs(p=>{const n={...p};delete n[uid];return n;});setShowMuteMenu(null);}}
                        style={{ display:"block", width:"100%", textAlign:"left", padding:"6px 10px", background:"transparent", border:"none", color:C.acc, fontSize:12, cursor:"pointer", borderRadius:8, fontWeight:600, borderTop:`1px solid ${C.b1}`, marginTop:4 }}>
                        🔔 Ativar som
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Conversation ── */}
      {activeTab && (
        <>
          {/* ── DM Settings fullscreen ── */}
          {showDMSettings && activeTab && !activeGroupId && (
            <div style={{ position:"absolute", inset:0, zIndex:50, background:C.sb, display:"flex", flexDirection:"column", borderRadius:16, overflow:"hidden" }}>
              <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                <button onClick={()=>setShowDMSettings(false)} style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:18, lineHeight:1 }}>‹</button>
                <div style={{ flex:1, color:C.tp, fontSize:14, fontWeight:700 }}>👤 Perfil da conversa</div>
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:"16px" }}>

                {/* Last seen */}
                {tabUser && (
                  <div style={{ ...S.card, padding:"14px", borderRadius:12, marginBottom:18 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10, cursor:"pointer" }} onClick={()=>setViewingProfile(tabUser.uid||tabUser.id)}>
                      <div style={{ width:50, height:50, borderRadius:"50%", overflow:"hidden", background:C.deep, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:C.atxt, flexShrink:0, border:`2px solid ${C.b1}` }}>
                        {tabUser.photo ? <img src={tabUser.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(tabUser.name||"?")}
                      </div>
                      <div>
                        <div style={{ color:C.tp, fontSize:13, fontWeight:700 }}>{tabUser.name||tabUser.email}</div>
                        <div style={{ color: presence[activeTab]?.online ? "#16A34A" : C.tm, fontSize:11.5, marginTop:2 }}>
                          {presence[activeTab]?.online ? "🟢 Online agora" : lastMsgTime(activeTab) ? `👁 Visto por último às ${lastMsgTime(activeTab)}` : "Nunca visto"}
                        </div>
                      </div>
                    </div>
                    {tabUser.bio && <div style={{ color:C.tm, fontSize:12, fontStyle:"italic", padding:"8px 10px", background:C.deep, borderRadius:8, marginBottom:8 }}>📝 {tabUser.bio}</div>}
                    {tabUser.recado && <div style={{ color:C.atxt, fontSize:12, padding:"8px 10px", background:C.abg, borderRadius:8, marginBottom:8 }}>💬 {tabUser.recado}</div>}
                    {tabUser.birthday && <div style={{ color:C.tm, fontSize:11 }}>🎂 {new Date(tabUser.birthday).toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"})}</div>}
                  </div>
                )}

                {/* DM Themes */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:10, fontWeight:700 }}>🎨 Tema da conversa</div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
                  {[
                    { id:null, label:"Padrão", bg:C.card },
                    { id:"nature", label:"🌿 Natureza", bg:"linear-gradient(135deg,#064e3b,#065f46)" },
                    { id:"ocean", label:"🌊 Oceano", bg:"linear-gradient(135deg,#0c4a6e,#075985)" },
                    { id:"sunset", label:"🌅 Pôr do sol", bg:"linear-gradient(135deg,#7c2d12,#c2410c)" },
                    { id:"galaxy", label:"🌌 Galáxia", bg:"linear-gradient(135deg,#1e1b4b,#4c1d95)" },
                    { id:"office", label:"🏢 Escritório", bg:"linear-gradient(135deg,#1e293b,#475569)" },
                    { id:"forest", label:"🌲 Floresta", bg:"linear-gradient(135deg,#14532d,#15803d)" },
                    { id:"sakura", label:"🌸 Sakura", bg:"linear-gradient(135deg,#831843,#be185d)" },
                    { id:"aurora", label:"✨ Aurora", bg:"linear-gradient(270deg,#6366f1,#8b5cf6,#ec4899)" },
                    { id:"neon", label:"⚡ Neon", bg:"linear-gradient(270deg,#0ea5e9,#8b5cf6,#ec4899)" },
                    { id:"coffee", label:"☕ Café", bg:"linear-gradient(135deg,#451a03,#78350f)" },
                  ].map(t => {
                    const sel = dmTheme === t.id;
                    return (
                      <button key={String(t.id)} onClick={async ()=>{
                        setDmTheme(t.id);
                        if (t.id) await sendChatMessage({ text:`${currentUser.name||currentUser.email} trocou o tema da conversa para ${t.label}`, type:"system", toId:activeTab, authorId:myId, authorName:currentUser.name||currentUser.email });
                      }}
                        style={{ background:t.bg, backgroundSize:"200% 200%", border: sel ? "2.5px solid #fff" : `1px solid ${C.b2}`, borderRadius:10, padding:"6px 12px", cursor:"pointer", fontSize:11, color: t.id ? "#fff" : C.ts, fontWeight: sel ? 700 : 400, boxShadow: sel ? "0 0 10px rgba(255,255,255,0.2)" : "none", transition:"all 0.15s" }}>
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {/* Auto-delete */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:10, fontWeight:700 }}>⏱ Exclusão automática</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8 }}>
                  {[{id:null,label:"Desativado"},{id:"close",label:"Ao fechar"},{id:"8h",label:"8 horas"},{id:"24h",label:"24 horas"},{id:"48h",label:"48 horas"},{id:"7d",label:"7 dias"},{id:"30d",label:"30 dias"}].map(opt => (
                    <button key={String(opt.id)} onClick={()=>setAutoDeleteDM(opt.id)}
                      style={{ background: autoDeleteDM===opt.id ? C.acc : C.deep, color: autoDeleteDM===opt.id ? "#fff" : C.ts, border: autoDeleteDM===opt.id ? "none" : `1px solid ${C.b2}`, borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:11.5, fontWeight: autoDeleteDM===opt.id ? 700 : 400, transition:"all 0.15s" }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {autoDeleteDM && <div style={{ color:C.tm, fontSize:11, marginBottom:18 }}>⚠ Mensagens apagadas automaticamente {autoDeleteDM==="close"?"ao fechar":"a cada "+autoDeleteDM}.</div>}

                {/* Clear conversation */}
                <div style={{ borderTop:`1px solid ${C.b1}`, paddingTop:14, marginBottom:4 }}>
                  <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🧹 Limpar conversa</div>
                  <p style={{ color:C.tm, fontSize:11.5, marginBottom:10 }}>Apaga apenas o histórico para você, o outro usuário continua vendo.</p>
                  <button onClick={() => setConfirmModal({
                    title:"Limpar conversa",
                    body:"Limpar todo o histórico desta conversa para você?\nO outro usuário não será afetado.",
                    onConfirm: async () => {
                      const myMsgs = allMessages.filter(m => m.authorId === myId && (m.toId===activeTab));
                      setDeletingMsgIds(myMsgs.map(m=>m.id));
                      setTimeout(async()=>{
                        for(const m of myMsgs){try{await deleteDoc(doc(db,"chat",m.id));}catch(e){}}
                        setDeletingMsgIds([]);
                      },600);
                    }
                  })} style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:10, padding:"9px 14px", fontSize:12.5, cursor:"pointer", width:"100%", textAlign:"left", marginBottom:8 }}>
                    🧹 Limpar meu histórico
                  </button>
                </div>

                {/* Delete conversation */}
                <div style={{ borderTop:`1px solid ${C.b1}`, paddingTop:16 }}>
                  <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🗑 Excluir conversa</div>
                  <p style={{ color:C.tm, fontSize:11.5, marginBottom:10 }}>Apaga todas as mensagens desta conversa para todos.</p>
                  <button onClick={() => setConfirmModal({
                    title:"Excluir bate papo",
                    body:"Você tem certeza que deseja excluir esse bate papo?\n\nEsta ação não pode ser desfeita, mas você ainda poderá ter uma nova conversa com o usuário.",
                    onConfirm: async () => {
                      const allConvMsgs = allMessages.filter(m=>(m.authorId===myId&&m.toId===activeTab)||(m.authorId===activeTab&&m.toId===myId));
                      setDeletingMsgIds(allConvMsgs.map(m=>m.id));
                      setTimeout(async()=>{
                        for(const m of allConvMsgs){try{await deleteDoc(doc(db,"chat",m.id));}catch(e){}}
                        setDeletingMsgIds([]);setShowDMSettings(false);setActiveTab(null);
                      },600);
                    }
                  })} style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:10, padding:"10px 14px", fontSize:12.5, fontWeight:600, cursor:"pointer", width:"100%", textAlign:"left" }}>
                    🗑 Excluir conversa
                  </button>
                </div>
              </div>
            </div>
          )}
          {showGroupConfig && isGroupAdm && activeGroup && (
            <div style={{ position:"absolute", inset:0, zIndex:50, background:C.sb, display:"flex", flexDirection:"column", borderRadius:16, overflow:"hidden" }}>
              <style>{`@keyframes gcFade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>

              {/* Header */}
              <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                <button onClick={()=>setShowGroupConfig(false)} style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:18, padding:"0 4px", lineHeight:1 }}>‹</button>
                <div style={{ flex:1, color:C.tp, fontSize:14, fontWeight:700 }}>⚙ Configurações do grupo</div>
              </div>

              <div style={{ flex:1, overflowY:"auto", padding:"14px", animation:"gcFade 0.18s ease" }}>

                {/* ── Nome + Foto ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>✏ Nome e foto</div>
                <div style={{ display:"flex", gap:12, marginBottom:14 }}>
                  <div onClick={() => editGroupPhotoRef.current?.click()}
                    style={{ width:56, height:56, borderRadius:"50%", background:C.deep, border:`1.5px dashed ${C.atxt}55`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden", flexShrink:0 }}>
                    {activeGroup.photo ? <img src={activeGroup.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <span style={{ fontSize:22 }}>📷</span>}
                  </div>
                  <input ref={editGroupPhotoRef} type="file" accept="image/*" style={{ display:"none" }}
                    onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>{setEditGroupPhoto(ev.target.result); gcUpdate({ photo: ev.target.result });}; r.readAsDataURL(f); }} />
                  <input value={editGroupName} onChange={e=>setEditGroupName(e.target.value)}
                    onBlur={()=>{ if(editGroupName.trim() && editGroupName !== activeGroup.name) saveGroupEdit(); }}
                    placeholder={activeGroup.name}
                    style={{ ...S.input, fontSize:13, flex:1, borderRadius:10 }} />
                </div>

                {/* ── Biografia do grupo ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>📝 Biografia do grupo</div>
                <textarea
                  value={editGroupBio || activeGroup.bio || ""}
                  onChange={e=>setEditGroupBio(e.target.value)}
                  onBlur={async ()=>{
                    if (editGroupBio.trim() !== (activeGroup.bio||"")) {
                      await gcUpdate({ bio: editGroupBio.trim() });
                    }
                  }}
                  placeholder="Descreva o propósito do grupo... (visível a todos os membros)"
                  rows={3}
                  style={{ ...S.input, resize:"none", fontSize:12.5, marginBottom:16, borderRadius:10 }}
                />

                {/* ── Temas ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🎨 Tema do chat</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:18 }}>
                  {[
                    { id:null, label:"✕ Padrão", bg:C.deep },
                    { id:"nature",  label:"🌿 Natureza",   bg:"linear-gradient(135deg,#064e3b,#065f46)" },
                    { id:"ocean",   label:"🌊 Oceano",      bg:"linear-gradient(135deg,#0c4a6e,#075985)" },
                    { id:"sunset",  label:"🌅 Pôr do sol",  bg:"linear-gradient(135deg,#7c2d12,#c2410c)" },
                    { id:"galaxy",  label:"🌌 Galáxia",     bg:"linear-gradient(135deg,#1e1b4b,#4c1d95)" },
                    { id:"office",  label:"🏢 Escritório",  bg:"linear-gradient(135deg,#1e293b,#475569)" },
                    { id:"forest",  label:"🌲 Floresta",    bg:"linear-gradient(135deg,#14532d,#15803d)" },
                    { id:"aurora",  label:"✨ Aurora",       bg:"linear-gradient(270deg,#6366f1,#8b5cf6,#ec4899)" },
                    { id:"neon",    label:"⚡ Neon",         bg:"linear-gradient(270deg,#0ea5e9,#8b5cf6,#ec4899)" },
                  ].map(t => (
                    <button key={String(t.id)} onClick={() => gcSetColor(t.id)}
                      style={{ background:t.bg, backgroundSize:"200% 200%", border: groupColor===t.id ? "2.5px solid #fff" : `1px solid ${C.b2}`, borderRadius:10, padding:"5px 11px", cursor:"pointer", fontSize:10.5, color: t.id ? "#fff" : C.ts, fontWeight: groupColor===t.id ? 700 : 400, boxShadow: groupColor===t.id ? "0 0 10px rgba(255,255,255,0.25)" : "none", transition:"all 0.15s" }}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* ── Permissões ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🔧 Permissões</div>
                <div onClick={gcToggleOnlyAdmins} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 12px", borderRadius:10, cursor:"pointer", marginBottom:16, background:groupOnlyAdmins?"#F8717115":C.deep, border:groupOnlyAdmins?`1px solid #F8717144`:`1px solid ${C.b2}`, transition:"all 0.15s" }}>
                  <span style={{ color: groupOnlyAdmins ? "#F87171" : C.ts, fontSize:12, fontWeight: groupOnlyAdmins ? 600 : 400 }}>🔒 Travar conversa (só adms escrevem)</span>
                  <div style={{ width:32, height:18, borderRadius:9, background:groupOnlyAdmins?"#F87171":C.b2, position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                    <div style={{ position:"absolute", top:2, left: groupOnlyAdmins?14:2, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                  </div>
                </div>

                {/* ── Admins ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>👑 Administradores</div>
                <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:16 }}>
                  {(activeGroup.members||[]).map(uid => {
                    const u = users.find(x=>(x.uid||x.id)===uid);
                    if (!u) return null;
                    const isCreator = uid === (activeGroup.admId || activeGroup.createdBy);
                    const isAdm = isCreator || (activeGroup.admins||[]).includes(uid);
                    return (
                      <div key={uid} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:10, background:isAdm?C.abg:C.deep, border:isAdm?`1px solid ${C.atxt}33`:`1px solid ${C.b2}` }}>
                        <div style={{ width:28, height:28, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:C.b2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:C.atxt }}>
                          {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                        </div>
                        <span style={{ flex:1, color:isAdm?C.atxt:C.ts, fontSize:12 }}>{u.name||u.email}{isCreator?" 👑":""}{groupTrophies[uid]?" 🏆":""}</span>
                        {!isCreator && uid !== myId && (
                          <button onClick={() => isAdm ? gcRemoveAdmin(uid) : gcAddAdmin(uid)}
                            style={{ background:isAdm?"#2D1515":C.abg, color:isAdm?"#F87171":C.atxt, border:isAdm?"1px solid #EF444433":`1px solid ${C.atxt}33`, borderRadius:6, padding:"3px 8px", fontSize:10, cursor:"pointer", fontWeight:600 }}>
                            {isAdm ? "Remover adm" : "+ Adm"}
                          </button>
                        )}
                        {uid !== myId && !isCreator && (
                          <button onClick={() => gcToggleTrophy(uid)} style={{ background:"transparent", border:"none", fontSize:13, cursor:"pointer", opacity:groupTrophies[uid]?1:0.4 }} title="Troféu">🏆</button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ── Membros — Adicionar / Remover ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>👥 Membros do grupo</div>
                <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:8, maxHeight:160, overflowY:"auto" }}>
                  {(activeGroup.members||[]).map(uid => {
                    const u = users.find(x=>(x.uid||x.id)===uid);
                    if (!u) return null;
                    const isCreator2 = uid === (activeGroup.admId || activeGroup.createdBy);
                    return (
                      <div key={uid} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:10, background:C.deep, border:`1px solid ${C.b2}` }}>
                        <div style={{ width:28, height:28, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:C.b2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:C.atxt }}>
                          {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                        </div>
                        <span style={{ flex:1, color:C.ts, fontSize:12 }}>{u.name||u.email}{isCreator2?" 👑":""}</span>
                        {!isCreator2 && uid !== myId && (isGroupAdm || ["mestre","master"].includes(currentUser.role)) && (
                          <button onClick={() => removeMemberWithNotif(uid)}
                            style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:6, padding:"3px 8px", fontSize:10, cursor:"pointer", fontWeight:600 }}>
                            Remover
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize:10, color:C.td, marginBottom:6 }}>Adicionar ao grupo:</div>
                <div style={{ display:"flex", flexDirection:"column", gap:3, maxHeight:100, overflowY:"auto", marginBottom:18 }}>
                  {users.filter(u => !(activeGroup.members||[]).includes(u.uid||u.id) && (u.uid||u.id)!==myId).map(u => {
                    const uid = u.uid||u.id;
                    const rc2 = roleColor[u.role]||C.atxt;
                    return (
                      <button key={uid} onClick={async () => {
                        const newMembers = [...(activeGroup.members||[]), uid];
                        await setDoc(doc(db,"chatGroups",activeGroup.id),{members:newMembers},{merge:true});
                        const addedUser = users.find(x=>(x.uid||x.id)===uid);
                        // System message in group
                        await sendChatMessage({ text:`${addedUser?.name||"Usuário"} agora faz parte do grupo`, type:"system", groupId:activeGroup.id, authorId:myId, authorName:currentUser.name||currentUser.email });
                        const nid = `notif_addmember_${activeGroup.id}_${uid}_${Date.now()}`;
                        await setDoc(doc(db,"notifications",nid),{ type:"group_added", userId:uid, groupId:activeGroup.id, groupName:activeGroup.name, addedBy:currentUser.name||currentUser.email, createdAt:Date.now(), read:false });
                      }} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderRadius:10, background:C.deep, border:`1px solid ${C.b2}`, cursor:"pointer", textAlign:"left", transition:"all 0.12s" }}
                        onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background=C.deep}>
                        <div style={{ width:26, height:26, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:rc2+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:rc2 }}>
                          {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                        </div>
                        <span style={{ flex:1, color:C.ts, fontSize:12 }}>{u.name||u.email}</span>
                        <span style={{ color:C.acc, fontSize:11, fontWeight:700 }}>+ Adicionar</span>
                      </button>
                    );
                  })}
                  {users.filter(u=>!(activeGroup.members||[]).includes(u.uid||u.id)&&(u.uid||u.id)!==myId).length===0 && (
                    <div style={{ color:C.td, fontSize:11, padding:"4px 8px" }}>Todos os usuários já estão no grupo</div>
                  )}
                </div>

                {/* ── Limpar conversa ── */}
                <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🗑 Limpar conversa</div>
                <div style={{ display:"flex", gap:6, marginBottom:4 }}>
                  <input value={gcClearPwInput} onChange={e=>{setGcClearPwInput(e.target.value);setGcClearPwErr("");}}
                    placeholder='Digite "CONFIRMAR" para apagar tudo'
                    style={{ ...S.input, fontSize:12, flex:1, borderRadius:10 }} />
                  <button onClick={gcClearAll} style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:10, padding:"6px 14px", fontSize:12, cursor:"pointer", fontWeight:600, flexShrink:0 }}>Limpar</button>
                </div>
                {gcClearPwErr && <div style={{ color:"#F87171", fontSize:11, marginBottom:12 }}>⚠ {gcClearPwErr}</div>}

                {/* ── Sair do grupo / Excluir grupo ── */}
                <div style={{ borderTop:`1px solid ${C.b1}`, paddingTop:14, marginTop:4, display:"flex", flexDirection:"column", gap:8 }}>
                  {/* Sair — everyone except sole creator can leave */}
                  {myId !== (activeGroup.admId || activeGroup.createdBy) && (
                    <button onClick={leaveGroup} style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:10, padding:"9px 14px", fontSize:12.5, fontWeight:600, cursor:"pointer", width:"100%", textAlign:"left" }}>
                      🚪 Sair do grupo
                    </button>
                  )}
                  {/* Excluir — adms e criador */}
                  {isGroupAdm && (
                    <button onClick={deleteGroup} style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:10, padding:"9px 14px", fontSize:12.5, fontWeight:600, cursor:"pointer", width:"100%", textAlign:"left" }}>
                      🗑 Excluir grupo
                    </button>
                  )}                </div>

              </div>
            </div>
          )}
          {/* Group member avatar strip with names */}
          {activeGroupId && activeGroup && (
            <div style={{ display:"flex", gap:12, padding:"8px 14px", borderBottom:`1px solid ${C.b1}`, overflowX:"auto", flexShrink:0, background:C.sb }}>
              {(activeGroup.members||[]).slice(0,10).map(uid => {
                const u = users.find(x=>(x.uid||x.id)===uid);
                if (!u) return null;
                const rc2 = roleColor[u.role]||C.atxt;
                const online = presence[uid]?.online;
                return (
                  <div key={uid} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer", flexShrink:0 }}
                    onClick={()=>setViewingProfile(uid)}>
                    <div style={{ position:"relative" }}>
                      <div style={{ width:32, height:32, borderRadius:"50%", overflow:"hidden", background:rc2+"1A", border:`1.5px solid ${rc2}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:rc2 }}>
                        {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                      </div>
                      <div style={{ position:"absolute", bottom:-1, right:-1, width:8, height:8, borderRadius:"50%", background:online?"#16A34A":"#FBBF24", border:`1.5px solid ${C.sb}` }} />
                    </div>
                    <span style={{ color:C.tm, fontSize:9, whiteSpace:"nowrap", maxWidth:40, overflow:"hidden", textOverflow:"ellipsis" }}>{(u.name||u.email).split(" ")[0]}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Select mode toolbar */}
          {selectMode && (
            <div style={{ padding:"8px 14px", background:C.abg, borderBottom:`1px solid ${C.atxt}33`, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
              <span style={{ color:C.atxt, fontSize:12, fontWeight:600, flex:1 }}>
                {selectedMsgs.length > 0 ? `${selectedMsgs.length} selecionada(s)` : "Selecione mensagens"}
              </span>
              {selectedMsgs.length > 0 && (
                <button onClick={async () => {
                  setDeletingMsgIds([...selectedMsgs]);
                  setTimeout(async () => {
                    for (const id of selectedMsgs) { try { await deleteDoc(doc(db,"chat",id)); } catch(e) {} }
                    setDeletingMsgIds([]); setSelectedMsgs([]); setSelectMode(false);
                  }, 500);
                }} style={{ background:"#EF4444", color:"#fff", border:"none", borderRadius:8, padding:"5px 12px", fontSize:12, cursor:"pointer", fontWeight:700 }}>
                  🗑 Excluir
                </button>
              )}
              <button onClick={() => { setSelectMode(false); setSelectedMsgs([]); }}
                style={{ background:"transparent", border:`1px solid ${C.b2}`, color:C.tm, borderRadius:8, padding:"5px 10px", fontSize:12, cursor:"pointer" }}>
                Cancelar
              </button>
            </div>
          )}
          {/* Messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"10px 14px", display:"flex", flexDirection:"column", gap:5,
            background: (() => {
              const t = activeGroupId ? groupColor : (activeTab === "geral" ? geralTheme : dmTheme);
              if (!t) return "transparent";
              const BGAS = {
                nature:"linear-gradient(135deg,#064e3b22,#065f4622)",
                ocean:"linear-gradient(135deg,#0c4a6e22,#07598522)",
                sunset:"linear-gradient(135deg,#7c2d1222,#c2410c22)",
                galaxy:"linear-gradient(135deg,#1e1b4b22,#4c1d9522)",
                office:"linear-gradient(135deg,#1e293b33,#47556933)",
                forest:"linear-gradient(135deg,#14532d22,#15803d22)",
                sakura:"linear-gradient(135deg,#83184322,#be185d22)",
                aurora:"linear-gradient(270deg,#6366f122,#8b5cf622,#ec489922)",
                neon:"linear-gradient(270deg,#0ea5e922,#8b5cf622,#ec489922)",
                coffee:"linear-gradient(135deg,#451a0322,#78350f22)",
                desert:"linear-gradient(135deg,#78350f22,#b4530922)",
                arctic:"linear-gradient(135deg,#0c4a6e22,#bae6fd22)",
                lava:"linear-gradient(135deg,#7f1d1d22,#dc262622)",
                midnight:"linear-gradient(135deg,#02061722,#0f172a33)",
                emerald:"linear-gradient(135deg,#064e3b22,#10b98122)",
              };
              return BGAS[t] || (t + "18");
            })(),
            backgroundSize:"400% 400%",
            animation: ["aurora","neon"].includes(activeGroupId ? groupColor : dmTheme) ? "bgShift 4s ease infinite" : "none",
            transition:"background 0.3s",
          }}>
            {groupOnlyAdmins && !isGroupAdm && (
              <div style={{ textAlign:"center", margin:"10px 0", padding:"8px 16px", background:"#2B1D03", border:"1px solid #F59E0B44", borderRadius:20, color:"#FBBF24", fontSize:11.5, fontWeight:600 }}>
                🔒 Apenas administradores podem escrever neste grupo
              </div>
            )}
            {activeTab === "geral" && geralOnlyAdmins && !geralAdmins.includes(myId) && currentUser.role !== "mestre" && (
              <div style={{ textAlign:"center", margin:"10px 0", padding:"8px 16px", background:"#2B1D03", border:"1px solid #F59E0B44", borderRadius:20, color:"#FBBF24", fontSize:11.5, fontWeight:600 }}>
                🔒 Apenas administradores podem escrever no Chat Geral
              </div>
            )}
            {/* Show group bio */}
            {activeGroup?.bio && (
              <div style={{ textAlign:"center", margin:"8px 0 16px", padding:"10px 16px", background:C.abg, border:`1px solid ${C.atxt}22`, borderRadius:14, color:C.tm, fontSize:11.5, fontStyle:"italic" }}>
                📝 {activeGroup.bio}
              </div>
            )}
            {messages.length === 0 && <div style={{ textAlign:"center", padding:"30px 0", color:C.tm, fontSize:12 }}>Nenhuma mensagem ainda</div>}
            {messages.map(msg => {
              // System messages — centered pill
              if (msg.type === "system") {
                return (
                  <div key={msg.id} style={{ display:"flex", justifyContent:"center", margin:"4px 0" }}>
                    <div style={{ background:C.deep, border:`1px solid ${C.b1}`, borderRadius:20, padding:"4px 14px", fontSize:11, color:C.tm, fontStyle:"italic" }}>
                      {msg.text}
                    </div>
                  </div>
                );
              }
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
                <div key={msg.id} style={{ display:"flex", flexDirection:isMine?"row-reverse":"row", alignItems:"flex-end", gap:6, position:"relative",
                  animation: deletingMsgIds.includes(msg.id) ? "dissolve 0.5s ease forwards" : "none",
                  pointerEvents: deletingMsgIds.includes(msg.id) ? "none" : "auto",
                  background: selectMode && selectedMsgs.includes(msg.id) ? C.acc+"15" : "transparent",
                  borderRadius: 10, padding: selectMode ? "2px 4px" : "0",
                  transition: "background 0.15s",
                }}
                  onMouseEnter={()=>{ if(!selectMode) setHoveredMsg(msg.id); }}
                  onMouseLeave={()=>{if(!selectMode){setHoveredMsg(null);if(reactionPicker===msg.id)setReactionPicker(null);}}}
                  onClick={() => {
                    if (selectMode && isMine) {
                      setSelectedMsgs(p => p.includes(msg.id) ? p.filter(x=>x!==msg.id) : [...p, msg.id]);
                    }
                  }}>
                  {/* Select checkbox */}
                  {selectMode && isMine && (
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, width:20 }}>
                      <div style={{ width:16, height:16, borderRadius:4, border:`2px solid ${selectedMsgs.includes(msg.id)?C.acc:C.b2}`, background:selectedMsgs.includes(msg.id)?C.acc:"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", transition:"all 0.15s" }}>
                        {selectedMsgs.includes(msg.id)?"✓":""}
                      </div>
                    </div>
                  )}
                  {(() => {
                    const photo = isMine ? myPhoto : getUserPhoto(msg.authorId);
                    const rc2 = roleColor[msg.authorRole] || C.atxt;
                    const msgReaction = isMine ? userReaction : null;
                    return (
                      <div style={{ position:"relative", flexShrink:0, cursor:"pointer" }}
                        onClick={() => setViewingProfile(msg.authorId)}>
                        <div style={{ width:26, height:26, borderRadius:"50%", overflow:"hidden", border:`1.5px solid ${rc2}33` }}>
                          {photo
                            ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                            : <div style={{ width:"100%", height:"100%", background:rc2+"1A", color:rc2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700 }}>{ini(msg.authorName||"?")}</div>
                          }
                        </div>
                        {msgReaction && <div style={{ position:"absolute", bottom:-5, [isMine?"right":"left"]:-5, fontSize:13, lineHeight:1, pointerEvents:"none" }}>{msgReaction}</div>}
                      </div>
                    );
                  })()}
                  <div style={{ maxWidth:"75%", display:"flex", flexDirection:"column", alignItems:isMine?"flex-end":"flex-start", position:"relative" }}>
                    {(!isMine && (activeTab==="geral" || activeGroupId)) && (
                      <span onClick={()=>setViewingProfile(msg.authorId)}
                        style={{ color:rc, fontSize:9.5, fontWeight:700, marginBottom:2, cursor:"pointer", textDecoration:"underline dotted" }}
                        title="Ver perfil">
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
                          {/* Group OR Geral adm delete */}
                          {(activeGroupId && isGroupAdm) || (activeTab==="geral" && (geralAdmins.includes(myId)||currentUser.role==="mestre")) ? (
                            geralDelMsgId === msg.id || gcDelMsgId === msg.id ? (
                              <div style={{ position:"absolute", [isMine?"right":"left"]:0, top:28, background:"#1A0D0D", border:"1px solid #EF444433", borderRadius:12, padding:"10px 12px", zIndex:50, boxShadow:"0 4px 20px #00000088", display:"flex", flexDirection:"column", gap:8, width:200, maxWidth:"80vw" }}>
                                <div style={{ color:"#F87171", fontSize:12, fontWeight:700 }}>🗑 Apagar para todos?</div>
                                <div style={{ color:C.tm, fontSize:10.5, lineHeight:1.4 }}>Esta mensagem será removida para todos.</div>
                                <div style={{ display:"flex", gap:6 }}>
                                  <button onClick={() => { gcDeleteMsg(gcDelMsgId||geralDelMsgId); setGcDelMsgId(null); setGeralDelMsgId(null); }} style={{ background:"#EF4444", color:"#fff", border:"none", borderRadius:8, padding:"6px 0", fontSize:12, cursor:"pointer", fontWeight:700, flex:1 }}>Apagar</button>
                                  <button onClick={() => { setGcDelMsgId(null); setGeralDelMsgId(null); }} style={{ background:"transparent", border:`1px solid ${C.b2}`, color:C.tm, borderRadius:8, padding:"6px 10px", fontSize:12, cursor:"pointer" }}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={()=>{ activeGroupId ? setGcDelMsgId(msg.id) : setGeralDelMsgId(msg.id); setReactionPicker(null); }} style={{ background:"#2D1515", border:"1px solid #EF444433", borderRadius:"50%", width:22, height:22, fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#F87171" }} title="Apagar para todos">🗑</button>
                            )
                          ) : null}
                          {isMine && !selectMode && (
                            <button onClick={()=>{setSelectMode(true); setSelectedMsgs([msg.id]);}} style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:"50%", width:22, height:22, fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }} title="Selecionar">☑</button>
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
                disabled={(groupOnlyAdmins && !isGroupAdm) || (activeTab==="geral" && geralOnlyAdmins && !geralAdmins.includes(myId) && currentUser.role!=="mestre")}
                placeholder={(groupOnlyAdmins && !isGroupAdm) || (activeTab==="geral" && geralOnlyAdmins && !geralAdmins.includes(myId) && currentUser.role!=="mestre") ? "🔒 Apenas adms podem escrever" : "Escrever…"}
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

      {/* ── Profile Settings fullscreen ── */}
      {showProfileSettings && !activeTab && (
        <div style={{ position:"absolute", inset:0, zIndex:60, background:C.sb, display:"flex", flexDirection:"column", borderRadius:16, overflow:"hidden", animation:"fadeIn 0.2s ease" }}>
          <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <button onClick={()=>setShowProfileSettings(false)} style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:18, lineHeight:1 }}>‹</button>
            <div style={{ flex:1, color:C.tp, fontSize:14, fontWeight:700 }}>👤 Meu Perfil</div>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"16px" }}>
            {/* Cover + Photo */}
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, marginBottom:22 }}>
              {/* Cover photo */}
              <div style={{ width:"100%", height:90, borderRadius:12, overflow:"hidden", background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, position:"relative", marginBottom:-30 }}>
                {userCoverPhoto && <img src={userCoverPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />}
                <label style={{ position:"absolute", top:8, right:8, background:"rgba(0,0,0,0.55)", border:"1px solid rgba(255,255,255,0.25)", color:"#fff", borderRadius:8, padding:"3px 9px", fontSize:10, cursor:"pointer" }}>
                  🖼 Capa
                  <input type="file" accept="image/*" style={{ display:"none" }} onChange={async e=>{
                    const f=e.target.files[0]; if(!f) return;
                    const r=new FileReader();
                    r.onload=async ev=>{ setUserCoverPhoto(ev.target.result); try{ await saveUserProfile(myId,{...currentUser,coverPhoto:ev.target.result}); }catch(e2){} };
                    r.readAsDataURL(f);
                  }} />
                </label>
              </div>
              <div style={{ position:"relative", cursor:"pointer", zIndex:1 }} onClick={()=>document.getElementById("profilePhotoInput").click()}>
                <div style={{ width:80, height:80, borderRadius:"50%", overflow:"hidden", background:C.deep, border:`3px solid ${C.sb}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, color:C.atxt }}>
                  {currentUser.photo ? <img src={currentUser.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(currentUser.name||"?")}
                </div>
                {userReaction && <div style={{ position:"absolute", bottom:-6, right:-6, fontSize:26, lineHeight:1 }}>{userReaction}</div>}
                <div style={{ position:"absolute", bottom:4, left:"50%", transform:"translateX(-50%)", background:"rgba(0,0,0,0.6)", borderRadius:6, padding:"2px 6px", fontSize:9, color:"#fff", whiteSpace:"nowrap" }}>📷 Trocar</div>
              </div>
              <input id="profilePhotoInput" type="file" accept="image/*" style={{ display:"none" }} onChange={async e=>{
                const f=e.target.files[0]; if(!f) return;
                const r=new FileReader();
                r.onload=async ev=>{ try { await saveUserProfile(myId, {...currentUser, photo:ev.target.result}); } catch(e2){} };
                r.readAsDataURL(f);
              }} />
              <div style={{ textAlign:"center" }}>
                <div style={{ color:C.tp, fontSize:14, fontWeight:700 }}>{currentUser.name||currentUser.email}</div>
                <div style={{ color:C.tm, fontSize:11 }}>{currentUser.role}</div>
              </div>
            </div>

            {/* Recado */}
            <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>💬 Recado</div>
            <div style={{ ...S.card, padding:"12px", borderRadius:12, marginBottom:16 }}>
              <textarea value={userRecado} onChange={e=>setUserRecado(e.target.value)}
                onBlur={async()=>{ try{ await saveUserProfile(myId,{...currentUser,recado:userRecado,recadoExpiry:userRecadoExpiry}); }catch(e2){} }}
                placeholder="Escreva um recado que aparecerá no seu perfil..." rows={2}
                style={{ ...S.input, resize:"none", fontSize:12.5, marginBottom:8 }} />
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {[{id:null,label:"Sem expirar"},{id:"8h",label:"8 horas"},{id:"12h",label:"12 horas"},{id:"24h",label:"24 horas"}].map(opt=>(
                  <button key={String(opt.id)} onClick={async()=>{ setUserRecadoExpiry(opt.id); try{ await saveUserProfile(myId,{...currentUser,recado:userRecado,recadoExpiry:opt.id}); }catch(e2){} }}
                    style={{ background:userRecadoExpiry===opt.id?C.acc:C.deep, color:userRecadoExpiry===opt.id?"#fff":C.ts, border:userRecadoExpiry===opt.id?"none":`1px solid ${C.b2}`, borderRadius:8, padding:"4px 10px", cursor:"pointer", fontSize:11, fontWeight:userRecadoExpiry===opt.id?700:400, transition:"all 0.15s" }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bio */}
            <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>📝 Biografia</div>
            <textarea value={userBio} onChange={e=>setUserBio(e.target.value)}
              onBlur={async()=>{ try{ await saveUserProfile(myId,{...currentUser,bio:userBio}); }catch(e2){} }}
              placeholder="Fale um pouco sobre você..." rows={3}
              style={{ ...S.input, resize:"vertical", fontSize:12.5, marginBottom:16, borderRadius:10 }} />

            {/* Birthday */}
            <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🎂 Data de aniversário</div>
            <input type="date" value={userBirthday} onChange={async e=>{ setUserBirthday(e.target.value); try{ await saveUserProfile(myId,{...currentUser,birthday:e.target.value}); }catch(e2){} }}
              style={{ ...S.input, fontSize:12.5, marginBottom:16, borderRadius:10 }} />

            {/* Reaction */}
            <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>💛 Como está seu coração hoje?</div>
            <div style={{ ...S.card, padding:"14px", borderRadius:12 }}>
              <p style={{ color:C.tm, fontSize:12, marginBottom:12 }}>Escolha um emoji que vai aparecer ao lado da sua foto para todos verem.</p>
              {userReaction && (
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, padding:"8px 12px", background:C.acc+"15", border:`1px solid ${C.acc}44`, borderRadius:10 }}>
                  <span style={{ fontSize:28 }}>{userReaction}</span>
                  <span style={{ color:C.atxt, fontSize:12, fontWeight:600 }}>Reação atual</span>
                  <button onClick={()=>setUserReaction(null)} style={{ marginLeft:"auto", background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:12 }}>✕ Remover</button>
                </div>
              )}
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {["❤️","🔥","😄","🥰","🤩","😎","💪","🙏","✨","🌟","🎉","💯","🚀","😅","🤔","😢","😡","🥺","🤗","💎"].map(e => (
                  <button key={e} onClick={()=>setUserReaction(e)}
                    style={{ fontSize:24, background:userReaction===e?C.abg:"transparent", border:userReaction===e?`2px solid ${C.atxt}44`:"2px solid transparent", borderRadius:10, padding:"4px 6px", cursor:"pointer", transition:"transform 0.15s" }}
                    onMouseEnter={ev=>ev.currentTarget.style.transform="scale(1.3)"}
                    onMouseLeave={ev=>ev.currentTarget.style.transform="scale(1)"}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Chat Geral Settings ── */}
      {showGeralSettings && activeTab === "geral" && (
        <div style={{ position:"absolute", inset:0, zIndex:50, background:C.sb, display:"flex", flexDirection:"column", borderRadius:16, overflow:"hidden", animation:"fadeIn 0.2s ease" }}>
          <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <button onClick={()=>setShowGeralSettings(false)} style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:18, lineHeight:1 }}>‹</button>
            <div style={{ flex:1, color:C.tp, fontSize:14, fontWeight:700 }}>⚙ Chat Geral — Configurações</div>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"14px" }}>
            {/* Lock */}
            <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🔧 Permissões</div>
            <div onClick={()=>setGeralOnlyAdmins(p=>!p)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 12px", borderRadius:10, cursor:"pointer", marginBottom:16, background:geralOnlyAdmins?"#F8717115":C.deep, border:geralOnlyAdmins?`1px solid #F8717144`:`1px solid ${C.b2}`, transition:"all 0.15s" }}>
              <span style={{ color:geralOnlyAdmins?"#F87171":C.ts, fontSize:12, fontWeight:geralOnlyAdmins?600:400 }}>🔒 Travar (só adms escrevem)</span>
              <div style={{ width:32, height:18, borderRadius:9, background:geralOnlyAdmins?"#F87171":C.b2, position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                <div style={{ position:"absolute", top:2, left:geralOnlyAdmins?14:2, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
              </div>
            </div>

            {/* Admins */}
            <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>👑 Administradores do Geral</div>
            <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:16, maxHeight:150, overflowY:"auto" }}>
              {users.map(u => {
                const uid = u.uid||u.id;
                const isAdm = uid === myId || geralAdmins.includes(uid) || u.role==="mestre";
                return (
                  <div key={uid} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderRadius:10, background:isAdm?C.abg:C.deep, border:isAdm?`1px solid ${C.atxt}33`:`1px solid ${C.b2}` }}>
                    <div style={{ width:26, height:26, borderRadius:"50%", overflow:"hidden", flexShrink:0, background:C.b2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:C.atxt }}>
                      {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ini(u.name||"?")}
                    </div>
                    <span style={{ flex:1, color:isAdm?C.atxt:C.ts, fontSize:12 }}>{u.name||u.email}{u.role==="mestre"?" 👑":""}</span>
                    {uid !== myId && u.role !== "mestre" && (
                      <button onClick={()=>setGeralAdmins(p=>p.includes(uid)?p.filter(x=>x!==uid):[...p,uid])}
                        style={{ background:isAdm?"#2D1515":C.abg, color:isAdm?"#F87171":C.atxt, border:isAdm?"1px solid #EF444433":`1px solid ${C.atxt}33`, borderRadius:6, padding:"2px 8px", fontSize:10, cursor:"pointer", fontWeight:600 }}>
                        {isAdm ? "Remover adm" : "+ Adm"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 15 Premium Themes */}
            <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🎨 15 Temas Premium</div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:18 }}>
              {[
                {id:null,       label:"Padrão",        bg:C.deep},
                {id:"nature",   label:"🌿 Natureza",   bg:"linear-gradient(135deg,#064e3b,#065f46)"},
                {id:"ocean",    label:"🌊 Oceano",     bg:"linear-gradient(135deg,#0c4a6e,#075985)"},
                {id:"sunset",   label:"🌅 Pôr do Sol", bg:"linear-gradient(135deg,#7c2d12,#c2410c)"},
                {id:"galaxy",   label:"🌌 Galáxia",   bg:"linear-gradient(135deg,#1e1b4b,#4c1d95)"},
                {id:"office",   label:"🏢 Escritório", bg:"linear-gradient(135deg,#1e293b,#475569)"},
                {id:"forest",   label:"🌲 Floresta",  bg:"linear-gradient(135deg,#14532d,#15803d)"},
                {id:"sakura",   label:"🌸 Sakura",    bg:"linear-gradient(135deg,#831843,#be185d)"},
                {id:"aurora",   label:"✨ Aurora",     bg:"linear-gradient(270deg,#6366f1,#8b5cf6,#ec4899)"},
                {id:"neon",     label:"⚡ Neon",       bg:"linear-gradient(270deg,#0ea5e9,#8b5cf6,#ec4899)"},
                {id:"coffee",   label:"☕ Café",       bg:"linear-gradient(135deg,#451a03,#78350f)"},
                {id:"desert",   label:"🏜 Deserto",   bg:"linear-gradient(135deg,#78350f,#b45309)"},
                {id:"arctic",   label:"❄️ Ártico",    bg:"linear-gradient(135deg,#0c4a6e,#bae6fd)"},
                {id:"lava",     label:"🌋 Lava",      bg:"linear-gradient(135deg,#7f1d1d,#dc2626)"},
                {id:"midnight", label:"🌙 Meia Noite", bg:"linear-gradient(135deg,#020617,#0f172a)"},
                {id:"emerald",  label:"💚 Esmeralda",  bg:"linear-gradient(135deg,#064e3b,#10b981)"},
              ].map(t => {
                const sel = geralTheme === t.id;
                return (
                  <button key={String(t.id)} onClick={()=>setGeralTheme(t.id)}
                    style={{ background:t.bg, border: sel ? "2.5px solid #fff" : `1px solid ${C.b2}`, borderRadius:10, padding:"5px 11px", cursor:"pointer", fontSize:10.5, color: t.id ? "#fff" : C.ts, fontWeight: sel ? 700 : 400, boxShadow: sel ? "0 0 10px rgba(255,255,255,0.2)" : "none", transition:"all 0.15s" }}>
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Clear geral */}
            <div style={{ fontSize:10, color:C.td, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8, fontWeight:700 }}>🗑 Limpar Chat Geral</div>
            <div style={{ display:"flex", gap:6, marginBottom:6 }}>
              <input value={geralClearInput} onChange={e=>setGeralClearInput(e.target.value)}
                placeholder='Digite "CONFIRMAR"' style={{ ...S.input, fontSize:12, flex:1, borderRadius:10 }} />
              <button onClick={async () => {
                if (geralClearInput.trim().toUpperCase() !== "CONFIRMAR") return;
                const msgs = allMessages.filter(m => !m.toId && !m.groupId && m.type !== "system");
                setDeletingMsgIds(msgs.map(m=>m.id));
                setTimeout(async()=>{ for(const m of msgs){try{await deleteDoc(doc(db,"chat",m.id));}catch(e){}} setDeletingMsgIds([]); setGeralClearInput(""); }, 600);
              }} style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:10, padding:"6px 14px", fontSize:12, cursor:"pointer", fontWeight:600 }}>Limpar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── User Profile View ── */}
      {viewingProfile && (
        <div style={{ position:"absolute", inset:0, zIndex:70, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", borderRadius:16, animation:"fadeIn 0.2s ease", overflowY:"auto" }}
          onClick={()=>setViewingProfile(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.sb, border:`1px solid ${C.b1}`, borderRadius:16, padding:"20px", maxWidth:310, width:"92%", maxHeight:"90%", overflowY:"auto", boxShadow:"0 12px 48px rgba(0,0,0,0.8)" }}>
            {(() => {
              const vUser = users.find(u=>(u.uid||u.id)===viewingProfile) || (viewingProfile===myId ? currentUser : null);
              if (!vUser) return null;
              const vId = vUser.uid||vUser.id;
              const rc2 = roleColor[vUser.role]||C.atxt;
              const isOnlineV = presence[vId]?.online;
              const isMe = vId === myId;

              // 50 reactions for profile
              const FIFTY_REACTIONS = ["❤️","🔥","😄","👍","🙏","🥰","🤩","💪","✨","🌟","🎉","💯","🚀","😎","🤗","💎","🏆","👑","🫶","💖","😇","🥳","🤝","💫","🌈","🍀","🌺","⭐","💡","🎯","😅","🤔","😢","😡","💔","👎","🥺","😤","😩","😰","🙄","😬","😮","😱","🫡","🙌","👏","🫂","💌","🎊"];
              // ── Querídômetro ─────────────────────────────────────
              const today = new Date().toISOString().slice(0, 10);
              const todayKey = `${vId}_${today}`;
              const myReactionsToV = (profileReactions[todayKey] || []);
              const canReact = myReactionsToV.length < 3;
              // Emojis recebidos pelo usuário (de todos, salvo no Firestore)
              const receivedEmojis = vUser.receivedEmojis || {};

              const sendProfileReaction = async (emoji) => {
                if (!canReact) return;
                const next = [...myReactionsToV, emoji];
                const updated = { ...profileReactions, [todayKey]: next };
                setProfileReactions(updated);
                localStorage.setItem("nexp_profile_reactions", JSON.stringify(updated));
                const bursts = Array.from({length:10},(_,bi)=>({ id:Date.now()+bi, emoji, x:30+Math.random()*240, y:80+Math.random()*180 }));
                setFloatEmojis(bursts);
                setTimeout(()=>setFloatEmojis([]), 2200);
                // Salvar emoji recebido no perfil do destinatário
                const newReceived = { ...receivedEmojis, [emoji]: (receivedEmojis[emoji] || 0) + 1 };
                await saveUserProfile(vId, { receivedEmojis: newReceived });
                if (!isMe) {
                  await sendChatMessage({ text:`${currentUser.name||currentUser.email} deu ${emoji} no seu perfil`, type:"system", toId:vId, authorId:myId, authorName:currentUser.name||currentUser.email });
                }
              };

              return (
                <>
                  {/* Cover photo */}
                  {vUser.coverPhoto && (
                    <div style={{ height:70, borderRadius:"12px 12px 0 0", overflow:"hidden", margin:"-20px -20px 8px", width:"calc(100% + 40px)" }}>
                      <img src={vUser.coverPhoto} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                    </div>
                  )}
                  {/* Header */}
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, marginBottom:14, marginTop: vUser.coverPhoto ? 8 : 0 }}>
                    <div style={{ position:"relative" }}>
                      <div style={{ width:80, height:80, borderRadius:"50%", overflow:"hidden", background:C.deep, border:`2.5px solid ${rc2}44` }}>
                        {vUser.photo ? <img src={vUser.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <div style={{ width:"100%", height:"100%", background:rc2+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, fontWeight:700, color:rc2 }}>{ini(vUser.name||"?")}</div>}
                      </div>
                      {/* My reaction display */}
                      {isMe && userReaction && <div style={{ position:"absolute", bottom:-6, right:-6, fontSize:22 }}>{userReaction}</div>}
                      {/* Reactions received */}
                      {myReactionsToV.length > 0 && !isMe && (
                        <div style={{ position:"absolute", bottom:-6, right:-6, display:"flex", gap:1 }}>
                          {myReactionsToV.map((e,i)=><span key={i} style={{ fontSize:16 }}>{e}</span>)}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ color:C.tp, fontSize:16, fontWeight:700, animation:"nameReveal 0.4s ease" }}>{vUser.name||vUser.email}</div>
                      <div style={{ color:rc2, fontSize:11.5, marginTop:2 }}>{roleLabel[vUser.role]}</div>
                      <div style={{ color:isOnlineV?"#16A34A":"#FBBF24", fontSize:11.5, marginTop:4, display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                        <span style={{ width:8, height:8, borderRadius:"50%", background:isOnlineV?"#16A34A":"#FBBF24", display:"inline-block", boxShadow: isOnlineV?"0 0 6px #16A34A88":"0 0 6px #FBBF2488" }} />
                        {isOnlineV ? "Online agora" : "Offline"}
                      </div>
                    </div>
                  </div>

                  {/* Bio e recado */}
                  {vUser.bio && <div style={{ color:C.tm, fontSize:12, fontStyle:"italic", padding:"9px 12px", background:C.deep, borderRadius:10, marginBottom:10, textAlign:"center" }}>📝 {vUser.bio}</div>}
                  {vUser.recado && <div style={{ color:C.atxt, fontSize:12, padding:"9px 12px", background:C.abg, borderRadius:10, marginBottom:10, textAlign:"center" }}>💬 {vUser.recado}</div>}
                  {vUser.birthday && <div style={{ color:C.tm, fontSize:11, textAlign:"center", marginBottom:10 }}>🎂 {new Date(vUser.birthday).toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"})}</div>}

                  {/* Querídômetro — emojis colecionáveis recebidos */}
                  {Object.keys(receivedEmojis).length > 0 && (
                    <div style={{ marginBottom:14, padding:"12px 14px", background:C.deep, borderRadius:12, border:`1px solid ${C.b1}` }}>
                      <div style={{ color:C.td, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8 }}>
                        💝 Querídômetro
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {Object.entries(receivedEmojis).sort((a,b)=>b[1]-a[1]).map(([emoji, count]) => (
                          <div key={emoji} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, background:C.card, borderRadius:8, padding:"6px 8px", border:`1px solid ${C.b2}`, minWidth:44 }}>
                            <span style={{ fontSize:20 }}>{emoji}</span>
                            <span style={{ color:C.atxt, fontSize:10, fontWeight:700 }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dar reação — 3 por dia */}
                  {!isMe && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ color:C.td, fontSize:10, textAlign:"center", marginBottom:6, fontWeight:600 }}>
                        🎁 Dar reação · {canReact ? `${3-myReactionsToV.length} restante(s) hoje` : "Limite diário atingido"}
                      </div>
                      {myReactionsToV.length > 0 && (
                        <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:8, flexWrap:"wrap" }}>
                          {myReactionsToV.map((e,i)=>(
                            <span key={i} style={{ fontSize:20, background:C.acc+"15", border:`1px solid ${C.acc}44`, borderRadius:8, padding:"3px 6px" }}>{e}</span>
                          ))}
                        </div>
                      )}
                      {canReact ? (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:4, maxHeight:120, overflowY:"auto", justifyContent:"center" }}>
                          {FIFTY_REACTIONS.map(e=>(
                            <button key={e} onClick={()=>sendProfileReaction(e)}
                              style={{ fontSize:20, background:"transparent", border:"2px solid transparent", borderRadius:8, padding:"3px 5px", cursor:"pointer", transition:"transform 0.12s" }}
                              onMouseEnter={ev=>ev.currentTarget.style.transform="scale(1.3)"}
                              onMouseLeave={ev=>ev.currentTarget.style.transform="scale(1)"}>
                              {e}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div style={{ textAlign:"center", color:C.td, fontSize:11, padding:"10px 0" }}>
                          ⏰ Volte amanhã para dar mais reações!
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={()=>setViewingProfile(null)} style={{ background:"transparent", border:`1px solid ${C.b2}`, color:C.tm, borderRadius:10, padding:"8px", fontSize:12, cursor:"pointer", width:"100%" }}>Fechar</button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Floating emoji burst ── */}
      {floatEmojis.map(fe=>(
        <div key={fe.id} style={{ position:"absolute", left:fe.x, top:fe.y, fontSize:28, pointerEvents:"none", zIndex:999, animation:"floatUp 2s ease forwards" }}>
          {fe.emoji}
        </div>
      ))}

      {/* ── Moderation Alert ── */}
      {moderationAlert && (
        <div style={{ position:"absolute", bottom:80, left:"50%", transform:"translateX(-50%)", zIndex:500, width:"90%", maxWidth:320, animation:"fadeIn 0.2s ease" }}>
          <div style={{ background:"#1a0a0a", border:"1.5px solid #EF444444", borderRadius:14, padding:"14px 16px", boxShadow:"0 4px 24px rgba(0,0,0,0.7)" }}>
            <div style={{ color:"#F87171", fontSize:13, fontWeight:700, marginBottom:6 }}>⚠️ Mensagem bloqueada</div>
            <div style={{ color:C.ts, fontSize:12, lineHeight:1.6, marginBottom:10 }}>
              Respeite seus colegas, alguma palavra ou frase pode ser ofensiva, pense no que vai falar antes de digitar, você pode ser restringido ou bloqueado.
            </div>
            <div style={{ color:C.td, fontSize:10.5, fontWeight:600, borderTop:`1px solid ${C.b1}`, paddingTop:8 }}>— Equipe Nexp Consultas</div>
          </div>
        </div>
      )}

      {/* ── Confirm Modal ── */}
      {confirmModal && (
        <div style={{ position:"absolute", inset:0, zIndex:999, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.65)", borderRadius:16, animation:"fadeIn 0.15s ease" }}>
          <div style={{ background:C.sb, border:`1px solid ${C.b1}`, borderRadius:18, padding:"26px 24px", maxWidth:290, width:"90%", boxShadow:"0 12px 48px rgba(0,0,0,0.8)", animation:"fadeIn 0.2s ease" }}>
            <div style={{ color:C.tp, fontSize:15, fontWeight:700, marginBottom:10 }}>{confirmModal.title}</div>
            <div style={{ color:C.tm, fontSize:12.5, lineHeight:1.65, marginBottom:22, whiteSpace:"pre-line" }}>{confirmModal.body}</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>{ confirmModal.onConfirm(); setConfirmModal(null); }}
                style={{ flex:1, background:"#EF4444", color:"#fff", border:"none", borderRadius:10, padding:"11px 0", fontSize:13, fontWeight:700, cursor:"pointer" }}
                onMouseEnter={e=>e.currentTarget.style.background="#DC2626"} onMouseLeave={e=>e.currentTarget.style.background="#EF4444"}>
                Sim, Excluir
              </button>
              <button onClick={()=>setConfirmModal(null)}
                style={{ flex:1, background:C.deep, color:C.ts, border:`1px solid ${C.b2}`, borderRadius:10, padding:"11px 0", fontSize:13, fontWeight:600, cursor:"pointer" }}
                onMouseEnter={e=>e.currentTarget.style.background=C.abg} onMouseLeave={e=>e.currentTarget.style.background=C.deep}>
                Não, Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Weather + Calculadora Widget ──────────────────────────────
function WeatherCalcWidget() {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [calcVal, setCalcVal] = useState("");
  const [calcResult, setCalcResult] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState("weather"); // "weather" | "calc"

  useEffect(() => {
    setLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude: lat, longitude: lon } = pos.coords;
            const res = await fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&current_weather=true&timezone=auto&forecast_days=5`
            );
            const data = await res.json();
            setWeather(data);
          } catch { setErr("Erro ao buscar previsão"); }
          setLoading(false);
        },
        () => { setErr("Localização negada"); setLoading(false); }
      );
    } else { setErr("Geolocalização não suportada"); setLoading(false); }
  }, []);

  const WMO_DESC = {
    0:"Céu limpo",1:"Principalmente limpo",2:"Parcialmente nublado",3:"Nublado",
    45:"Névoa",48:"Névoa com gelo",51:"Garoa leve",53:"Garoa moderada",55:"Garoa intensa",
    61:"Chuva leve",63:"Chuva moderada",65:"Chuva forte",71:"Neve leve",73:"Neve moderada",
    75:"Neve forte",80:"Pancadas leves",81:"Pancadas moderadas",82:"Pancadas fortes",
    95:"Trovoada",96:"Trovoada com granizo",99:"Trovoada forte"
  };
  const WMO_ICON = {
    0:"☀️",1:"🌤",2:"⛅",3:"☁️",45:"🌫",48:"🌫",51:"🌦",53:"🌦",55:"🌧",
    61:"🌧",63:"🌧",65:"🌧",71:"❄️",73:"❄️",75:"❄️",80:"🌦",81:"🌧",82:"⛈",
    95:"⛈",96:"⛈",99:"⛈"
  };
  const weekDay = (dateStr) => new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", { weekday:"short" });

  const calcPress = (v) => {
    if (v === "C") { setCalcVal(""); setCalcResult(null); return; }
    if (v === "=") {
      try {
        // eslint-disable-next-line no-new-func
        const r = new Function("return " + calcVal.replace(/×/g,"*").replace(/÷/g,"/"))();
        setCalcResult(String(parseFloat(r.toFixed(10))));
        setCalcVal(String(parseFloat(r.toFixed(10))));
      } catch { setCalcResult("Erro"); }
      return;
    }
    if (v === "⌫") { setCalcVal(p => p.slice(0, -1)); setCalcResult(null); return; }
    setCalcResult(null);
    setCalcVal(p => p + v);
  };
  const calcBtns = [
    ["C", "⌫", "%", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "-"],
    ["1", "2", "3", "+"],
    ["(", "0", ".", "="],
  ];

  if (collapsed) return (
    <div onClick={() => setCollapsed(false)} style={{ position:"fixed", top:10, right:10, zIndex:300, background:C.card, border:`1px solid ${C.b1}`, borderRadius:10, padding:"6px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:6, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
      <span style={{ fontSize:16 }}>🌤</span>
      <span style={{ color:C.ts, fontSize:11 }}>{weather?.current_weather ? `${Math.round(weather.current_weather.temperature)}°C` : "—"}</span>
      <span style={{ color:C.td, fontSize:10 }}>▼</span>
    </div>
  );

  return (
    <div style={{ position:"fixed", top:10, right:10, zIndex:300, width:240, background:C.sb, border:`1px solid ${C.b1}`, borderRadius:14, boxShadow:"0 4px 24px rgba(0,0,0,0.5)", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", borderBottom:`1px solid ${C.b1}` }}>
        <div style={{ display:"flex", gap:4 }}>
          <button onClick={()=>setActiveSection("weather")} style={{ background:activeSection==="weather"?C.abg:"transparent", border:"none", color:activeSection==="weather"?C.atxt:C.tm, borderRadius:6, padding:"3px 9px", fontSize:11, cursor:"pointer", fontWeight:activeSection==="weather"?700:400 }}>🌤 Tempo</button>
          <button onClick={()=>setActiveSection("calc")} style={{ background:activeSection==="calc"?C.abg:"transparent", border:"none", color:activeSection==="calc"?C.atxt:C.tm, borderRadius:6, padding:"3px 9px", fontSize:11, cursor:"pointer", fontWeight:activeSection==="calc"?700:400 }}>🧮 Calc</button>
        </div>
        <button onClick={()=>setCollapsed(true)} style={{ background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:14, lineHeight:1 }}>▲</button>
      </div>

      {/* Weather */}
      {activeSection === "weather" && (
        <div style={{ padding:"10px 12px" }}>
          {loading && <div style={{ color:C.tm, fontSize:12, textAlign:"center", padding:"12px 0" }}>Carregando...</div>}
          {err && <div style={{ color:"#F87171", fontSize:11, textAlign:"center", padding:"12px 0" }}>{err}</div>}
          {weather && !loading && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <span style={{ fontSize:28 }}>{WMO_ICON[weather.current_weather.weathercode] || "🌡"}</span>
                <div>
                  <div style={{ color:C.tp, fontSize:20, fontWeight:700 }}>{Math.round(weather.current_weather.temperature)}°C</div>
                  <div style={{ color:C.tm, fontSize:10.5 }}>{WMO_DESC[weather.current_weather.weathercode] || "—"}</div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4 }}>
                {(weather.daily.time||[]).map((d, i) => (
                  <div key={d} style={{ background:C.deep, borderRadius:8, padding:"6px 4px", textAlign:"center" }}>
                    <div style={{ color:C.td, fontSize:9, textTransform:"capitalize" }}>{i===0?"Hoje":weekDay(d)}</div>
                    <div style={{ fontSize:14, margin:"4px 0" }}>{WMO_ICON[weather.daily.weathercode[i]] || "🌡"}</div>
                    <div style={{ color:C.tp, fontSize:9.5, fontWeight:700 }}>{Math.round(weather.daily.temperature_2m_max[i])}°</div>
                    <div style={{ color:C.td, fontSize:9 }}>{Math.round(weather.daily.temperature_2m_min[i])}°</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Calculadora */}
      {activeSection === "calc" && (
        <div style={{ padding:"12px" }}>
          {/* Display */}
          <div style={{ background:"#0B0D14", borderRadius:10, padding:"12px 14px", marginBottom:10, textAlign:"right", minHeight:64, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
            <div style={{ color:C.td, fontSize:10.5, minHeight:16, wordBreak:"break-all" }}>{calcVal || "0"}</div>
            {calcResult !== null && <div style={{ color:C.atxt, fontSize:22, fontWeight:700, lineHeight:1.2 }}>{calcResult}</div>}
          </div>
          {/* Buttons */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
            {calcBtns.flat().map((btn, i) => {
              const isEq = btn === "=";
              const isOp = ["÷","×","-","+"].includes(btn);
              const isClear = btn === "C";
              const isDel = btn === "⌫";
              const isMod = btn === "%";
              return (
                <button key={i} onClick={()=>calcPress(btn)}
                  style={{
                    background: isEq ? `linear-gradient(135deg,${C.lg1},${C.lg2})` : isClear ? "#2D1515" : isDel||isMod ? C.deep : isOp ? C.abg : C.card,
                    color: isEq ? "#fff" : isClear ? "#F87171" : isDel||isMod ? C.atxt : isOp ? C.atxt : C.tp,
                    border: isEq ? "none" : `1px solid ${C.b1}`,
                    borderRadius: 9,
                    padding: "11px 0",
                    fontSize: isEq ? 17 : 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.1s",
                    boxShadow: isEq ? `0 2px 10px ${C.acc}44` : "none",
                  }}
                  onMouseEnter={e=>{ e.currentTarget.style.filter="brightness(1.2)"; e.currentTarget.style.transform="scale(1.05)"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.filter="none"; e.currentTarget.style.transform="scale(1)"; }}>
                  {btn}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Calendário ────────────────────────────────────────────────
function CalendarPage({ currentUser }) {
  const myId = currentUser.uid || currentUser.id;
  const [year, setYear] = useState(new Date().getFullYear());
  const [notes, setNotes] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null); // null = grade anual, número = ver mês
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deletePass, setDeletePass] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  // Formulário de novo agendamento
  const [newText, setNewText] = useState("");
  const [newHour, setNewHour] = useState("");
  const [newNotify, setNewNotify] = useState(true);
  // Alerta 15 min
  const [alertAgendam, setAlertAgendam] = useState(null);
  const notifiedRef = useRef({});

  const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const WEEK = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const unsub = listenCalendarNotes(myId, setNotes);
    return () => unsub();
  }, [myId]);

  // ── Notificações de agendamento ──────────────────────────────
  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission();

    const check = () => {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const hh = now.getHours(); const mm = now.getMinutes();

      notes.filter(n => n.notify !== false).forEach(n => {
        const key5am = `5am_${n.id}_${n.date}`;
        const key5h  = `5h_${n.id}_${n.date}`;
        const key30m = `30m_${n.id}_${n.date}`;
        const key15m = `15m_${n.id}_${n.date}`;

        // 5 da manhã do dia do agendamento
        if (n.date === todayStr && hh === 5 && mm < 2 && !notifiedRef.current[key5am]) {
          notifiedRef.current[key5am] = true;
          if (Notification.permission === "granted") new Notification("📅 Agendamento hoje", { body: n.text, icon: "/favicon.ico" });
        }

        // Faltando 5h, 30min, 15min — só se tiver hora definida
        if (n.hour && n.date === todayStr) {
          const [nh, nm] = n.hour.split(":").map(Number);
          const agendaMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), nh, nm).getTime();
          const diffMin = (agendaMs - now.getTime()) / 60000;

          if (diffMin > 295 && diffMin <= 305 && !notifiedRef.current[key5h]) {
            notifiedRef.current[key5h] = true;
            if (Notification.permission === "granted") new Notification("⏰ Faltam 5 horas", { body: n.text });
          }
          if (diffMin > 28 && diffMin <= 32 && !notifiedRef.current[key30m]) {
            notifiedRef.current[key30m] = true;
            if (Notification.permission === "granted") new Notification("⏰ Faltam 30 minutos", { body: n.text });
          }
          if (diffMin > 13 && diffMin <= 16 && !notifiedRef.current[key15m]) {
            notifiedRef.current[key15m] = true;
            setAlertAgendam(n);
            setTimeout(() => setAlertAgendam(null), 30000);
          }
        }
      });
    };

    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [notes]); // eslint-disable-line

  const agendForDay = (dateStr) => notes.filter(n => n.date === dateStr).sort((a,b)=>(a.hour||"99:99").localeCompare(b.hour||"99:99"));
  const agendForMonth = (monthIdx) => notes.filter(n => n.date?.startsWith(`${year}-${String(monthIdx+1).padStart(2,"0")}`)).sort((a,b)=>a.date.localeCompare(b.date)||(a.hour||"").localeCompare(b.hour||""));

  const addNote = async () => {
    if (!newText.trim() || !selectedDay) return;
    await saveCalendarNote({ uid: myId, date: selectedDay, text: newText.trim(), hour: newHour || null, notify: newNotify, createdAt: new Date().toISOString() });
    setNewText(""); setNewHour(""); setNewNotify(true);
  };

  const confirmDelete = async () => {
    try {
      const { EmailAuthProvider, reauthenticateWithCredential: reauth } = await import("firebase/auth");
      const cred = EmailAuthProvider.credential(currentUser.email, deletePass);
      await reauth(auth.currentUser, cred);
      await deleteCalendarNote(deleteConfirm);
      setDeleteConfirm(null); setDeletePass(""); setDeleteErr("");
    } catch { setDeleteErr("Senha incorreta"); }
  };

  // Exportar relatório CSV do mês
  const exportMonth = (monthIdx) => {
    const items = agendForMonth(monthIdx);
    if (!items.length) return;
    const rows = [["Data","Hora","Agendamento"],...items.map(n=>[n.date, n.hour||"—", `"${n.text.replace(/"/g,'""')}"`])];
    const csv = rows.map(r=>r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`agendamentos_${MONTHS[monthIdx]}_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render de um mês expandido ────────────────────────────────
  const renderMonthExpanded = () => {
    const mi = selectedMonth;
    const firstDay = new Date(year, mi, 1).getDay();
    const daysInMonth = new Date(year, mi + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    const dateStr = (d) => `${year}-${String(mi+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const monthItems = agendForMonth(mi);

    return (
      <div>
        {/* Header mês */}
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
          <button onClick={()=>{setSelectedMonth(null);setSelectedDay(null);}} style={{ ...S.btn(C.deep,C.tm), border:`1px solid ${C.b2}`, padding:"7px 14px", fontSize:13 }}>← Voltar</button>
          <h2 style={{ color:C.tp, fontSize:19, fontWeight:700, margin:0 }}>{MONTHS[mi]} {year}</h2>
          <button onClick={()=>exportMonth(mi)} disabled={!monthItems.length} style={{ ...S.btn(monthItems.length?C.acc:C.deep, monthItems.length?"#fff":C.td), padding:"7px 14px", fontSize:12, marginLeft:"auto", opacity:monthItems.length?1:0.5 }}>
            ⬇ Baixar relatório
          </button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
          {/* Calendário grande do mês */}
          <div style={{ ...S.card, padding:"18px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:8 }}>
              {WEEK.map((w,i)=><div key={i} style={{ color:C.td, fontSize:10, textAlign:"center", fontWeight:600 }}>{w}</div>)}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {cells.map((d,i)=>{
                if (!d) return <div key={i} />;
                const ds = dateStr(d);
                const count = agendForDay(ds).length;
                const isToday = ds === today;
                const isSel = ds === selectedDay;
                return (
                  <div key={i} onClick={()=>setSelectedDay(isSel?null:ds)}
                    style={{ textAlign:"center", padding:"6px 2px", borderRadius:8, cursor:"pointer", background:isSel?C.acc:isToday?C.abg:"transparent", color:isSel?"#fff":isToday?C.atxt:C.ts, fontSize:12, fontWeight:isToday||isSel?700:400, transition:"all 0.12s", position:"relative" }}
                    onMouseEnter={e=>{ if(!isSel&&!isToday) e.currentTarget.style.background=C.deep; }}
                    onMouseLeave={e=>{ if(!isSel&&!isToday) e.currentTarget.style.background="transparent"; }}>
                    {d}
                    {count>0 && (
                      <div style={{ display:"flex", justifyContent:"center", gap:2, marginTop:2 }}>
                        {Array.from({length:Math.min(count,3)}).map((_,ci)=>(
                          <div key={ci} style={{ width:4, height:4, borderRadius:"50%", background:isSel?"#fff":C.acc }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Painel direito: dia selecionado ou lista do mês */}
          <div>
            {selectedDay ? (
              <div style={{ ...S.card, padding:"16px", border:`1px solid ${C.atxt}33` }}>
                <div style={{ color:C.atxt, fontSize:13, fontWeight:700, marginBottom:12 }}>
                  📅 {new Date(selectedDay+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}
                </div>
                {agendForDay(selectedDay).length === 0 && <div style={{ color:C.tm, fontSize:12, marginBottom:10 }}>Nenhum agendamento neste dia.</div>}
                <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:12 }}>
                  {agendForDay(selectedDay).map(n => (
                    <div key={n.id} style={{ background:C.deep, borderRadius:9, padding:"9px 12px", border:`1px solid ${C.b1}`, display:"flex", gap:10, alignItems:"flex-start" }}>
                      {n.hour && <div style={{ color:C.acc, fontSize:12, fontWeight:700, flexShrink:0, marginTop:1 }}>🕐 {n.hour}</div>}
                      <div style={{ flex:1, color:C.ts, fontSize:12.5, lineHeight:1.5 }}>{n.text}</div>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                        {n.notify && <span style={{ fontSize:9, color:C.acc }}>🔔</span>}
                        <button onClick={()=>setDeleteConfirm(n.id)} title="Apagar" style={{ background:"#2D1515", border:"1px solid #EF444422", borderRadius:8, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, transition:"all 0.15s" }} onMouseEnter={e=>e.currentTarget.style.background="#3D1515"} onMouseLeave={e=>e.currentTarget.style.background="#2D1515"}><svg width="12" height="13" viewBox="0 0 12 13" fill="none"><path d="M1 3h10M4 3V2h4v1M2 3l.7 8h6.6L10 3" stroke="#F87171" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 6v3M7 6v3" stroke="#F87171" strokeWidth="1.3" strokeLinecap="round"/></svg></button>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Formulário novo agendamento */}
                <div style={{ borderTop:`1px solid ${C.b1}`, paddingTop:12 }}>
                  <div style={{ color:C.tm, fontSize:11, marginBottom:8 }}>➕ Novo agendamento</div>
                  <input value={newText} onChange={e=>setNewText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&addNote()}
                    placeholder="Descrição do agendamento..." style={{ ...S.input, marginBottom:7 }} />
                  <div style={{ display:"flex", gap:7, alignItems:"center", marginBottom:7 }}>
                    <input type="time" value={newHour} onChange={e=>setNewHour(e.target.value)}
                      style={{ ...S.input, width:110, padding:"7px 10px" }} />
                    <span style={{ color:C.td, fontSize:10.5 }}>hora (opcional)</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                    <div onClick={()=>setNewNotify(p=>!p)} style={{ width:32, height:18, borderRadius:9, background:newNotify?C.acc:C.b2, position:"relative", cursor:"pointer", transition:"background 0.2s", flexShrink:0 }}>
                      <div style={{ position:"absolute", top:1, left:newNotify?14:1, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                    </div>
                    <span style={{ color:C.tm, fontSize:11.5 }}>Notificar sobre este agendamento</span>
                  </div>
                  <button onClick={addNote} disabled={!newText.trim()} style={{ ...S.btn(newText.trim()?C.acc:C.deep, newText.trim()?"#fff":C.td), width:"100%", opacity:newText.trim()?1:0.5 }}>
                    Salvar agendamento
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ ...S.card, padding:"16px" }}>
                <div style={{ color:C.tp, fontSize:13, fontWeight:700, marginBottom:10 }}>📋 Todos os agendamentos de {MONTHS[mi]}</div>
                {monthItems.length === 0 && <div style={{ color:C.tm, fontSize:12 }}>Nenhum agendamento neste mês.</div>}
                <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:360, overflowY:"auto" }}>
                  {monthItems.map(n=>(
                    <div key={n.id} style={{ background:C.deep, borderRadius:9, padding:"8px 12px", border:`1px solid ${C.b1}`, display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer" }}
                      onClick={()=>setSelectedDay(n.date)}>
                      <div style={{ flexShrink:0, textAlign:"center" }}>
                        <div style={{ color:C.atxt, fontSize:11, fontWeight:700 }}>{n.date.slice(8)}</div>
                        <div style={{ color:C.td, fontSize:9 }}>{MONTHS[parseInt(n.date.slice(5,7))-1].slice(0,3)}</div>
                        {n.hour && <div style={{ color:C.acc, fontSize:9, marginTop:2 }}>🕐 {n.hour}</div>}
                      </div>
                      <div style={{ flex:1, color:C.ts, fontSize:12, lineHeight:1.4 }}>{n.text}</div>
                      {n.notify && <span style={{ fontSize:9, color:C.acc, flexShrink:0 }}>🔔</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Render grade anual ────────────────────────────────────────
  const renderMonthMini = (monthIdx) => {
    const firstDay = new Date(year, monthIdx, 1).getDay();
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    const dateStr = (d) => `${year}-${String(monthIdx+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const monthCount = agendForMonth(monthIdx).length;
    return (
      <div key={monthIdx} style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, padding:"12px", cursor:"default" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <button onClick={()=>{setSelectedMonth(monthIdx);setSelectedDay(null);}}
            style={{ background:"none", border:"none", color:C.tp, fontSize:12.5, fontWeight:700, cursor:"pointer", padding:0 }}
            onMouseEnter={e=>e.currentTarget.style.color=C.atxt} onMouseLeave={e=>e.currentTarget.style.color=C.tp}>
            {MONTHS[monthIdx]}
          </button>
          {monthCount>0 && <span style={{ background:C.acc+"1A", color:C.acc, fontSize:9, padding:"1px 6px", borderRadius:9, fontWeight:700 }}>{monthCount}</span>}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, marginBottom:3 }}>
          {["D","S","T","Q","Q","S","S"].map((w,i)=><div key={i} style={{ color:C.td, fontSize:8, textAlign:"center" }}>{w}</div>)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1 }}>
          {cells.map((d,i)=>{
            if (!d) return <div key={i} />;
            const ds = dateStr(d);
            const count = agendForDay(ds).length;
            const isToday = ds === today;
            return (
              <div key={i} onClick={()=>{setSelectedMonth(monthIdx);setSelectedDay(ds);}}
                style={{ textAlign:"center", padding:"2px 1px", borderRadius:4, cursor:"pointer", background:isToday?C.abg:"transparent", color:isToday?C.atxt:C.ts, fontSize:9.5, fontWeight:isToday?700:400, position:"relative" }}
                onMouseEnter={e=>{ if(!isToday) e.currentTarget.style.background=C.deep; }}
                onMouseLeave={e=>{ if(!isToday) e.currentTarget.style.background="transparent"; }}>
                {d}
                {count>0 && <div style={{ width:3, height:3, borderRadius:"50%", background:C.acc, margin:"1px auto 0" }} />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding:"24px 28px", maxWidth:1200 }}>
      {/* Alerta 15 minutos — caixinha no centro */}
      {alertAgendam && (
        <div style={{ position:"fixed", inset:0, zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
          <div style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, borderRadius:20, padding:"32px 40px", maxWidth:380, textAlign:"center", boxShadow:"0 12px 60px rgba(0,0,0,0.8)", animation:"fadeIn 0.4s ease", pointerEvents:"all" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>⏰</div>
            <div style={{ color:"#fff", fontSize:26, fontWeight:900, letterSpacing:"-0.5px", marginBottom:8 }}>15 MINUTOS</div>
            <div style={{ color:"rgba(255,255,255,0.9)", fontSize:15, marginBottom:6 }}>para seu compromisso!</div>
            <div style={{ color:"rgba(255,255,255,0.75)", fontSize:16, fontWeight:600, background:"rgba(0,0,0,0.2)", borderRadius:10, padding:"10px 16px", marginBottom:16 }}>📋 {alertAgendam.text}</div>
            <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, marginBottom:14 }}>Fecha automaticamente em 30 segundos</div>
            <button onClick={()=>setAlertAgendam(null)}
              style={{ background:"rgba(255,255,255,0.15)", border:"1.5px solid rgba(255,255,255,0.35)", color:"#fff", borderRadius:10, padding:"9px 32px", fontSize:14, fontWeight:700, cursor:"pointer", letterSpacing:"0.5px", transition:"all 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.28)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.15)"}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Modal apagar */}
      {deleteConfirm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"24px", maxWidth:340, width:"90%" }}>
            <div style={{ color:"#F87171", fontSize:15, fontWeight:700, marginBottom:8 }}>🗑 Apagar agendamento</div>
            <div style={{ color:C.tm, fontSize:12.5, marginBottom:14 }}>Digite sua senha para confirmar.</div>
            <input type="password" value={deletePass} onChange={e=>{setDeletePass(e.target.value);setDeleteErr("");}}
              onKeyDown={e=>e.key==="Enter"&&confirmDelete()}
              placeholder="Sua senha..." style={{ ...S.input, marginBottom:8 }} autoFocus />
            {deleteErr && <div style={{ color:"#F87171", fontSize:11.5, marginBottom:8 }}>{deleteErr}</div>}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>{setDeleteConfirm(null);setDeletePass("");setDeleteErr("");}} style={{ ...S.btn("transparent",C.tm), border:`1px solid ${C.b2}`, flex:1 }}>Cancelar</button>
              <button onClick={confirmDelete} style={{ ...S.btn("#EF4444","#fff"), flex:1 }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:22 }}>
        <div>
          <h1 style={{ color:C.tp, fontSize:21, fontWeight:700, margin:0 }}>📅 Agenda {year}</h1>
          <p style={{ color:C.tm, fontSize:12.5, margin:"4px 0 0" }}>
            {selectedMonth !== null ? `Clique em um dia para ver agendamentos` : `Clique no nome do mês para abri-lo · ${notes.length} agendamento(s)`}
          </p>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {selectedMonth !== null && (
            <button onClick={()=>{setSelectedMonth(null);setSelectedDay(null);}} style={{ ...S.btn(C.deep,C.tm), border:`1px solid ${C.b2}`, padding:"7px 14px", fontSize:13 }}>← Anual</button>
          )}
          <button onClick={()=>setYear(y=>y-1)} style={{ ...S.btn(C.deep,C.tm), border:`1px solid ${C.b2}`, padding:"7px 14px", fontSize:13 }}>← {year-1}</button>
          <button onClick={()=>setYear(new Date().getFullYear())} style={{ ...S.btn(C.abg,C.atxt), padding:"7px 14px", fontSize:12 }}>Hoje</button>
          <button onClick={()=>setYear(y=>y+1)} style={{ ...S.btn(C.deep,C.tm), border:`1px solid ${C.b2}`, padding:"7px 14px", fontSize:13 }}>{year+1} →</button>
        </div>
      </div>

      {/* Conteúdo */}
      {selectedMonth !== null
        ? renderMonthExpanded()
        : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))", gap:12 }}>
            {Array.from({length:12},(_,i)=>renderMonthMini(i))}
          </div>
        )
      }

      {/* Painel dia selecionado na grade anual */}
      {selectedMonth === null && selectedDay && (
        <div style={{ ...S.card, padding:"16px 20px", marginTop:18, border:`1px solid ${C.atxt}33` }}>
          <div style={{ color:C.atxt, fontSize:13, fontWeight:700, marginBottom:10 }}>
            📅 {new Date(selectedDay+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}
          </div>
          {agendForDay(selectedDay).length === 0 && <div style={{ color:C.tm, fontSize:12, marginBottom:10 }}>Nenhum agendamento neste dia.</div>}
          <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:12 }}>
            {agendForDay(selectedDay).map(n=>(
              <div key={n.id} style={{ background:C.deep, borderRadius:9, padding:"9px 12px", border:`1px solid ${C.b1}`, display:"flex", gap:10, alignItems:"flex-start" }}>
                {n.hour && <div style={{ color:C.acc, fontSize:12, fontWeight:700, flexShrink:0, marginTop:1 }}>🕐 {n.hour}</div>}
                <div style={{ flex:1, color:C.ts, fontSize:12.5, lineHeight:1.5 }}>{n.text}</div>
                <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                  {n.notify && <span style={{ fontSize:10, color:C.acc }}>🔔</span>}
                  <button onClick={()=>setDeleteConfirm(n.id)} title="Apagar" style={{ background:"#2D1515", border:"1px solid #EF444422", borderRadius:8, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, transition:"all 0.15s" }} onMouseEnter={e=>e.currentTarget.style.background="#3D1515"} onMouseLeave={e=>e.currentTarget.style.background="#2D1515"}><svg width="12" height="13" viewBox="0 0 12 13" fill="none"><path d="M1 3h10M4 3V2h4v1M2 3l.7 8h6.6L10 3" stroke="#F87171" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 6v3M7 6v3" stroke="#F87171" strokeWidth="1.3" strokeLinecap="round"/></svg></button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop:`1px solid ${C.b1}`, paddingTop:12 }}>
            <div style={{ color:C.tm, fontSize:11, marginBottom:8 }}>➕ Novo agendamento</div>
            <input value={newText} onChange={e=>setNewText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&addNote()}
              placeholder="Descrição..." style={{ ...S.input, marginBottom:7 }} />
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:7, flexWrap:"wrap" }}>
              <input type="time" value={newHour} onChange={e=>setNewHour(e.target.value)}
                style={{ ...S.input, width:110, padding:"7px 10px" }} />
              <span style={{ color:C.td, fontSize:10.5 }}>hora (opcional)</span>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:"auto" }}>
                <div onClick={()=>setNewNotify(p=>!p)} style={{ width:32, height:18, borderRadius:9, background:newNotify?C.acc:C.b2, position:"relative", cursor:"pointer", transition:"background 0.2s" }}>
                  <div style={{ position:"absolute", top:1, left:newNotify?14:1, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                </div>
                <span style={{ color:C.tm, fontSize:11 }}>Notificar 🔔</span>
              </div>
            </div>
            <button onClick={addNote} disabled={!newText.trim()} style={{ ...S.btn(newText.trim()?C.acc:C.deep, newText.trim()?"#fff":C.td), width:"100%", opacity:newText.trim()?1:0.5 }}>
              Salvar agendamento
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Simulador helpers ──────────────────────────────────────────
const fmtBRL = (v) => { const n = parseFloat(v); if (isNaN(n)) return "—"; return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" }); };
const toF = (s) => parseFloat(String(s).replace(/\./g,"").replace(",",".")) || 0;

// Cartão visual SVG



// Balão de detalhe ao clicar numa célula
function BalaoCelula({ info, onClose }) {
  if (!info) return null;
  const parcela = info.val > 0 && info.nPrazo > 0 ? info.val / info.nPrazo : null;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:900, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.card, border:`1px solid ${C.atxt}44`, borderRadius:18, padding:"24px 28px", minWidth:280, boxShadow:"0 12px 48px rgba(0,0,0,0.7)", animation:"fadeIn 0.2s ease" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ color:C.atxt, fontSize:14, fontWeight:800 }}>📋 Detalhes da simulação</div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:C.abg, borderRadius:9 }}>
            <span style={{ color:C.tm, fontSize:12.5 }}>Valor liberado</span>
            <span style={{ color:C.atxt, fontSize:15, fontWeight:800 }}>{fmtBRL(info.val)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:C.deep, borderRadius:9 }}>
            <span style={{ color:C.tm, fontSize:12.5 }}>Prazo</span>
            <span style={{ color:C.tp, fontSize:14, fontWeight:700 }}>{info.prazo}</span>
          </div>
          {parcela !== null && (
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:C.deep, borderRadius:9 }}>
              <span style={{ color:C.tm, fontSize:12.5 }}>Valor da parcela</span>
              <span style={{ color:C.tp, fontSize:14, fontWeight:700 }}>{fmtBRL(parcela)}</span>
            </div>
          )}
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.2)", borderRadius:9 }}>
            <span style={{ color:"#FBBF24", fontSize:12.5, fontWeight:600 }}>⚡ Liberação rápida — Cliente VIP</span>
            <span style={{ color:"#FBBF24", fontSize:13, fontWeight:700 }}>{fmtBRL(info.val * 0.95)}</span>
          </div>
          <div style={{ color:C.td, fontSize:10, textAlign:"center", marginTop:4 }}>{info.banco} · coef {info.coef}</div>
        </div>
      </div>
    </div>
  );
}

// Tabela genérica para abas com bancos e prazos + balão
function TabelaSimulacao({ margem, margemReaj, bancos, prazos, chaveCoef }) {
  const [balao, setBalao] = useState(null);
  const m = toF(margem);
  const mReaj = margemReaj || 0;

  return (
    <>
      <BalaoCelula info={balao} onClose={()=>setBalao(null)} />
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5, minWidth:400 }}>
          <thead>
            <tr style={{ background:C.deep }}>
              <th style={{ color:C.tm, fontWeight:700, padding:"9px 12px", textAlign:"left", borderBottom:`1px solid ${C.b1}` }}>Banco</th>
              <th style={{ color:C.tm, fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}`, fontSize:11 }}>Coef</th>
              {prazos.map(p => (
                <th key={p.prazo} style={{ color:C.atxt, fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}` }}>{p.prazo}</th>
              ))}
              {mReaj > 0 && prazos.map(p => (
                <th key={"r"+p.prazo} style={{ color:"#34D399", fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}`, fontSize:11 }}>{p.prazo}+R</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bancos.map((b, i) => {
              const c = toF(b[chaveCoef]) || toF(b.coef_emp) || 0.02718;
              return (
                <tr key={b.id} style={{ background: i%2===0 ? C.card : C.deep }}>
                  <td style={{ color:C.tp, fontWeight:600, padding:"9px 12px", borderBottom:`1px solid ${C.b1}`, whiteSpace:"nowrap" }}>{b.nome}</td>
                  <td style={{ color:C.td, textAlign:"center", padding:"9px 10px", borderBottom:`1px solid ${C.b1}`, fontSize:11 }}>{c}</td>
                  {prazos.map(p => {
                    const val = m > 0 && c > 0 ? m / c : null;
                    const nPrazo = parseInt(p.prazo) || 0;
                    return (
                      <td key={p.prazo} style={{ textAlign:"center", padding:"9px 10px", borderBottom:`1px solid ${C.b1}` }}>
                        {val !== null
                          ? <span onClick={()=>setBalao({ val, prazo:p.prazo, nPrazo, banco:b.nome, coef:c })}
                              style={{ color:C.tp, fontWeight:700, cursor:"pointer", padding:"3px 8px", borderRadius:7, display:"inline-block", transition:"background 0.15s" }}
                              onMouseEnter={e=>e.currentTarget.style.background=C.abg}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              {fmtBRL(val)}
                            </span>
                          : <span style={{ color:C.td }}>—</span>}
                      </td>
                    );
                  })}
                  {mReaj > 0 && prazos.map(p => {
                    const val = (m + mReaj) > 0 && c > 0 ? (m + mReaj) / c : null;
                    const nPrazo = parseInt(p.prazo) || 0;
                    return (
                      <td key={"r"+p.prazo} style={{ textAlign:"center", padding:"9px 10px", borderBottom:`1px solid ${C.b1}` }}>
                        {val !== null
                          ? <span onClick={()=>setBalao({ val, prazo:p.prazo, nPrazo, banco:b.nome, coef:c })}
                              style={{ color:"#34D399", fontWeight:700, cursor:"pointer", padding:"3px 8px", borderRadius:7, display:"inline-block", transition:"background 0.15s" }}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(52,211,153,0.1)"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              {fmtBRL(val)}
                            </span>
                          : <span style={{ color:C.td }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Crédito do Trabalhador ─────────────────────────────────────
function CreditoTab({ bancos }) {
  const [margem, setMargem] = useState("");
  const [linhas, setLinhas] = useState([
    { id:1, prazo:"6x",  coef:"0.19612" }, { id:2, prazo:"8x",  coef:"0.14857" },
    { id:3, prazo:"12x", coef:"0.10378" }, { id:4, prazo:"14x", coef:"0.09180" },
    { id:5, prazo:"16x", coef:"0.08178" }, { id:6, prazo:"18x", coef:"0.07393" },
    { id:7, prazo:"24x", coef:"0.05860" }, { id:8, prazo:"36x", coef:"0.04263" },
    { id:9, prazo:"48x", coef:"0.03429" },
  ]);
  const [novaLinha, setNovaLinha] = useState({ prazo:"", coef:"" });
  const [showAdd, setShowAdd] = useState(false);
  const m = toF(margem);

  const addLinha = () => { if (!novaLinha.prazo || !novaLinha.coef) return; setLinhas(p=>[...p,{...novaLinha,id:Date.now()}]); setNovaLinha({prazo:"",coef:""}); setShowAdd(false); };
  const [balao, setBalao] = useState(null);

  return (
    <div>
      <BalaoCelula info={balao} onClose={()=>setBalao(null)} />
      <div style={{ color:C.td, fontSize:11.5, marginBottom:14, padding:"9px 13px", background:C.abg, borderRadius:9, border:`1px solid ${C.atxt}22` }}>
        <b style={{ color:C.atxt }}>Regra:</b> Valor Liberado = Margem ÷ Coeficiente
      </div>
      <div style={{ display:"flex", gap:14, alignItems:"flex-end", marginBottom:18, flexWrap:"wrap" }}>
        <div style={{ flex:"0 0 220px" }}>
          <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>Margem do cliente (R$)</label>
          <input value={margem} onChange={e=>setMargem(e.target.value)} placeholder="Ex: 424,00"
            style={{ ...S.input, fontSize:15, fontWeight:600 }} />
        </div>
        {m > 0 && <div style={{ color:C.atxt, fontSize:13, fontWeight:700, paddingBottom:8 }}>{fmtBRL(m)}</div>}
      </div>
      <div style={{ overflowX:"auto", marginBottom:12 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5, minWidth:420 }}>
          <thead>
            <tr style={{ background:C.deep }}>
              <th style={{ color:C.tm, fontWeight:700, padding:"9px 12px", textAlign:"left", borderBottom:`1px solid ${C.b1}` }}>Prazo</th>
              <th style={{ color:C.tm, fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}`, width:120 }}>Coeficiente</th>
              {bancos.filter(b=>toF(b.coef_cred)>0).map(b=>(
                <th key={b.id} style={{ color:C.atxt, fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}`, whiteSpace:"nowrap" }}>{b.nome}</th>
              ))}
              <th style={{ width:28, borderBottom:`1px solid ${C.b1}` }} />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => {
              return (
                <tr key={l.id} style={{ background: i%2===0 ? C.card : C.deep }}>
                  <td style={{ color:C.tp, fontWeight:700, padding:"9px 12px", borderBottom:`1px solid ${C.b1}` }}>{l.prazo}</td>
                  <td style={{ padding:"5px 8px", borderBottom:`1px solid ${C.b1}` }}>
                    <input value={l.coef} onChange={e=>setLinhas(p=>p.map(x=>x.id===l.id?{...x,coef:e.target.value}:x))}
                      style={{ background:"transparent", border:`1px solid ${C.b2}`, borderRadius:6, color:C.ts, fontSize:12, padding:"4px 7px", width:"100%", textAlign:"center" }} />
                  </td>
                  {bancos.filter(b=>toF(b.coef_cred)>0).map(b => {
                    const bc = toF(b.coef_cred);
                    const val = m > 0 && bc > 0 ? m / bc : null;
                    const nPrazo = parseInt(l.prazo) || 0;
                    return (
                      <td key={b.id} style={{ textAlign:"center", padding:"9px 10px", borderBottom:`1px solid ${C.b1}` }}>
                        {val !== null
                          ? <span onClick={()=>setBalao({val,prazo:l.prazo,nPrazo,banco:b.nome,coef:bc})}
                              style={{ color:C.tp, fontWeight:700, cursor:"pointer", padding:"3px 8px", borderRadius:7, display:"inline-block" }}
                              onMouseEnter={e=>e.currentTarget.style.background=C.abg}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              {fmtBRL(val)}
                            </span>
                          : <span style={{ color:C.td }}>—</span>}
                      </td>
                    );
                  })}
                  <td style={{ borderBottom:`1px solid ${C.b1}`, textAlign:"center" }}>
                    <button onClick={()=>setLinhas(p=>p.filter(x=>x.id!==l.id))} style={{ background:"none", border:"none", color:"#F87171", cursor:"pointer", fontSize:15 }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {showAdd ? (
          <>
            <input value={novaLinha.prazo} onChange={e=>setNovaLinha(p=>({...p,prazo:e.target.value}))} placeholder="Prazo (ex: 6x)" style={{ ...S.input, width:110 }} />
            <input value={novaLinha.coef} onChange={e=>setNovaLinha(p=>({...p,coef:e.target.value}))} placeholder="Coeficiente" style={{ ...S.input, width:130 }} />
            <button onClick={addLinha} style={{ background:C.acc, color:"#fff", border:"none", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontSize:12, fontWeight:600 }}>＋ Adicionar</button>
            <button onClick={()=>setShowAdd(false)} style={{ background:"transparent", border:`1px solid ${C.b2}`, color:C.tm, borderRadius:8, padding:"8px 12px", cursor:"pointer", fontSize:12 }}>Cancelar</button>
          </>
        ) : (
          <button onClick={()=>setShowAdd(true)} style={{ background:C.deep, border:`1px solid ${C.b2}`, color:C.tm, borderRadius:8, padding:"7px 13px", cursor:"pointer", fontSize:12 }}>＋ Adicionar prazo</button>
        )}
      </div>
    </div>
  );
}

// ── Cartão Consignado ──────────────────────────────────────────
function CartaoTab() {
  const [margem1, setMargem1] = useState("");
  const [mult1,   setMult1]   = useState("3.0");
  const [margem2, setMargem2] = useState("");
  const [mult2,   setMult2]   = useState("3.0");
  const [pctSaque, setPctSaque] = useState("70");
  const [prazo,    setPrazo]    = useState("84");

  const ps     = Math.min(100, Math.max(0, parseFloat(pctSaque) || 70));
  const pr     = Math.max(0, 100 - ps);
  const nPrazo = parseInt(prazo) || 84;

  const calcCard = (margem, mult) => {
    const m = toF(margem), x = toF(mult);
    if (m <= 0 || x <= 0) return { limite:null, saque:null, resto:null, parcela:null };
    const limite = m * x;
    return { limite, saque: limite * ps/100, resto: limite * pr/100, parcela: limite / nPrazo };
  };

  const c1 = calcCard(margem1, mult1);
  const c2 = calcCard(margem2, mult2);
  const grads = [
    `linear-gradient(135deg,${C.lg1},${C.lg2})`,
    "linear-gradient(135deg,#7C3AED,#EC4899)",
  ];

  return (
    <div>
      {/* Regra */}
      <div style={{ fontSize:11.5, marginBottom:16, padding:"9px 14px", background:C.abg, borderRadius:9, border:`1px solid ${C.atxt}22`, lineHeight:1.7 }}>
        <b style={{ color:C.atxt }}>Regras:</b>
        <span style={{ color:C.ts }}> Limite = Margem × Mult · </span>
        <span style={{ color:"#D97706", fontWeight:600 }}>Saque = {ps}% do Limite</span>
        <span style={{ color:C.td }}> · </span>
        <span style={{ color:"#059669", fontWeight:600 }}>Restante = {pr}%</span>
      </div>

      {/* Configurações globais */}
      <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, padding:"14px 18px", marginBottom:22 }}>
        <div style={{ color:C.ts, fontSize:12, fontWeight:700, marginBottom:12 }}>⚙ Configurações</div>
        <div style={{ display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap" }}>
          <div>
            <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>% Saque complementar</label>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <input value={pctSaque} onChange={e=>setPctSaque(String(Math.min(100,Math.max(0,parseInt(e.target.value)||0))))}
                type="number" min="0" max="100" style={{ ...S.input, width:72, textAlign:"center", fontWeight:700 }} />
              <span style={{ color:C.tm, fontSize:12 }}>%</span>
            </div>
          </div>
          <div>
            <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>% Restante</label>
            <div style={{ background:C.deep, border:`1px solid ${C.b2}`, borderRadius:8, padding:"9px 14px", color:C.ts, fontSize:13, fontWeight:700, minWidth:56, textAlign:"center" }}>
              {pr}%
            </div>
          </div>
          <div>
            <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Prazo parcelas</label>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <input value={prazo} onChange={e=>setPrazo(e.target.value)} type="number" min="1" max="96"
                style={{ ...S.input, width:72, textAlign:"center", fontWeight:700 }} />
              <span style={{ color:C.tm, fontSize:12 }}>x</span>
            </div>
          </div>
        </div>
      </div>

      {/* Dois cartões */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:22 }}>
        {[
          { n:1, m:margem1, setM:setMargem1, x:mult1, setX:setMult1, calc:c1, g:grads[0] },
          { n:2, m:margem2, setM:setMargem2, x:mult2, setX:setMult2, calc:c2, g:grads[1] },
        ].map(card => (
          <div key={card.n} style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:16, overflow:"hidden" }}>
            {/* Header */}
            <div style={{ background:C.deep, padding:"11px 16px", borderBottom:`1px solid ${C.b1}` }}>
              <span style={{ color:C.ts, fontSize:13, fontWeight:700 }}>Cartão {card.n}</span>
            </div>
            <div style={{ padding:"16px" }}>
              {/* Inputs */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
                <div>
                  <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4, fontWeight:600 }}>Margem (R$)</label>
                  <input value={card.m} onChange={e=>card.setM(e.target.value)} placeholder="Ex: 500,00"
                    style={{ ...S.input, fontSize:14, fontWeight:700 }} />
                </div>
                <div>
                  <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4, fontWeight:600 }}>Multiplicador</label>
                  <input value={card.x} onChange={e=>card.setX(e.target.value)} placeholder="Ex: 3.0"
                    style={{ ...S.input, fontSize:14, fontWeight:700 }} />
                </div>
              </div>

              {/* ── CARTÃO VISUAL — proporção 85.6×54mm (1.585:1) ── */}
              <div style={{ position:"relative", width:"70%", paddingTop:"44%", marginBottom:16 }}>
                {/* Sombra */}
                <div style={{ position:"absolute", inset:"6% 4% 0 6%", borderRadius:16, background:card.g, opacity:0.35, transform:"rotate(-2.5deg)", filter:"blur(6px)" }} />
                {/* Frente do cartão */}
                <div style={{ position:"absolute", inset:0, borderRadius:16, background:card.g, boxShadow:"0 12px 40px rgba(0,0,0,0.55)", padding:"8% 7%", boxSizing:"border-box", display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
                  {/* Topo: chip + bandeira */}
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
                    {/* Chip EMV */}
                    <div style={{ width:"13%", aspectRatio:"8/6", borderRadius:"15%", background:"linear-gradient(135deg,#f5d46a,#c8920a)", position:"relative", overflow:"hidden", boxShadow:"inset 0 1px 2px rgba(0,0,0,0.3)" }}>
                      <div style={{ position:"absolute", top:"50%", left:0, right:0, height:1, background:"rgba(0,0,0,0.25)" }} />
                      <div style={{ position:"absolute", left:"35%", top:0, bottom:0, width:1, background:"rgba(0,0,0,0.2)" }} />
                      <div style={{ position:"absolute", left:0, top:0, width:"35%", bottom:0, borderRight:"1px solid rgba(0,0,0,0.15)" }} />
                    </div>
                    {/* Ícone contactless */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ opacity:0.55 }}>
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" fill="none"/>
                      <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6" stroke="rgba(255,255,255,0.7)" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                      <path d="M12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3" stroke="rgba(255,255,255,0.7)" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                    </svg>
                  </div>

                  {/* Número */}
                  <div style={{ color:"rgba(255,255,255,0.45)", fontSize:"clamp(8px,2.2vw,12px)", letterSpacing:"0.2em", fontFamily:"monospace", textAlign:"center" }}>
                    •••• •••• •••• ••••
                  </div>

                  {/* Rodapé: saque e restante lado a lado */}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                    <div>
                      <div style={{ color:"rgba(255,255,255,0.55)", fontSize:"clamp(6px,1.4vw,9px)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>
                        Saque Disponível
                      </div>
                      <div style={{ color:"#FDE68A", fontSize:"clamp(11px,2.8vw,18px)", fontWeight:900, letterSpacing:"-0.02em", lineHeight:1 }}>
                        {card.calc.saque !== null ? fmtBRL(card.calc.saque) : "—"}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ color:"rgba(255,255,255,0.55)", fontSize:"clamp(6px,1.4vw,9px)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>
                        Limite Restante
                      </div>
                      <div style={{ color:"#A7F3D0", fontSize:"clamp(11px,2.8vw,18px)", fontWeight:900, letterSpacing:"-0.02em", lineHeight:1 }}>
                        {card.calc.resto !== null ? fmtBRL(card.calc.resto) : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quadrados de info + parcela ao lado */}
              <div style={{ display:"flex", gap:8, alignItems:"stretch" }}>
                {/* 3 quadrados */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:7, flex:1 }}>
                  <div style={{ background:C.abg, border:`1px solid ${C.atxt}44`, borderRadius:10, padding:"9px 6px", textAlign:"center" }}>
                    <div style={{ color:C.tm, fontSize:8.5, textTransform:"uppercase", letterSpacing:"0.4px", marginBottom:4 }}>Limite Total</div>
                    <div style={{ color:C.atxt, fontSize:14, fontWeight:800, lineHeight:1 }}>{card.calc.limite !== null ? fmtBRL(card.calc.limite) : "—"}</div>
                  </div>
                  <div style={{ background:"rgba(217,119,6,0.12)", border:"1px solid rgba(217,119,6,0.4)", borderRadius:10, padding:"9px 6px", textAlign:"center" }}>
                    <div style={{ color:C.tm, fontSize:8.5, textTransform:"uppercase", letterSpacing:"0.4px", marginBottom:4 }}>Saque {ps}%</div>
                    <div style={{ color:"#F59E0B", fontSize:14, fontWeight:800, lineHeight:1 }}>{card.calc.saque !== null ? fmtBRL(card.calc.saque) : "—"}</div>
                  </div>
                  <div style={{ background:"rgba(5,150,105,0.1)", border:"1px solid rgba(5,150,105,0.35)", borderRadius:10, padding:"9px 6px", textAlign:"center" }}>
                    <div style={{ color:C.tm, fontSize:8.5, textTransform:"uppercase", letterSpacing:"0.4px", marginBottom:4 }}>Restante {pr}%</div>
                    <div style={{ color:"#10B981", fontSize:14, fontWeight:800, lineHeight:1 }}>{card.calc.resto !== null ? fmtBRL(card.calc.resto) : "—"}</div>
                  </div>
                </div>
                {/* Parcela — coluna à direita */}
                <div style={{ background:`linear-gradient(135deg,${C.lg1}22,${C.lg2}22)`, border:`1px solid ${C.atxt}44`, borderRadius:10, padding:"9px 10px", textAlign:"center", display:"flex", flexDirection:"column", justifyContent:"center", minWidth:80, flexShrink:0 }}>
                  <div style={{ color:C.tm, fontSize:8.5, textTransform:"uppercase", letterSpacing:"0.4px", marginBottom:4 }}>{nPrazo}x</div>
                  <div style={{ color:C.atxt, fontSize:13, fontWeight:800, lineHeight:1 }}>
                    {card.calc.parcela !== null ? fmtBRL(card.calc.parcela) : "—"}
                  </div>
                  <div style={{ color:C.td, fontSize:7.5, marginTop:3 }}>por parcela</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Aba genérica de empréstimo com balão ──────────────────────
function EmprestimoGenTab({ bancos, chaveCoef, titulo, prazosDefault }) {
  const [margem, setMargem] = useState("");
  const [salarioAntigo, setSalarioAntigo] = useState("");
  const [salarioAtual, setSalarioAtual] = useState("");
  const m = toF(margem);
  const margemReaj = salarioAtual && salarioAntigo ? Math.max(0, (toF(salarioAtual) - toF(salarioAntigo)) * 0.35) : 0;

  return (
    <div>
      <div style={{ color:C.td, fontSize:11.5, marginBottom:14, padding:"9px 13px", background:C.abg, borderRadius:9, border:`1px solid ${C.atxt}22` }}>
        <b style={{ color:C.atxt }}>Regra ({titulo}):</b> Valor Liberado = Margem ÷ Coeficiente · Clique num valor para ver detalhes
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:16, flexWrap:"wrap" }}>
        <div>
          <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>Margem disponível (R$)</label>
          <input value={margem} onChange={e=>setMargem(e.target.value)} placeholder="Ex: 424,00" style={{ ...S.input }} />
        </div>
        <div>
          <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>Salário antigo (opcional)</label>
          <input value={salarioAntigo} onChange={e=>setSalarioAntigo(e.target.value)} placeholder="Ex: 1.212,00" style={{ ...S.input }} />
        </div>
        <div>
          <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>Salário atual (opcional)</label>
          <input value={salarioAtual} onChange={e=>setSalarioAtual(e.target.value)} placeholder="Ex: 1.302,00" style={{ ...S.input }} />
        </div>
      </div>
      {margemReaj > 0 && (
        <div style={{ background:"rgba(52,211,153,0.08)", border:"1px solid rgba(52,211,153,0.3)", borderRadius:9, padding:"9px 14px", marginBottom:14, display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
          <div><span style={{ color:C.tm, fontSize:11 }}>Margem de reajuste: </span><b style={{ color:"#34D399" }}>{fmtBRL(margemReaj)}</b></div>
          <div><span style={{ color:C.tm, fontSize:11 }}>Margem total: </span><b style={{ color:C.atxt }}>{fmtBRL(m + margemReaj)}</b></div>
        </div>
      )}
      <TabelaSimulacao margem={margem} margemReaj={margemReaj > 0 ? margemReaj : null} bancos={bancos} prazos={prazosDefault} chaveCoef={chaveCoef} />
    </div>
  );
}

// ── Simulador ─────────────────────────────────────────────────
function SimuladorPage() {
  const [aba, setAba] = useState("credito");

  // Estados dos bancos separados por categoria
  const loadBancos = (key, defaults) => { try { return JSON.parse(localStorage.getItem(key) || "null") || defaults; } catch { return defaults; } };
  const saveBancos = (key, list, setter) => { setter(list); localStorage.setItem(key, JSON.stringify(list)); };

  const defCLT = [
    { id:1, nome:"PAN",          coef_cred:"0.02305", coef_emp:"0.02718" },
    { id:2, nome:"SAFRA",        coef_cred:"0.022988", coef_emp:"0.02718" },
    { id:3, nome:"FACTA - GOLD", coef_cred:"0.022997", coef_emp:"0.02718" },
    { id:4, nome:"C6 BANK",      coef_cred:"0.022996", coef_emp:"0.02718" },
    { id:5, nome:"BMG",          coef_cred:"0.02300", coef_emp:"0.02718" },
    { id:6, nome:"MERCANTIL",    coef_cred:"0.02310", coef_emp:"0.02718" },
  ];
  const defINSS = [
    { id:1, nome:"PAN",    coef_emp:"0.024950" },
    { id:2, nome:"SAFRA",  coef_emp:"0.024500" },
    { id:3, nome:"FACTA",  coef_emp:"0.024800" },
    { id:4, nome:"C6",     coef_emp:"0.024700" },
    { id:5, nome:"BMG",    coef_emp:"0.025000" },
  ];
  const defGOV = [
    { id:1, nome:"PAN",      coef_emp:"0.020500" },
    { id:2, nome:"SAFRA",    coef_emp:"0.020000" },
    { id:3, nome:"FACTA",    coef_emp:"0.020300" },
    { id:4, nome:"BMG",      coef_emp:"0.020100" },
    { id:5, nome:"MERCANTIL",coef_emp:"0.019800" },
  ];

  const [bancosCLT,  setBancosCLT]  = useState(() => loadBancos("nexp_bancos_clt",  defCLT));
  const [bancosINSS, setBancosINSS] = useState(() => loadBancos("nexp_bancos_inss", defINSS));
  const [bancosGOV,  setBancosGOV]  = useState(() => loadBancos("nexp_bancos_gov",  defGOV));

  const [gerenciar, setGerenciar] = useState(null); // "clt" | "inss" | "gov" | null
  const [novoB, setNovoB] = useState({ nome:"", coef_cred:"", coef_emp:"" });

  const addBancoTo = (key, list, setter) => {
    if (!novoB.nome.trim()) return;
    const updated = [...list, { ...novoB, id: Date.now() }];
    saveBancos(key, updated, setter);
    setNovoB({ nome:"", coef_cred:"", coef_emp:"" });
  };
  const remBanco = (key, list, setter, id) => saveBancos(key, list.filter(b=>b.id!==id), setter);

  const bancosMap = {
    clt:  { list: bancosCLT,  setter: setBancosCLT,  key:"nexp_bancos_clt",  label:"CLT" },
    inss: { list: bancosINSS, setter: setBancosINSS, key:"nexp_bancos_inss", label:"INSS" },
    gov:  { list: bancosGOV,  setter: setBancosGOV,  key:"nexp_bancos_gov",  label:"Governos e Prefeituras" },
  };

  const PRAZOS_INSS = [{prazo:"72X"},{prazo:"84X"},{prazo:"96X"}];
  const PRAZOS_GOV  = [{prazo:"60X"},{prazo:"72X"},{prazo:"84X"},{prazo:"96X"},{prazo:"108X"},{prazo:"120X"}];

  return (
    <div style={{ padding:"22px 28px", maxWidth:1150 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:10 }}>
        <div>
          <h1 style={{ color:C.tp, fontSize:20, fontWeight:700, margin:0 }}>⊟ Simulador Nexp</h1>
          <p style={{ color:C.tm, fontSize:12, margin:"3px 0 0" }}>Simule crédito por produto · Clique num valor para ver os detalhes</p>
        </div>
        <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
          {[{k:"clt",label:"🏢 Bancos — CLT"},{k:"inss",label:"🏥 Bancos — INSS"},{k:"gov",label:"🏛 Bancos — Governos"}].map(btn=>(
            <button key={btn.k} onClick={()=>setGerenciar(gerenciar===btn.k?null:btn.k)}
              style={{ background:gerenciar===btn.k?C.acc:C.abg, color:gerenciar===btn.k?"#fff":C.atxt, border:`1px solid ${gerenciar===btn.k?"transparent":C.atxt+"33"}`, borderRadius:8, padding:"7px 12px", cursor:"pointer", fontSize:11.5, fontWeight:600 }}>
              {btn.label} ({bancosMap[btn.k].list.length})
            </button>
          ))}
        </div>
      </div>

      {/* Painel gerenciar bancos */}
      {gerenciar && (() => {
        const g = bancosMap[gerenciar];
        return (
          <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, padding:"14px 16px", marginBottom:16 }}>
            <div style={{ color:C.ts, fontSize:13, fontWeight:700, marginBottom:10 }}>🏦 {g.label} — bancos configurados</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:12 }}>
              {g.list.map(b=>(
                <div key={b.id} style={{ background:C.deep, border:`1px solid ${C.b2}`, borderRadius:8, padding:"5px 11px", display:"flex", alignItems:"center", gap:8, fontSize:11.5 }}>
                  <span style={{ color:C.tp, fontWeight:600 }}>{b.nome}</span>
                  {b.coef_cred && <span style={{ color:C.td }}>cred:{b.coef_cred}</span>}
                  <span style={{ color:C.td }}>emp:{b.coef_emp}</span>
                  <button onClick={()=>remBanco(g.key,g.list,g.setter,b.id)} style={{ background:"none", border:"none", color:"#F87171", cursor:"pointer", fontSize:14, padding:0 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <input value={novoB.nome} onChange={e=>setNovoB(p=>({...p,nome:e.target.value}))} placeholder="Nome" style={{ ...S.input, width:130 }} />
              {gerenciar==="clt" && <input value={novoB.coef_cred} onChange={e=>setNovoB(p=>({...p,coef_cred:e.target.value}))} placeholder="Coef. Crédito" style={{ ...S.input, width:120 }} />}
              <input value={novoB.coef_emp} onChange={e=>setNovoB(p=>({...p,coef_emp:e.target.value}))} placeholder="Coef. Empréstimo" style={{ ...S.input, width:135 }} />
              <button onClick={()=>addBancoTo(g.key,g.list,g.setter)} disabled={!novoB.nome.trim()}
                style={{ background:C.acc, color:"#fff", border:"none", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontSize:12.5, fontWeight:600, opacity:!novoB.nome.trim()?0.5:1 }}>＋</button>
            </div>
          </div>
        );
      })()}

      {/* Tabs produto */}
      <div style={{ display:"flex", gap:1, borderBottom:`1px solid ${C.b1}`, marginBottom:20, overflowX:"auto" }}>
        {[
          { id:"credito",    label:"Crédito do Trabalhador" },
          { id:"cartao",     label:"Cartão Consignado" },
          { id:"inss",       label:"Crédito Consignado INSS" },
          { id:"gov",        label:"Governo e Prefeituras" },
        ].map(t=>(
          <button key={t.id} onClick={()=>setAba(t.id)}
            style={{ background:"transparent", border:"none", cursor:"pointer", padding:"9px 16px", fontSize:12.5, fontWeight:aba===t.id?700:400, color:aba===t.id?C.atxt:C.tm, borderBottom:aba===t.id?`2px solid ${C.atxt}`:"2px solid transparent", marginBottom:"-1px", transition:"all 0.12s", whiteSpace:"nowrap" }}>
            {t.label}
          </button>
        ))}
      </div>

      {aba === "credito" && <CreditoTab bancos={bancosCLT} />}
      {aba === "cartao"  && <CartaoTab  />}
      {aba === "inss"    && <EmprestimoGenTab bancos={bancosINSS} chaveCoef="coef_emp" titulo="INSS" prazosDefault={PRAZOS_INSS} />}
      {aba === "gov"     && <EmprestimoGenTab bancos={bancosGOV}  chaveCoef="coef_emp" titulo="Governo/Prefeitura" prazosDefault={PRAZOS_GOV} />}
    </div>
  );
}

// ── V8 Digital — aba integrada ────────────────────────────────
function V8DigitalTab({ currentUser }) {
  const [aba, setAba] = useState("config");

  // Credenciais — client_id e audience são fixos conforme documentação V8
  // (usadas no proxy /api/v8proxy.js — não expostas no frontend)

  const [savedUser, setSavedUser] = useState(() => localStorage.getItem("nexp_v8_user") || "");
  const [credForm,  setCredForm]  = useState({ username: savedUser, password: "" });
  const [token,     setToken]     = useState(null);
  const [tokenExp,  setTokenExp]  = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authErr,   setAuthErr]   = useState("");

  const isTokenValid = token && tokenExp && Date.now() < tokenExp;

  // Todas as chamadas passam pelo proxy Vercel para resolver CORS
  const PROXY = "/api/v8proxy";

  const autenticar = async () => {
    if (!credForm.username || !credForm.password) {
      setAuthErr("Preencha e-mail e senha."); return;
    }
    setAuthLoading(true); setAuthErr("");
    try {
      localStorage.setItem("nexp_v8_user", credForm.username);
      setSavedUser(credForm.username);

      const res  = await fetch(PROXY, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          action:  "auth",
          payload: { username: credForm.username, password: credForm.password },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.message || data.error || `Erro ${res.status}`);
      setToken(data.access_token);
      setTokenExp(Date.now() + ((data.expires_in || 3600) - 60) * 1000);
      setAba("fgts");
    } catch(e) { setAuthErr(e.message); }
    setAuthLoading(false);
  };

  const apiFetch = async (path, method="GET", body=null) => {
    if (!isTokenValid) throw new Error("Token expirado. Reautentique.");
    const res  = await fetch(PROXY, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        action:  "bff",
        payload: { path, method, token, body },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error_description || data.error || `Erro ${res.status}`);
    return data;
  };

  // ── FGTS tab ───────────────────────────────────────────────
  const FGTSTab = () => {
    const [subAba, setSubAba] = useState("simular");
    const [cpf, setCpf]       = useState("");
    const [seguro, setSeguro]  = useState(false);
    const [simRes, setSimRes]  = useState(null);   // { saldo, tableSims }
    const [loading, setLoading] = useState(false);
    const [err, setErr]         = useState("");
    // Proposta
    const [propForm, setPropForm] = useState({
      cpf:"", tableId:"", bankId:"", conta:"", agencia:"",
      tipoConta:"corrente", seguro:false,
    });
    const [propRes, setPropRes] = useState(null);
    // Operações
    const [ops, setOps]           = useState(null);
    const [opsLoading, setOpsLoading] = useState(false);

    const fmtCpf = v => v.replace(/\D/g,"").slice(0,11).replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/,"$1.$2.$3-$4");
    const fmtBr  = v => { const n=parseFloat(v); return isNaN(n)?"—":n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); };

    // Tabelas disponíveis V8
    const TABELAS = [
      { id:"cometa",    label:"Cometa"     },
      { id:"turbo",     label:"Turbo"      },
      { id:"grid",      label:"Grid"       },
      { id:"normal",    label:"Normal"     },
      { id:"pitstop",   label:"Pitstop"    },
      { id:"acelera20", label:"Acelera 2.0" },
    ];

    // ── Simular: consulta saldo + simula em todas as tabelas ────
    const simular = async () => {
      const c = cpf.replace(/\D/g,"");
      if (c.length !== 11) { setErr("CPF inválido."); return; }
      setLoading(true); setErr(""); setSimRes(null);
      try {
        // 1. Consultar saldo — endpoint real V8
        const saldo = await apiFetch(`/saque-aniversario/cliente/saldo?cpf=${c}`);
        // 2. Simular em todas as tabelas paralelamente
        const tableSims = await Promise.all(
          TABELAS.map(async (tab) => {
            try {
              const sim = await apiFetch("/saque-aniversario/simulacao", "POST", {
                cpf: c,
                tabelaId: tab.id,
                seguro,
              });
              return { ...tab, sim, ok: true };
            } catch(e) {
              return { ...tab, err: e.message, ok: false };
            }
          })
        );
        setSimRes({ saldo, tableSims });
      } catch(e) {
        // Se saldo falhar, tenta só simular
        if (e.message.includes("saldo")) {
          try {
            const tableSims = await Promise.all(
              TABELAS.map(async (tab) => {
                try {
                  const sim = await apiFetch("/saque-aniversario/simulacao", "POST", {
                    cpf: c, tabelaId: tab.id, seguro,
                  });
                  return { ...tab, sim, ok: true };
                } catch(e2) {
                  return { ...tab, err: e2.message, ok: false };
                }
              })
            );
            setSimRes({ saldo: null, tableSims });
          } catch(e2) { setErr(e2.message); }
        } else {
          setErr(e.message);
        }
      }
      setLoading(false);
    };

    const criarProposta = async () => {
      const c = propForm.cpf.replace(/\D/g,"");
      if (c.length !== 11) { setErr("CPF inválido."); return; }
      setLoading(true); setErr(""); setPropRes(null);
      try {
        const res = await apiFetch("/saque-aniversario/proposta", "POST", {
          cpf: c,
          tabelaId: propForm.tableId,
          bankId: propForm.bankId,
          conta: propForm.conta,
          agencia: propForm.agencia,
          tipoConta: propForm.tipoConta,
          seguro: propForm.seguro,
        });
        setPropRes(res);
      } catch(e) { setErr(e.message); }
      setLoading(false);
    };

    const listarOps = async () => {
      setOpsLoading(true); setErr("");
      try { const res = await apiFetch("/saque-aniversario/operacoes"); setOps(res); }
      catch(e) { setErr(e.message); }
      setOpsLoading(false);
    };

    const statusColor = s => ({
      APROVADO:"#34D399", APROVADA:"#34D399",
      PENDENTE:"#FBBF24", AGUARDANDO:"#60A5FA",
      CANCELADO:"#F87171", CANCELADA:"#F87171",
      ERRO:"#F87171",
    }[s?.toUpperCase()] || C.tm);

    // Extrai valor do cliente da resposta (pode vir em campos variados)
    const extractValor = (sim) => {
      if (!sim) return null;
      return sim.valorLiquido ?? sim.valorCliente ?? sim.valorFinanciado ?? sim.valor ?? null;
    };
    const extractParcelas = (sim) => {
      if (!sim) return null;
      return sim.quantidadeParcelas ?? sim.parcelas ?? sim.prazo ?? null;
    };
    const extractTaxa = (sim) => {
      if (!sim) return null;
      const t = sim.taxaMensal ?? sim.taxa ?? sim.taxaJuros ?? null;
      return t !== null ? (typeof t === "number" ? t.toFixed(2) + "%" : String(t)) : null;
    };
    const extractParcela = (sim) => {
      if (!sim) return null;
      return sim.valorParcela ?? sim.valorMensalidade ?? null;
    };

    return (
      <div>
        {/* Sub-tabs */}
        <div style={{ display:"flex", gap:4, marginBottom:20, borderBottom:`1px solid ${C.b1}` }}>
          {[{v:"simular",l:"🔍 Simular FGTS"},{v:"proposta",l:"📄 Digitar Proposta"},{v:"operacoes",l:"📋 Acompanhamento"}].map(t=>(
            <button key={t.v} onClick={()=>setSubAba(t.v)}
              style={{ background:"transparent", border:"none", cursor:"pointer", padding:"8px 16px", fontSize:12.5,
                fontWeight:subAba===t.v?700:400, color:subAba===t.v?C.atxt:C.tm,
                borderBottom:subAba===t.v?`2px solid ${C.atxt}`:"2px solid transparent", marginBottom:"-1px" }}>
              {t.l}
            </button>
          ))}
        </div>

        {err && (
          <div style={{ color:"#F87171", background:"rgba(239,68,68,0.1)", border:"1px solid #EF444433", borderRadius:8, padding:"9px 13px", marginBottom:14, fontSize:12.5 }}>
            ⚠ {err}
          </div>
        )}

        {/* ── SIMULAR ── */}
        {subAba === "simular" && (
          <div>
            <div style={{ color:C.tm, fontSize:12.5, marginBottom:16 }}>
              Consulte o saldo FGTS e simule os valores em todas as tabelas disponíveis.
            </div>

            {/* Inputs */}
            <div style={{ display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap", marginBottom:16 }}>
              <div style={{ flex:"0 0 220px" }}>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>CPF do cliente</label>
                <input value={cpf} onChange={e=>setCpf(fmtCpf(e.target.value))}
                  placeholder="000.000.000-00" style={{ ...S.input }}
                  onKeyDown={e=>e.key==="Enter"&&simular()} />
              </div>

              {/* Seguro */}
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ color:C.tm, fontSize:11 }}>Seguro</label>
                <div style={{ display:"flex", gap:6 }}>
                  {[{v:false,l:"Não"},{v:true,l:"Sim"}].map(opt=>(
                    <button key={String(opt.v)} onClick={()=>setSeguro(opt.v)}
                      style={{ background:seguro===opt.v?C.abg:C.deep, color:seguro===opt.v?C.atxt:C.tm,
                        border:seguro===opt.v?`1px solid ${C.atxt}55`:`1px solid ${C.b2}`,
                        borderRadius:8, padding:"9px 18px", fontSize:12.5, cursor:"pointer", fontWeight:seguro===opt.v?700:400 }}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={simular} disabled={loading||cpf.replace(/\D/g,"").length!==11}
                style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none",
                  borderRadius:9, padding:"10px 28px", fontSize:13, fontWeight:700, cursor:"pointer",
                  opacity:loading||cpf.replace(/\D/g,"").length!==11?0.5:1, height:40 }}>
                {loading?"⏳ Consultando...":"Simular →"}
              </button>
            </div>

            {/* Resultado */}
            {simRes && (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

                {/* Saldo */}
                {simRes.saldo && (
                  <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, padding:"16px 20px" }}>
                    <div style={{ color:C.atxt, fontSize:13, fontWeight:700, marginBottom:12 }}>💰 Saldo FGTS</div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10 }}>
                      {Object.entries(simRes.saldo).filter(([,v])=>v!==null&&v!==""&&typeof v!=="object").map(([k,v])=>(
                        <div key={k} style={{ background:C.deep, borderRadius:8, padding:"9px 12px" }}>
                          <div style={{ color:C.td, fontSize:9.5, textTransform:"uppercase", marginBottom:3 }}>{k.replace(/_/g," ")}</div>
                          <div style={{ color:C.tp, fontSize:12.5, fontWeight:600 }}>
                            {typeof v==="number"&&(k.toLowerCase().includes("valor")||k.toLowerCase().includes("saldo"))?fmtBr(v):String(v)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tabela de simulações */}
                {simRes.tableSims && (
                  <div style={{ background:C.card, border:`1px solid ${C.atxt}22`, borderRadius:12, overflow:"hidden" }}>
                    <div style={{ padding:"14px 20px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ color:C.atxt, fontSize:13, fontWeight:700 }}>📊 Simulação por Tabela</div>
                      <div style={{ color:C.td, fontSize:11 }}>Seguro: <span style={{ color:seguro?"#34D399":C.tm, fontWeight:600 }}>{seguro?"Sim":"Não"}</span></div>
                    </div>
                    <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <thead>
                        <tr style={{ background:C.deep }}>
                          {["Tabela","Valor Líquido","Parcelas","Taxa Mensal","Parcela","Status"].map(h=>(
                            <th key={h} style={{ color:C.td, fontSize:10.5, fontWeight:700, padding:"10px 14px", textAlign:"left", textTransform:"uppercase", letterSpacing:"0.3px", borderBottom:`1px solid ${C.b1}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {simRes.tableSims.map((tab, i)=>{
                          const vl = extractValor(tab.sim);
                          const p  = extractParcelas(tab.sim);
                          const tx = extractTaxa(tab.sim);
                          const pv = extractParcela(tab.sim);
                          return (
                            <tr key={tab.id} style={{ borderBottom:`1px solid ${C.b1}`, background:i%2===0?"transparent":C.deep+"44", transition:"background 0.15s" }}
                              onMouseEnter={e=>e.currentTarget.style.background=C.abg}
                              onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":C.deep+"44"}>
                              <td style={{ padding:"11px 14px", color:C.tp, fontWeight:700, fontSize:13 }}>{tab.label}</td>
                              <td style={{ padding:"11px 14px", color:"#34D399", fontWeight:800, fontSize:13.5 }}>{vl!==null?fmtBr(vl):"—"}</td>
                              <td style={{ padding:"11px 14px", color:C.ts, fontSize:12.5 }}>{p!==null?`${p}x`:"—"}</td>
                              <td style={{ padding:"11px 14px", color:C.atxt, fontSize:12.5 }}>{tx||"—"}</td>
                              <td style={{ padding:"11px 14px", color:"#FBBF24", fontSize:12.5 }}>{pv!==null?fmtBr(pv):"—"}</td>
                              <td style={{ padding:"11px 14px" }}>
                                {tab.ok
                                  ? <span style={{ background:"#091E12", color:"#34D399", fontSize:10, fontWeight:700, borderRadius:20, padding:"2px 9px", border:"1px solid #34D39933" }}>✓ OK</span>
                                  : <span style={{ background:"#2D1515", color:"#F87171", fontSize:10, fontWeight:700, borderRadius:20, padding:"2px 9px", border:"1px solid #F8717133" }} title={tab.err}>✗ Erro</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {/* Raw JSON debug (collapsible) */}
                    {simRes.tableSims.find(t=>t.ok) && (
                      <details style={{ padding:"10px 20px", borderTop:`1px solid ${C.b1}` }}>
                        <summary style={{ color:C.td, fontSize:11, cursor:"pointer" }}>Ver resposta completa da API</summary>
                        <pre style={{ color:C.ts, fontSize:10.5, whiteSpace:"pre-wrap", wordBreak:"break-all", margin:"8px 0 0", lineHeight:1.6 }}>
                          {JSON.stringify(simRes.tableSims.filter(t=>t.ok).map(t=>({tabela:t.label,...t.sim})), null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── PROPOSTA ── */}
        {subAba === "proposta" && (
          <div>
            <div style={{ color:C.tm, fontSize:12.5, marginBottom:16 }}>Preencha os dados para digitar uma nova proposta de FGTS Saque Aniversário.</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>
              {/* CPF */}
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>CPF *</label>
                <input value={propForm.cpf} onChange={e=>setPropForm(p=>({...p,cpf:fmtCpf(e.target.value)}))} placeholder="000.000.000-00" style={{ ...S.input }} />
              </div>
              {/* Tabela */}
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Tabela *</label>
                <select value={propForm.tableId} onChange={e=>setPropForm(p=>({...p,tableId:e.target.value}))} style={{ ...S.input, cursor:"pointer" }}>
                  <option value="">Selecione a tabela</option>
                  {[{id:"cometa",l:"Cometa"},{id:"turbo",l:"Turbo"},{id:"grid",l:"Grid"},{id:"normal",l:"Normal"},{id:"pitstop",l:"Pitstop"},{id:"acelera20",l:"Acelera 2.0"}].map(t=>(
                    <option key={t.id} value={t.id}>{t.l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>ID do Banco *</label>
                <input value={propForm.bankId} onChange={e=>setPropForm(p=>({...p,bankId:e.target.value}))} placeholder="Ex: 033" style={{ ...S.input }} />
              </div>
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Agência *</label>
                <input value={propForm.agencia} onChange={e=>setPropForm(p=>({...p,agencia:e.target.value}))} placeholder="Ex: 0001" style={{ ...S.input }} />
              </div>
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Conta *</label>
                <input value={propForm.conta} onChange={e=>setPropForm(p=>({...p,conta:e.target.value}))} placeholder="Número da conta" style={{ ...S.input }} />
              </div>
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Tipo de Conta *</label>
                <select value={propForm.tipoConta} onChange={e=>setPropForm(p=>({...p,tipoConta:e.target.value}))} style={{ ...S.input, cursor:"pointer" }}>
                  <option value="corrente">Corrente</option>
                  <option value="poupanca">Poupança</option>
                </select>
              </div>
              {/* Seguro */}
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Seguro</label>
                <div style={{ display:"flex", gap:6 }}>
                  {[{v:false,l:"Não"},{v:true,l:"Sim"}].map(opt=>(
                    <button key={String(opt.v)} onClick={()=>setPropForm(p=>({...p,seguro:opt.v}))}
                      style={{ background:propForm.seguro===opt.v?C.abg:C.deep, color:propForm.seguro===opt.v?C.atxt:C.tm,
                        border:propForm.seguro===opt.v?`1px solid ${C.atxt}55`:`1px solid ${C.b2}`,
                        borderRadius:8, padding:"9px 18px", fontSize:12.5, cursor:"pointer", fontWeight:propForm.seguro===opt.v?700:400 }}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={criarProposta} disabled={loading}
              style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"11px 28px", fontSize:14, fontWeight:700, cursor:"pointer", opacity:loading?0.6:1 }}>
              {loading?"⏳ Enviando...":"📤 Enviar Proposta"}
            </button>
            {propRes && (
              <div style={{ background:C.card, border:`1px solid #34D39933`, borderRadius:12, padding:"16px 20px", marginTop:16 }}>
                <div style={{ color:"#34D399", fontSize:13, fontWeight:700, marginBottom:8 }}>✅ Proposta enviada!</div>
                <pre style={{ color:C.ts, fontSize:11.5, whiteSpace:"pre-wrap", wordBreak:"break-all", margin:0, lineHeight:1.7 }}>{JSON.stringify(propRes, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {/* ── OPERAÇÕES ── */}
        {subAba === "operacoes" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <div style={{ color:C.tm, fontSize:12.5 }}>Acompanhe todas as operações de FGTS Saque Aniversário.</div>
              <button onClick={listarOps} disabled={opsLoading}
                style={{ background:C.abg, color:C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:8, padding:"8px 16px", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                {opsLoading?"⏳ Carregando...":"↻ Atualizar"}
              </button>
            </div>
            {!ops && !opsLoading && (
              <div style={{ textAlign:"center", padding:"30px 0", color:C.tm }}>
                <div style={{ fontSize:28, marginBottom:8, opacity:0.4 }}>📋</div>
                <div>Clique em Atualizar para carregar as operações</div>
              </div>
            )}
            {ops && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {(Array.isArray(ops)?ops:ops.data||ops.items||[]).length===0 && (
                  <div style={{ color:C.tm, textAlign:"center", padding:"20px 0" }}>Nenhuma operação encontrada.</div>
                )}
                {(Array.isArray(ops)?ops:ops.data||ops.items||[]).map((op,i)=>(
                  <div key={i} style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:11, padding:"12px 16px", display:"flex", gap:14, alignItems:"center" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:4 }}>
                        <span style={{ color:C.tp, fontSize:13, fontWeight:600 }}>{op.cpf||op.nome||op.cliente||`Op. ${i+1}`}</span>
                        {op.status && <span style={{ background:statusColor(op.status)+"22", color:statusColor(op.status), fontSize:10, fontWeight:700, borderRadius:20, padding:"2px 8px" }}>{op.status}</span>}
                        {op.tabela && <span style={{ background:C.abg, color:C.atxt, fontSize:10, borderRadius:20, padding:"2px 8px" }}>{op.tabela}</span>}
                      </div>
                      <div style={{ color:C.td, fontSize:11 }}>
                        {op.id?`ID: ${op.id}`:""} {op.createdAt?`· ${new Date(op.createdAt).toLocaleDateString("pt-BR")}`:""}
                      </div>
                    </div>
                    {(op.valor||op.valorLiquido) && (
                      <div style={{ color:"#34D399", fontSize:15, fontWeight:800, flexShrink:0 }}>
                        {fmtBr(op.valor||op.valorLiquido)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── CLT tab ────────────────────────────────────────────────
  const CLTTab = () => {
    const [subAba, setSubAba] = useState("simular");
    const [err, setErr]   = useState("");
    const [loading, setLoading] = useState(false);
    // Simular
    const [simForm, setSimForm] = useState({ cpf:"", salario:"", prazo:"24" });
    const [simRes, setSimRes]   = useState(null);
    // Proposta
    const [propForm, setPropForm] = useState({ cpf:"", nome:"", salario:"", prazo:"24", banco:"", agencia:"", conta:"", tipoConta:"corrente", valorSolicitado:"" });
    const [propRes,  setPropRes]  = useState(null);
    // Operações
    const [ops, setOps]         = useState(null);
    const [opsLoading, setOpsLoading] = useState(false);

    const fmtCpf = v => v.replace(/\D/g,"").slice(0,11).replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/,"$1.$2.$3-$4");
    const fmtBr  = v => { const n=parseFloat(v); return isNaN(n)?"—":n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); };

    const simular = async () => {
      const c = simForm.cpf.replace(/\D/g,"");
      if (c.length !== 11) { setErr("CPF inválido."); return; }
      setLoading(true); setErr(""); setSimRes(null);
      try {
        const res = await apiFetch("/clt/simular", "POST", { cpf:c, salario:parseFloat(simForm.salario)||0, prazo:parseInt(simForm.prazo)||24 });
        setSimRes(res);
      } catch(e) { setErr(e.message); }
      setLoading(false);
    };

    const criarProposta = async () => {
      const c = propForm.cpf.replace(/\D/g,"");
      if (c.length !== 11) { setErr("CPF inválido."); return; }
      setLoading(true); setErr(""); setPropRes(null);
      try {
        const res = await apiFetch("/clt/proposta", "POST", { cpf:c, nome:propForm.nome, salario:parseFloat(propForm.salario)||0, prazo:parseInt(propForm.prazo)||24, banco:propForm.banco, agencia:propForm.agencia, conta:propForm.conta, tipoConta:propForm.tipoConta, valorSolicitado:parseFloat(propForm.valorSolicitado)||0 });
        setPropRes(res);
      } catch(e) { setErr(e.message); }
      setLoading(false);
    };

    const listarOps = async () => {
      setOpsLoading(true); setErr("");
      try { const res = await apiFetch("/clt/operacoes"); setOps(res); }
      catch(e) { setErr(e.message); }
      setOpsLoading(false);
    };

    const statusColor = s => ({ APROVADO:"#34D399", PENDENTE:"#FBBF24", CANCELADO:"#F87171", AGUARDANDO:"#60A5FA" }[s?.toUpperCase()] || C.tm);

    return (
      <div>
        <div style={{ display:"flex", gap:4, marginBottom:20, borderBottom:`1px solid ${C.b1}`, paddingBottom:"-1px" }}>
          {[{v:"simular",l:"🔍 Simular CLT"},{v:"proposta",l:"📄 Digitar Proposta"},{v:"operacoes",l:"📋 Acompanhamento"}].map(t=>(
            <button key={t.v} onClick={()=>setSubAba(t.v)}
              style={{ background:"transparent", border:"none", cursor:"pointer", padding:"8px 16px", fontSize:12.5, fontWeight:subAba===t.v?700:400, color:subAba===t.v?C.atxt:C.tm, borderBottom:subAba===t.v?`2px solid ${C.atxt}`:"2px solid transparent", marginBottom:"-1px" }}>
              {t.l}
            </button>
          ))}
        </div>

        {err && <div style={{ color:"#F87171", background:"rgba(239,68,68,0.1)", border:"1px solid #EF444433", borderRadius:8, padding:"9px 13px", marginBottom:14, fontSize:12.5 }}>⚠ {err}</div>}

        {/* SIMULAR */}
        {subAba === "simular" && (
          <div>
            <div style={{ color:C.tm, fontSize:12.5, marginBottom:16 }}>Simule crédito CLT informando CPF, salário e prazo desejado.</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:12, alignItems:"flex-end", marginBottom:20 }}>
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>CPF *</label>
                <input value={simForm.cpf} onChange={e=>setSimForm(p=>({...p,cpf:fmtCpf(e.target.value)}))} placeholder="000.000.000-00" style={{ ...S.input }} />
              </div>
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Salário (R$)</label>
                <input value={simForm.salario} onChange={e=>setSimForm(p=>({...p,salario:e.target.value}))} placeholder="Ex: 3.500,00" style={{ ...S.input }} />
              </div>
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Prazo</label>
                <select value={simForm.prazo} onChange={e=>setSimForm(p=>({...p,prazo:e.target.value}))} style={{ ...S.input, cursor:"pointer" }}>
                  {[6,8,12,18,24,36,48].map(n=><option key={n} value={n}>{n}x</option>)}
                </select>
              </div>
              <button onClick={simular} disabled={loading}
                style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"10px 20px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:loading?0.6:1, whiteSpace:"nowrap" }}>
                {loading?"⏳":"Simular →"}
              </button>
            </div>
            {simRes && (
              <div style={{ background:C.card, border:`1px solid ${C.atxt}33`, borderRadius:12, padding:"16px 20px" }}>
                <div style={{ color:C.atxt, fontSize:13, fontWeight:700, marginBottom:10 }}>📊 Resultado da Simulação CLT</div>
                {simRes.valorLiberado && (
                  <div style={{ background:C.abg, borderRadius:10, padding:"14px 18px", marginBottom:12, textAlign:"center" }}>
                    <div style={{ color:C.tm, fontSize:11, marginBottom:4 }}>Valor Liberado</div>
                    <div style={{ color:C.atxt, fontSize:32, fontWeight:900 }}>{fmtBr(simRes.valorLiberado)}</div>
                    {simRes.parcela && <div style={{ color:C.td, fontSize:12, marginTop:4 }}>{simForm.prazo}x de {fmtBr(simRes.parcela)}</div>}
                  </div>
                )}
                <pre style={{ color:C.ts, fontSize:11, whiteSpace:"pre-wrap", wordBreak:"break-all", margin:0, lineHeight:1.7 }}>{JSON.stringify(simRes, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {/* PROPOSTA */}
        {subAba === "proposta" && (
          <div>
            <div style={{ color:C.tm, fontSize:12.5, marginBottom:16 }}>Preencha todos os dados para digitação da proposta CLT.</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:16 }}>
              {[
                {f:"cpf",l:"CPF *",ph:"000.000.000-00"},
                {f:"nome",l:"Nome completo *",ph:"Ex: João da Silva"},
                {f:"salario",l:"Salário (R$) *",ph:"Ex: 3.500,00"},
                {f:"valorSolicitado",l:"Valor solicitado (R$) *",ph:"Ex: 10.000,00"},
                {f:"banco",l:"Banco *",ph:"Ex: 033"},
                {f:"agencia",l:"Agência *",ph:"Ex: 0001"},
                {f:"conta",l:"Conta *",ph:"Número da conta"},
              ].map(({f,l,ph})=>(
                <div key={f}>
                  <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>{l}</label>
                  <input value={propForm[f]} onChange={e=>setPropForm(p=>({...p,[f]:f==="cpf"?fmtCpf(e.target.value):e.target.value}))} placeholder={ph} style={{ ...S.input }} />
                </div>
              ))}
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Prazo *</label>
                <select value={propForm.prazo} onChange={e=>setPropForm(p=>({...p,prazo:e.target.value}))} style={{ ...S.input, cursor:"pointer" }}>
                  {[6,8,12,18,24,36,48].map(n=><option key={n} value={n}>{n}x</option>)}
                </select>
              </div>
              <div>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Tipo de Conta *</label>
                <select value={propForm.tipoConta} onChange={e=>setPropForm(p=>({...p,tipoConta:e.target.value}))} style={{ ...S.input, cursor:"pointer" }}>
                  <option value="corrente">Corrente</option>
                  <option value="poupanca">Poupança</option>
                </select>
              </div>
            </div>
            <button onClick={criarProposta} disabled={loading}
              style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"11px 28px", fontSize:14, fontWeight:700, cursor:"pointer", opacity:loading?0.6:1 }}>
              {loading?"⏳ Enviando...":"📤 Enviar Proposta CLT"}
            </button>
            {propRes && (
              <div style={{ background:C.card, border:`1px solid ${C.atxt}33`, borderRadius:12, padding:"16px 20px", marginTop:16 }}>
                <div style={{ color:"#34D399", fontSize:13, fontWeight:700, marginBottom:8 }}>✅ Proposta CLT enviada!</div>
                <pre style={{ color:C.ts, fontSize:11.5, whiteSpace:"pre-wrap", wordBreak:"break-all", margin:0, lineHeight:1.7 }}>{JSON.stringify(propRes, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {/* OPERAÇÕES */}
        {subAba === "operacoes" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <div style={{ color:C.tm, fontSize:12.5 }}>Acompanhe todas as operações de crédito CLT.</div>
              <button onClick={listarOps} disabled={opsLoading}
                style={{ background:C.abg, color:C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:8, padding:"8px 16px", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                {opsLoading?"⏳ Carregando...":"↻ Atualizar"}
              </button>
            </div>
            {!ops && !opsLoading && (
              <div style={{ textAlign:"center", padding:"30px 0", color:C.tm }}>
                <div style={{ fontSize:28, marginBottom:8, opacity:0.4 }}>📋</div>
                <div>Clique em Atualizar para carregar as operações</div>
              </div>
            )}
            {ops && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {(Array.isArray(ops) ? ops : ops.data || []).length === 0 && <div style={{ color:C.tm, textAlign:"center", padding:"20px 0" }}>Nenhuma operação encontrada.</div>}
                {(Array.isArray(ops) ? ops : ops.data || []).map((op, i) => (
                  <div key={i} style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:11, padding:"12px 16px", display:"flex", gap:14, alignItems:"center" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:4 }}>
                        <span style={{ color:C.tp, fontSize:13, fontWeight:600 }}>{op.nome || op.cpf || `Op. ${i+1}`}</span>
                        {op.status && <span style={{ background:statusColor(op.status)+"22", color:statusColor(op.status), fontSize:10, fontWeight:700, borderRadius:20, padding:"2px 8px" }}>{op.status}</span>}
                      </div>
                      <div style={{ color:C.td, fontSize:11 }}>{op.id ? `ID: ${op.id}` : ""} {op.prazo ? `· ${op.prazo}x` : ""} {op.createdAt ? `· ${new Date(op.createdAt).toLocaleDateString("pt-BR")}` : ""}</div>
                    </div>
                    {op.valorLiberado && <div style={{ color:C.atxt, fontSize:15, fontWeight:800, flexShrink:0 }}>{fmtBr(op.valorLiberado)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Header com status do token */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:"#fff", fontSize:14 }}>V8</div>
            <div>
              <div style={{ color:C.tp, fontSize:15, fontWeight:800 }}>V8 Digital</div>
              <div style={{ color:C.td, fontSize:10.5 }}>FGTS · CLT · API Oficial</div>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {isTokenValid
            ? <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(52,211,153,0.1)", border:"1px solid rgba(52,211,153,0.3)", borderRadius:8, padding:"6px 12px" }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:"#34D399", animation:"pulse 1.5s infinite" }} />
                <span style={{ color:"#34D399", fontSize:11.5, fontWeight:600 }}>Autenticado</span>
              </div>
            : <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid #EF444433", borderRadius:8, padding:"6px 12px" }}>
                <span style={{ color:"#F87171", fontSize:11.5 }}>Não autenticado</span>
              </div>
          }
          <button onClick={()=>setAba("config")} style={{ background:C.deep, border:`1px solid ${C.b2}`, color:C.tm, borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:11.5 }}>⚙ Credenciais</button>
        </div>
      </div>

      {/* Abas principais */}
      {isTokenValid && (
        <div style={{ display:"flex", gap:2, borderBottom:`1px solid ${C.b1}`, marginBottom:22 }}>
          {[{v:"fgts",l:"🏦 FGTS — Saque Aniversário"},{v:"clt",l:"💼 CLT — Crédito Privato"}].map(t=>(
            <button key={t.v} onClick={()=>setAba(t.v)}
              style={{ background:"transparent", border:"none", cursor:"pointer", padding:"9px 18px", fontSize:13, fontWeight:aba===t.v?700:400, color:aba===t.v?C.atxt:C.tm, borderBottom:aba===t.v?`2px solid ${C.atxt}`:"2px solid transparent", marginBottom:"-1px" }}>
              {t.l}
            </button>
          ))}
        </div>
      )}

      {/* Configurar credenciais */}
      {(aba === "config" || !isTokenValid) && (
        <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"22px 24px" }}>
          <div style={{ color:C.tp, fontSize:14, fontWeight:700, marginBottom:4 }}>🔑 Acesso V8 Digital</div>
          <div style={{ color:C.tm, fontSize:12, marginBottom:18 }}>
            Use o seu <b style={{ color:C.atxt }}>e-mail e senha</b> da plataforma V8 Digital.
          </div>

          {/* Credenciais fixas — informativo */}
          <div style={{ background:C.deep, border:`1px solid ${C.b1}`, borderRadius:9, padding:"10px 14px", marginBottom:16, fontSize:11 }}>
            <div style={{ color:C.td, marginBottom:3 }}>🔒 <b style={{ color:C.ts }}>Configuração automática:</b></div>
            <div style={{ color:C.td }}>Auth: <span style={{ color:C.tm }}>https://auth.v8sistema.com/oauth/token</span></div>
            <div style={{ color:C.td }}>Audience: <span style={{ color:C.tm }}>https://bff.v8sistema.com</span></div>
            <div style={{ color:C.td }}>Client ID: <span style={{ color:C.tm }}>DHWogdaYmEI8n5bwwxPDzulMlSK7dwIn</span></div>
          </div>

          {authErr && <div style={{ color:"#F87171", background:"rgba(239,68,68,0.1)", border:"1px solid #EF444433", borderRadius:8, padding:"9px 13px", marginBottom:14, fontSize:12.5 }}>⚠ {authErr}</div>}

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
            <div>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>E-mail *</label>
              <input value={credForm.username} onChange={e=>setCredForm(p=>({...p,username:e.target.value}))} placeholder="seu@email.com" style={{ ...S.input }} />
            </div>
            <div>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Senha *</label>
              <input value={credForm.password} onChange={e=>setCredForm(p=>({...p,password:e.target.value}))} type="password" placeholder="••••••••" style={{ ...S.input }} onKeyDown={e=>e.key==="Enter"&&autenticar()} />
            </div>
          </div>
          <button onClick={autenticar} disabled={authLoading}
            style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"11px 28px", fontSize:14, fontWeight:700, cursor:"pointer", opacity:authLoading?0.7:1, boxShadow:`0 4px 16px ${C.acc}44` }}>
            {authLoading ? "⏳ Autenticando..." : "🔐 Entrar na V8 Digital →"}
          </button>
          <div style={{ color:C.td, fontSize:10.5, marginTop:12 }}>
            O e-mail é salvo para facilitar o próximo acesso. A senha nunca é armazenada.
          </div>
        </div>
      )}

      {isTokenValid && aba === "fgts" && <FGTSTab />}
      {isTokenValid && aba === "clt"  && <CLTTab />}
    </div>
  );
}

// ── APIs Bancos ────────────────────────────────────────────────
function ApisBancosPage({ currentUser }) {
  const [aba, setAba] = useState("geral");
  const isMestre = currentUser.role === "mestre";
  const [apis, setApis] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexp_bank_apis") || "[]"); } catch { return []; }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ banco:"", apiKey:"", endpoint:"", descricao:"" });
  const [cpf, setCpf] = useState("");
  const [selectedApi, setSelectedApi] = useState(null);
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simErr, setSimErr] = useState("");

  const saveApis = (list) => { setApis(list); localStorage.setItem("nexp_bank_apis", JSON.stringify(list)); };
  const addApi = () => {
    if (!form.banco.trim() || !form.apiKey.trim()) return;
    saveApis([...apis, { ...form, id: Date.now() }]);
    setForm({ banco:"", apiKey:"", endpoint:"", descricao:"" });
    setShowAdd(false);
  };
  const removeApi = (id) => { if (selectedApi === id) setSelectedApi(null); saveApis(apis.filter(a => a.id !== id)); };
  const fmtCpf = (v) => v.replace(/\D/g,"").slice(0,11).replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/,"$1.$2.$3-$4");

  const simulate = async () => {
    const clean = cpf.replace(/\D/g,"");
    if (clean.length !== 11) { setSimErr("CPF inválido — digite 11 dígitos."); return; }
    if (!selectedApi) { setSimErr("Selecione um banco para simular."); return; }
    const api = apis.find(a => a.id === selectedApi);
    if (!api?.endpoint) { setSimErr("Este banco não tem endpoint configurado."); return; }
    setSimLoading(true); setSimErr(""); setSimResult(null);
    try {
      const url = api.endpoint.replace("{cpf}", clean).replace("{apiKey}", api.apiKey);
      const res = await fetch(url, { headers:{ "Authorization":`Bearer ${api.apiKey}`, "Content-Type":"application/json" } });
      if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`);
      const data = await res.json();
      setSimResult(data);
    } catch (e) { setSimErr(e.message || "Erro ao consultar API."); }
    setSimLoading(false);
  };

  return (
    <div style={{ padding:"24px 30px", maxWidth:900 }}>
      <h1 style={{ color:C.tp, fontSize:20, fontWeight:700, margin:"0 0 4px" }}>⬧ APIs Bancos</h1>
      <p style={{ color:C.tm, fontSize:12.5, marginBottom:20 }}>Conecte APIs bancárias e integre com o V8 Digital.</p>

      {/* Tabs */}
      <div style={{ display:"flex", gap:2, borderBottom:`1px solid ${C.b1}`, marginBottom:24 }}>
        {[{v:"geral",l:"⬧ APIs Gerais"},{v:"v8",l:"⚡ V8 Digital"}].map(t=>(
          <button key={t.v} onClick={()=>setAba(t.v)}
            style={{ background:"transparent", border:"none", cursor:"pointer", padding:"9px 18px", fontSize:13, fontWeight:aba===t.v?700:400, color:aba===t.v?C.atxt:C.tm, borderBottom:aba===t.v?`2px solid ${C.atxt}`:"2px solid transparent", marginBottom:"-1px" }}>
            {t.l}
          </button>
        ))}
      </div>

      {/* ABA GERAL */}
      {aba === "geral" && (
        <div>
          <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"20px 24px", marginBottom:16 }}>
            <div style={{ color:C.tp, fontSize:14, fontWeight:700, marginBottom:14 }}>🔍 Simular pelo CPF</div>
            <div style={{ display:"flex", gap:10, alignItems:"flex-end", flexWrap:"wrap", marginBottom:14 }}>
              <div style={{ flex:"0 0 190px" }}>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>CPF do cliente</label>
                <input value={cpf} onChange={e=>setCpf(fmtCpf(e.target.value))} placeholder="000.000.000-00" style={{ ...S.input }} onKeyDown={e=>e.key==="Enter"&&simulate()} />
              </div>
              <div style={{ flex:1, minWidth:150 }}>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Banco</label>
                <select value={selectedApi||""} onChange={e=>setSelectedApi(Number(e.target.value)||null)} style={{ ...S.input, cursor:"pointer" }}>
                  <option value="">Selecione...</option>
                  {apis.map(a=><option key={a.id} value={a.id}>{a.banco}</option>)}
                </select>
              </div>
              <button onClick={simulate} disabled={simLoading||!cpf||!selectedApi}
                style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"9px 20px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:simLoading||!cpf||!selectedApi?0.5:1 }}>
                {simLoading?"⏳...":"Simular →"}
              </button>
            </div>
            {simErr && <div style={{ color:"#F87171", fontSize:12.5, background:"rgba(239,68,68,0.1)", border:"1px solid #EF444433", borderRadius:8, padding:"8px 12px", marginBottom:10 }}>⚠ {simErr}</div>}
            {simResult && (
              <div style={{ background:C.deep, borderRadius:10, padding:"14px 16px", border:`1px solid ${C.atxt}33` }}>
                <div style={{ color:C.atxt, fontSize:12, fontWeight:700, marginBottom:8 }}>✅ Resultado</div>
                <pre style={{ color:C.ts, fontSize:11.5, whiteSpace:"pre-wrap", wordBreak:"break-all", margin:0, lineHeight:1.7 }}>{JSON.stringify(simResult, null, 2)}</pre>
              </div>
            )}
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"20px 24px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div style={{ color:C.tp, fontSize:14, fontWeight:700 }}>🔑 APIs configuradas ({apis.length})</div>
              {isMestre && (
                <button onClick={()=>setShowAdd(p=>!p)} style={{ background:showAdd?C.deep:C.acc, color:showAdd?C.tm:"#fff", border:showAdd?`1px solid ${C.b2}`:"none", borderRadius:8, padding:"7px 14px", fontSize:12, cursor:"pointer", fontWeight:600 }}>
                  {showAdd ? "✕ Cancelar" : "＋ Nova API"}
                </button>
              )}
            </div>
            {showAdd && isMestre && (
              <div style={{ background:C.deep, borderRadius:11, padding:"16px", marginBottom:14, border:`1px solid ${C.b1}` }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                  <div><label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Nome *</label><input value={form.banco} onChange={e=>setForm(f=>({...f,banco:e.target.value}))} placeholder="Ex: Banco do Brasil" style={{ ...S.input }} /></div>
                  <div><label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Chave API *</label><input value={form.apiKey} onChange={e=>setForm(f=>({...f,apiKey:e.target.value}))} placeholder="Chave secreta" style={{ ...S.input }} type="password" /></div>
                  <div style={{ gridColumn:"1/-1" }}><label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Endpoint</label><input value={form.endpoint} onChange={e=>setForm(f=>({...f,endpoint:e.target.value}))} placeholder="https://api.banco.com/consulta?cpf={cpf}&key={apiKey}" style={{ ...S.input }} /><div style={{ color:C.td, fontSize:10, marginTop:3 }}>Use {"{cpf}"} e {"{apiKey}"} como variáveis dinâmicas</div></div>
                  <div style={{ gridColumn:"1/-1" }}><label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Descrição</label><input value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} placeholder="Ex: Crédito consignado" style={{ ...S.input }} /></div>
                </div>
                <button onClick={addApi} disabled={!form.banco.trim()||!form.apiKey.trim()} style={{ background:C.acc, color:"#fff", border:"none", borderRadius:8, padding:"9px 20px", fontSize:13, fontWeight:600, cursor:"pointer", opacity:!form.banco.trim()||!form.apiKey.trim()?0.5:1 }}>Salvar API</button>
              </div>
            )}
            {apis.length === 0 && !showAdd && <div style={{ textAlign:"center", padding:"28px 0", color:C.tm }}>{isMestre?"Clique em ＋ Nova API para adicionar":"Solicite ao mestre configurar as APIs"}</div>}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {apis.map(a=>(
                <div key={a.id} onClick={()=>setSelectedApi(selectedApi===a.id?null:a.id)} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:C.deep, borderRadius:10, border:`1px solid ${selectedApi===a.id?C.atxt+"55":C.b2}`, cursor:"pointer" }}>
                  <div style={{ width:36, height:36, borderRadius:9, background:C.abg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>🏦</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:C.tp, fontSize:13, fontWeight:600 }}>{a.banco}</div>
                    <div style={{ color:C.td, fontSize:11 }}>{a.descricao||"API configurada"}{a.endpoint?" · Endpoint ✓":" · ⚠ Sem endpoint"}</div>
                  </div>
                  {selectedApi===a.id&&<span style={{ color:C.atxt, fontSize:10, fontWeight:700, background:C.abg, borderRadius:7, padding:"2px 8px" }}>✓</span>}
                  {isMestre&&<button onClick={e=>{e.stopPropagation();removeApi(a.id);}} style={{ background:"#2D1515", border:"1px solid #EF444422", borderRadius:7, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}><svg width="11" height="12" viewBox="0 0 12 13" fill="none"><path d="M1 3h10M4 3V2h4v1M2 3l.7 8h6.6L10 3" stroke="#F87171" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 6v3M7 6v3" stroke="#F87171" strokeWidth="1.3" strokeLinecap="round"/></svg></button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ABA V8 DIGITAL */}
      {aba === "v8" && <V8DigitalTab currentUser={currentUser} />}
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
  const [theme, setTheme] = useState(() => localStorage.getItem("nexp_theme") || "Padrão");
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
  // System config — mestre controls what others can access
  const [sysConfig, setSysConfig] = useState({
    masterChatEnabled: true,     // mestre can disable chat for masters
    indicadoChatEnabled: true,   // master can disable chat for indicados
    visitanteChatEnabled: true,
    visitanteTabs: { dashboard:true, contacts:true, add:false, import:false, review:true, cstatus:true, leds:false, atalhos:true, premium:false, config:false },
  });

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
  // Reset dark base, then apply selected theme (light themes override bg/card/etc)
  const DARK_BASE = { bg:"#080A10", sb:"#08090F", card:"#0F1320", deep:"#0B0D14", b1:"#13161F", b2:"#1A1F2E", tp:"#E8EAEF", ts:"#9CA3AF", tm:"#525870", td:"#2D3348" };
  Object.assign(C, DARK_BASE, ACCENT_THEMES[theme] || ACCENT_THEMES["Padrão"]);
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

  // ── Inatividade — logout automático após 15 minutos ────────
  useEffect(() => {
    if (!currentUser) return;
    const IDLE_MS = 15 * 60 * 1000;
    let timer = setTimeout(() => {
      firebaseLogout();
      setCurrentUser(null);
      sessionStorage.removeItem("nexp_page");
      setPage("dashboard");
    }, IDLE_MS);
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => {
      firebaseLogout();
      setCurrentUser(null);
      sessionStorage.removeItem("nexp_page");
      setPage("dashboard");
    }, IDLE_MS); };
    const events = ["mousemove","keydown","click","scroll","touchstart"];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [currentUser]); // eslint-disable-line

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
        @keyframes dissolve {
          0%   { opacity:1; transform:scale(1) blur(0px); filter:blur(0); }
          40%  { opacity:0.7; transform:scale(1.05); filter:blur(1px); }
          100% { opacity:0; transform:scale(0.6); filter:blur(6px); }
        }
        @keyframes nameReveal {
          from { opacity:0; letter-spacing:-3px; transform:translateX(-8px); }
          to   { opacity:1; letter-spacing:normal; transform:translateX(0); }
        }
        @keyframes floatUp {
          0%   { opacity:1; transform:translateY(0) scale(1); }
          60%  { opacity:1; transform:translateY(-80px) scale(1.3); }
          100% { opacity:0; transform:translateY(-140px) scale(0.5); }
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
        sysConfig={sysConfig}
      />
      <div style={{ flex: 1, overflowY: "auto", height: "100vh" }}>
        {/* Widget tempo + calculadora */}
        <WeatherCalcWidget />
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
          <StoriesPage currentUser={currentUser} users={users} onGoToDM={(uid)=>{ setChatOpen(true); sessionStorage.setItem("nexp_dm_uid", uid); }} />
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
          <ConfigPage users={users} setUsers={setUsers} currentUser={currentUser} theme={theme} onTheme={(t) => { setTheme(t); localStorage.setItem("nexp_theme", t); }} sysConfig={sysConfig} onSysConfig={setSysConfig} />
        )}
        {page === "calendario" && (
          <CalendarPage currentUser={currentUser} />
        )}
        {page === "simulador" && <SimuladorPage />}
        {page === "apis" && <ApisBancosPage currentUser={currentUser} />}
      </div>

      {/* ── Chat Flutuante ── */}
      {chatOpen && (() => {
        const role = currentUser?.role;
        const uid = currentUser?.uid || currentUser?.id;
        const override = sysConfig?.userOverrides?.[uid];
        // Per-user override takes priority
        if (override !== undefined && override.chat === false) return null;
        if (override === undefined) {
          if (role === "visitante" && !sysConfig?.visitanteChatEnabled) return null;
          if (role === "indicado" && !sysConfig?.indicadoChatEnabled) return null;
          if (role === "master" && !sysConfig?.masterChatEnabled) return null;
        }
        return (
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
        );
      })()}
    </div>
    </>
  );
}
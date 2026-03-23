import React, { useState, useRef, useEffect } from "react";
import { initializeApp as initFirebaseApp } from "firebase/app";
import { onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider, updatePassword, getAuth, signInWithEmailAndPassword as signInSecondary } from "firebase/auth";
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
import { uploadArquivo } from "./firebase";

// ── Compressão de imagem via Canvas (máx 1200px, qualidade 82%) ──
async function comprimirImagem(base64, maxW=1200, quality=0.82) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      res(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => res(base64);
    img.src = base64;
  });
}

// ── Upload para Cloudinary (opcional — configure se quiser 25 GB grátis) ──
const CLOUDINARY_CLOUD = ""; // deixe vazio para usar só Firebase
const CLOUDINARY_PRESET = "nexp_docs";

async function uploadCloudinary(base64, fileName) {
  if (!CLOUDINARY_CLOUD) throw new Error("Cloudinary não configurado");
  const formData = new FormData();
  formData.append("file", base64);
  formData.append("upload_preset", CLOUDINARY_PRESET);
  formData.append("folder", "nexp_propostas");
  formData.append("public_id", `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g,"_")}`);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`, {
    method: "POST", body: formData,
  });
  if (!r.ok) throw new Error("Cloudinary " + r.status);
  const d = await r.json();
  return d.secure_url;
}

// ── Upload inteligente: comprime imagem → Firebase Storage (Cloudinary se configurado) ──
async function uploadArquivoOtimizado(base64, fileName, tipo, propId) {
  let dadoFinal = base64;
  // 1. Comprimir imagem
  if (tipo?.startsWith("image/")) {
    try { dadoFinal = await comprimirImagem(base64); } catch {}
  }
  // 2. Cloudinary (se configurado)
  if (CLOUDINARY_CLOUD) {
    try { return { url: await uploadCloudinary(dadoFinal, fileName), source: "cloudinary" }; } catch {}
  }
  // 3. Firebase Storage (principal)
  try {
    const path = `propostas/${propId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const url = await uploadArquivo(dadoFinal, path);
    return { url, source: "firebase", path };
  } catch (err) {
    console.error("Upload Firebase falhou:", err);
  }
  // 4. Fallback: base64 direto (sem storage externo — funciona mas usa espaço no Firestore)
  return { url: dadoFinal, source: "local" };
}

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
// ── Nova Hierarquia de Usuários ──────────────────────────────────
// Níveis: 0=administrador(dono) > 1=gerente > 2=supervisor > 3=operador
const ROLE_HIERARCHY = {
  administrador: 0,
  gerente:        1,
  supervisor:     2,
  operador:       3,
  // aliases legados — mapeados internamente
  mestre:         0,
  master:         1,
  indicado:       3,
  visitante:      3,
  digitador:      3,
};
const ROLE_LABEL = {
  administrador: "Administrador",
  gerente:       "Gerente Comercial",
  supervisor:    "Supervisor",
  operador:      "Operador",
  // legados
  mestre:        "Administrador",
  master:        "Gerente Comercial",
  indicado:      "Operador",
  visitante:     "Operador",
  digitador:     "Operador",
};
const ROLE_COLOR = {
  administrador: "#C084FC",
  gerente:       "#4F8EF7",
  supervisor:    "#FBBF24",
  operador:      "#34D399",
  // legados
  mestre:        "#C084FC",
  master:        "#4F8EF7",
  indicado:      "#34D399",
  visitante:     "#34D399",
  digitador:     "#34D399",
};
// Quais roles um usuário pode criar (apenas abaixo do seu nível)
function getRolesCanCreate(myRole) {
  const lvl = ROLE_HIERARCHY[myRole] ?? 99;
  if (lvl === 0) return ["gerente","supervisor","operador"];   // administrador
  if (lvl === 1) return ["supervisor","operador"];             // gerente
  if (lvl === 2) return ["operador"];                          // supervisor
  return [];                                                   // operador não cria
}
// Pode ver senha de usuários abaixo
function canSeePassword(myRole, targetRole) {
  const myLvl = ROLE_HIERARCHY[myRole] ?? 99;
  const tgLvl = ROLE_HIERARCHY[targetRole] ?? 99;
  // Apenas Administrador (lvl 0) e Gerente (lvl 1) podem ver senhas de abaixo
  return myLvl <= 1 && myLvl < tgLvl;
}
// Pode editar um usuário
// Presença real: online:true E lastSeen < 3 minutos atrás
function isReallyOnline(presenceEntry) {
  if (!presenceEntry?.online) return false;
  const lastSeen = presenceEntry.lastSeen?.seconds;
  if (!lastSeen) return false;
  return (Date.now() / 1000 - lastSeen) < 180; // 3 minutos
}

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
  cep: "",
  rua: "",
  numero: "",
  bairro: "",
  cidade: "",
  complemento: "",
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


const EXAMPLE_CSV = `Nome,CPF,Telefone,Telefone2,Telefone3,CNPJ,Email,Matricula,TipoLead,Observacao,Rua,Numero,Bairro,CEP,Cidade,UF
João Silva,123.456.789-00,(11) 99999-0001,(11) 98888-0001,,12.345.678/0001-90,joao@email.com,M001,FGTS,Saldo disponível,Rua das Flores,123,Centro,59000-000,Natal,RN
Maria Santos,987.654.321-11,(21) 98888-0002,,,,,M002,INSS,Aposentada,Av. Brasil,456,Bairro Novo,20000-000,Rio de Janeiro,RJ
`;

// ── Helpers ────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  // Normaliza cabeçalho removendo acentos, espaços e caixa
  const normalize = (s) => s.trim().replace(/^"|"$/g,"").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
  const heads = lines[0].split(sep).map(normalize);
  // Mapeamento flexível — aceita variações de nome
  const fm = {
    nome:"name", name:"name",
    cpf:"cpf",
    telefone:"phone", telefone1:"phone", fone:"phone", fone1:"phone", celular:"phone", phone:"phone",
    telefone2:"phone2", fone2:"phone2", celular2:"phone2", phone2:"phone2",
    telefone3:"phone3", fone3:"phone3", celular3:"phone3", phone3:"phone3",
    cnpj:"cnpj",
    email:"email", email1:"email",
    matricula:"matricula", mat:"matricula",
    tipolead:"leadType", tipo:"leadType", lead:"leadType", tipodolead:"leadType",
    observacao:"observacao", obs:"observacao", observacoes:"observacao",
    rua:"rua", logradouro:"rua", endereco:"rua",
    numero:"numero", num:"numero",
    bairro:"bairro",
    cep:"cep",
    cidade:"cidade", municipio:"cidade",
    uf:"ufEnd", estado:"ufEnd",
  };
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line, i) => {
      const vals = line.split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
      const o = { id: Date.now() + i, ...makeBlank() };
      heads.forEach((h, idx) => {
        const f = fm[h];
        if (f && vals[idx] !== undefined && vals[idx] !== "") o[f] = vals[idx];
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
function CommSimTabs({ contact }) {
  const [scTab, setScTab] = useState("comissao");
  return (
    <>
      <div style={{ display:"flex", gap:1, borderBottom:`1px solid ${C.b1}`, marginBottom:12 }}>
        {[{id:"comissao",label:"💰 Comissão"},{id:"avisos",label:"🔔 Aviso de Comissões"}].map(t=>(
          <button key={t.id} onClick={()=>setScTab(t.id)}
            style={{ background:"transparent", border:"none", cursor:"pointer", padding:"6px 12px", fontSize:11.5, fontWeight:scTab===t.id?700:400, color:scTab===t.id?C.atxt:C.tm, borderBottom:scTab===t.id?`2px solid ${C.atxt}`:"2px solid transparent", marginBottom:"-1px" }}>
            {t.label}
          </button>
        ))}
      </div>
      {scTab === "comissao" && <CommSim compact />}
      {scTab === "avisos" && <AvisoComissoes contact={contact} />}
    </>
  );
}

function AvisoComissoes({ contact }) {
  const [avisos, setAvisos] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexp_avisos_comissao") || "[]"); } catch { return []; }
  });
  const [msg, setMsg] = useState("");
  const [valor, setValor] = useState("");
  const [venc, setVenc] = useState("");

  const salvar = () => {
    if (!msg.trim()) return;
    const novo = { id: Date.now(), msg: msg.trim(), valor: valor.trim(), venc: venc.trim(), clienteId: contact?.id || "", clienteNome: contact?.name || "", data: new Date().toLocaleDateString("pt-BR") };
    const upd = [novo, ...avisos];
    setAvisos(upd);
    localStorage.setItem("nexp_avisos_comissao", JSON.stringify(upd));
    setMsg(""); setValor(""); setVenc("");
  };

  const remover = (id) => {
    const upd = avisos.filter(a => a.id !== id);
    setAvisos(upd);
    localStorage.setItem("nexp_avisos_comissao", JSON.stringify(upd));
  };

  const doCliente = avisos.filter(a => a.clienteId === (contact?.id || ""));
  const outros = avisos.filter(a => a.clienteId !== (contact?.id || ""));

  return (
    <div>
      <div style={{ color: C.ts, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>🔔 Aviso de Comissões</div>
      <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:12 }}>
        <input value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Descrição do aviso (ex: Comissão pendente — proposta #123)"
          style={{ ...S.input, fontSize:12 }} />
        <div style={{ display:"flex", gap:8 }}>
          <input value={valor} onChange={e=>setValor(e.target.value)} placeholder="Valor (R$)" style={{ ...S.input, fontSize:12, flex:1 }} />
          <input value={venc} onChange={e=>setVenc(e.target.value)} placeholder="Vencimento" style={{ ...S.input, fontSize:12, flex:1 }} />
        </div>
        <button onClick={salvar} disabled={!msg.trim()}
          style={{ background:msg.trim()?`linear-gradient(135deg,${C.lg1},${C.lg2})`:"transparent", color:msg.trim()?"#fff":C.td, border:`1px solid ${C.b2}`, borderRadius:8, padding:"8px 14px", fontSize:12, fontWeight:600, cursor:msg.trim()?"pointer":"not-allowed" }}>
          ＋ Adicionar aviso
        </button>
      </div>
      {doCliente.length > 0 && (
        <>
          <div style={{ color:C.td, fontSize:10, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:6 }}>Avisos deste cliente</div>
          <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:12 }}>
            {doCliente.map(a=>(
              <div key={a.id} style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:8, padding:"8px 11px", display:"flex", alignItems:"flex-start", gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ color:C.tp, fontSize:12, fontWeight:600 }}>{a.msg}</div>
                  <div style={{ display:"flex", gap:10, marginTop:3, flexWrap:"wrap" }}>
                    {a.valor && <span style={{ color:"#34D399", fontSize:11 }}>💰 {a.valor}</span>}
                    {a.venc && <span style={{ color:"#FBBF24", fontSize:11 }}>📅 {a.venc}</span>}
                    <span style={{ color:C.td, fontSize:10 }}>{a.data}</span>
                  </div>
                </div>
                <button onClick={()=>remover(a.id)} style={{ background:"none", border:"none", color:"#F87171", cursor:"pointer", fontSize:15, padding:0 }}>×</button>
              </div>
            ))}
          </div>
        </>
      )}
      {outros.length > 0 && (
        <>
          <div style={{ color:C.td, fontSize:10, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:6 }}>Outros avisos</div>
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {outros.slice(0,5).map(a=>(
              <div key={a.id} style={{ background:C.deep, border:`1px solid ${C.b1}`, borderRadius:8, padding:"7px 11px", display:"flex", alignItems:"flex-start", gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ color:C.ts, fontSize:11.5, fontWeight:600 }}>{a.msg}</div>
                  <div style={{ display:"flex", gap:8, marginTop:2, flexWrap:"wrap" }}>
                    {a.clienteNome && <span style={{ color:C.tm, fontSize:10 }}>👤 {a.clienteNome}</span>}
                    {a.valor && <span style={{ color:"#34D399", fontSize:10 }}>💰 {a.valor}</span>}
                    {a.venc && <span style={{ color:"#FBBF24", fontSize:10 }}>📅 {a.venc}</span>}
                  </div>
                </div>
                <button onClick={()=>remover(a.id)} style={{ background:"none", border:"none", color:"#F87171", cursor:"pointer", fontSize:14, padding:0 }}>×</button>
              </div>
            ))}
          </div>
        </>
      )}
      {avisos.length === 0 && (
        <div style={{ color:C.td, fontSize:11.5, textAlign:"center", padding:"16px 0", opacity:0.6 }}>Nenhum aviso cadastrado ainda.</div>
      )}
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
// ── NexpRobot — robô SVG com corpo animado e 12 poses ─────────


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
    const all = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31];
    triggerPose(all[Math.floor(Math.random() * all.length)]);
  };

  // Definir pose atual
  const poses = [
    // 0: idle
    { leftArm:0,   rightArm:0,   body:0,   mouth:"neutral", eyes:"normal", anim:"float",   label:"",   walk:false },
    // 1: oi
    { leftArm:-60, rightArm:40,  body:0,   mouth:"smile",   eyes:"normal", anim:"wave",    label:"👋", walk:false },
    // 2: dança
    { leftArm:45,  rightArm:-45, body:10,  mouth:"smile",   eyes:"happy",  anim:"dance",   label:"🕺", walk:false },
    // 3: rebola
    { leftArm:30,  rightArm:30,  body:-15, mouth:"smile",   eyes:"happy",  anim:"wiggle",  label:"💃", walk:false },
    // 4: beijo
    { leftArm:20,  rightArm:-60, body:0,   mouth:"kiss",    eyes:"closed", anim:"bounce",  label:"😘", walk:false },
    // 5: pose cool
    { leftArm:-90, rightArm:-90, body:0,   mouth:"smile",   eyes:"cool",   anim:"none",    label:"😎", walk:false },
    // 6: chora
    { leftArm:15,  rightArm:15,  body:5,   mouth:"sad",     eyes:"cry",    anim:"shake",   label:"😢", walk:false },
    // 7: ri
    { leftArm:30,  rightArm:30,  body:-8,  mouth:"laugh",   eyes:"laugh",  anim:"bounce",  label:"😂", walk:false },
    // 8: pula
    { leftArm:-60, rightArm:-60, body:0,   mouth:"smile",   eyes:"happy",  anim:"jump",    label:"⬆️", walk:false },
    // 9: troféu
    { leftArm:-90, rightArm:20,  body:0,   mouth:"smile",   eyes:"star",   anim:"bounce",  label:"🏆", walk:false },
    // 10: chuta
    { leftArm:0,   rightArm:-90, body:10,  mouth:"smile",   eyes:"normal", anim:"kick",    label:"⚽", walk:false },
    // 11: beijo duplo
    { leftArm:-70, rightArm:-70, body:0,   mouth:"kiss",    eyes:"closed", anim:"float",   label:"💕", walk:false },
    // 12: apaixonado
    { leftArm:-30, rightArm:-30, body:0,   mouth:"smile",   eyes:"heart",  anim:"bounce",  label:"😍", walk:false },
    // 13: surpreso
    { leftArm:-80, rightArm:-80, body:0,   mouth:"open",    eyes:"wide",   anim:"shake",   label:"😱", walk:false },
    // 14: pensativo
    { leftArm:0,   rightArm:60,  body:5,   mouth:"neutral", eyes:"think",  anim:"float",   label:"🤔", walk:false },
    // 15: animado
    { leftArm:-90, rightArm:-90, body:-5,  mouth:"laugh",   eyes:"star",   anim:"jump",    label:"🎉", walk:false },
    // 16: envergonhado
    { leftArm:30,  rightArm:30,  body:10,  mouth:"sad",     eyes:"closed", anim:"wiggle",  label:"😳", walk:false },
    // 17: caminha pra direita
    { leftArm:30,  rightArm:-30, body:0,   mouth:"smile",   eyes:"normal", anim:"walkR",   label:"🚶", walk:"right" },
    // 18: caminha pra esquerda
    { leftArm:-30, rightArm:30,  body:0,   mouth:"smile",   eyes:"normal", anim:"walkL",   label:"🚶", walk:"left" },
    // 19: medita
    { leftArm:45,  rightArm:-45, body:0,   mouth:"neutral", eyes:"closed", anim:"float",   label:"🧘", walk:false },
    // 20: robô malvado
    { leftArm:-90, rightArm:-90, body:0,   mouth:"sad",     eyes:"cool",   anim:"shake",   label:"😈", walk:false },
    // 21: flerte
    { leftArm:-20, rightArm:60,  body:-5,  mouth:"kiss",    eyes:"think",  anim:"wiggle",  label:"😏", walk:false },
    // 22: estica braços
    { leftArm:-90, rightArm:90,  body:0,   mouth:"neutral", eyes:"normal", anim:"stretch", label:"🙆", walk:false },
    // 23: gira
    { leftArm:-45, rightArm:45,  body:0,   mouth:"laugh",   eyes:"laugh",  anim:"spin",    label:"🌀", walk:false },
    // 24: abraço
    { leftArm:-60, rightArm:60,  body:0,   mouth:"smile",   eyes:"heart",  anim:"bounce",  label:"🤗", walk:false },
    // 25: saluta
    { leftArm:-90, rightArm:0,   body:0,   mouth:"neutral", eyes:"normal", anim:"none",    label:"🫡", walk:false },
    // 26: power up
    { leftArm:-90, rightArm:-90, body:-10, mouth:"open",    eyes:"star",   anim:"powerup", label:"⚡", walk:false },
    // 27: sleep
    { leftArm:10,  rightArm:10,  body:5,   mouth:"neutral", eyes:"closed", anim:"float",   label:"😴", walk:false },
    // 28: robô raiva
    { leftArm:60,  rightArm:-60, body:0,   mouth:"sad",     eyes:"wide",   anim:"shake",   label:"😤", walk:false },
    // 29: festeja
    { leftArm:-90, rightArm:-90, body:0,   mouth:"laugh",   eyes:"star",   anim:"dance",   label:"🥳", walk:false },
    // 30: coração duplo
    { leftArm:-40, rightArm:40,  body:0,   mouth:"smile",   eyes:"heart",  anim:"float",   label:"💝", walk:false },
    // 31: turbo
    { leftArm:-90, rightArm:-90, body:-15, mouth:"open",    eyes:"wide",   anim:"turbo",   label:"🚀", walk:false },
  ];

  const p = poses[pose] || poses[0];
  const s = size;
  const cx = s * 0.5;  // centro x

  // Mapa de animações CSS
  const animMap = {
    float:   "robotFloat 2.5s ease-in-out infinite",
    wave:    `robotWave${animKey} 0.5s ease-in-out infinite alternate`,
    dance:   `robotDance${animKey} 0.3s ease-in-out infinite alternate`,
    wiggle:  `robotWiggle${animKey} 0.2s ease-in-out infinite alternate`,
    bounce:  `robotBounce${animKey} 0.4s ease-in-out infinite alternate`,
    shake:   `robotShake${animKey} 0.15s ease-in-out infinite alternate`,
    jump:    `robotJump${animKey} 0.35s ease-in-out infinite alternate`,
    kick:    `robotKick${animKey} 0.4s ease-in-out 0s 4 alternate`,
    none:    "none",
    walkR:   `robotWalkR${animKey} 0.5s ease-in-out infinite alternate`,
    walkL:   `robotWalkL${animKey} 0.5s ease-in-out infinite alternate`,
    stretch: `robotStretch${animKey} 0.6s ease-in-out infinite alternate`,
    spin:    `robotSpin${animKey} 0.6s linear infinite`,
    powerup: `robotPowerup${animKey} 0.3s ease-in-out infinite alternate`,
    turbo:   `robotTurbo${animKey} 0.15s ease-in-out infinite alternate`,
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
            if (p.eyes === "heart") return (<>
              <text x={ex1-er*0.9} y={ey+er*0.9} fontSize={er*2.2} fill="#F472B6">❤</text>
              <text x={ex2-er*0.9} y={ey+er*0.9} fontSize={er*2.2} fill="#F472B6">❤</text>
            </>);
            if (p.eyes === "wide") return (<>
              <circle cx={ex1} cy={ey} r={er*1.3} fill="#4F8EF7" opacity="0.95"/>
              <circle cx={ex2} cy={ey} r={er*1.3} fill="#4F8EF7" opacity="0.95"/>
              <circle cx={ex1+er*0.3} cy={ey-er*0.4} r={er*0.5} fill="#fff"/>
              <circle cx={ex2+er*0.3} cy={ey-er*0.4} r={er*0.5} fill="#fff"/>
            </>);
            if (p.eyes === "think") return (<>
              <circle cx={ex1} cy={ey} r={er} fill="#4F8EF7" opacity="0.95"/>
              <circle cx={ex2} cy={ey} r={er} fill="#4F8EF7" opacity="0.95"/>
              <circle cx={ex1-er*0.2} cy={ey-er*0.2} r={er*0.38} fill="#fff"/>
              <circle cx={ex2-er*0.2} cy={ey-er*0.2} r={er*0.38} fill="#fff"/>
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
            if (p.mouth === "open") return <ellipse cx={mx} cy={my} rx={faceSize*0.1} ry={faceSize*0.08} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={faceSize*0.025}/>;
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
        @keyframes robotJump${animKey} { from{transform:translateY(0)} to{transform:translateY(-18px)} }
        @keyframes robotShake${animKey} { from{transform:rotate(-6deg)} to{transform:rotate(6deg)} }
        @keyframes robotDance${animKey} { from{transform:rotate(-7deg) translateY(0)} to{transform:rotate(7deg) translateY(-6px)} }
        @keyframes robotWiggle${animKey} { from{transform:skewX(-10deg) rotate(-4deg)} to{transform:skewX(10deg) rotate(4deg)} }
        @keyframes robotKick${animKey} { from{transform:rotate(0deg)} to{transform:rotate(-18deg)} }
        @keyframes robotWave${animKey} { from{transform:rotate(0deg)} to{transform:rotate(-10deg)} }
        @keyframes robotArmWave { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(-30deg)} }
        @keyframes robotWalkR${animKey} { from{transform:translateX(-8px)} to{transform:translateX(8px)} }
        @keyframes robotWalkL${animKey} { from{transform:translateX(8px)} to{transform:translateX(-8px)} }
        @keyframes robotStretch${animKey} { from{transform:scaleY(0.92) scaleX(1.04)} to{transform:scaleY(1.06) scaleX(0.97)} }
        @keyframes robotSpin${animKey} { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes robotPowerup${animKey} { from{transform:translateY(0) scale(1)} to{transform:translateY(-12px) scale(1.08)} }
        @keyframes robotTurbo${animKey} { from{transform:translateX(-3px) rotate(-3deg)} to{transform:translateX(3px) rotate(3deg)} }
        @keyframes legWalk { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(20deg)} }
        @keyframes legWalkB { 0%,100%{transform:rotate(20deg)} 50%{transform:rotate(0deg)} }
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
          {/* Pernas — animadas quando caminha */}
          <g style={{ transformOrigin:`${s*0.365}px ${legY}px`, animation: p.walk ? `legWalk 0.4s ease-in-out infinite` : "none" }}>
            <rect x={s*0.28} y={legY} width={s*0.17} height={legH} rx={s*0.06} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.02}/>
          </g>
          <g style={{ transformOrigin:`${s*0.635}px ${legY}px`, animation: p.walk ? `legWalkB 0.4s ease-in-out infinite` : "none" }}>
            <rect x={s*0.55} y={legY} width={s*0.17} height={legH} rx={s*0.06} fill="#1E2A45" stroke="#4F8EF7" strokeWidth={s*0.02}/>
          </g>
          {/* Pezinhos */}
          <ellipse cx={s*0.365} cy={legY+legH} rx={s*0.12} ry={s*0.04} fill="#4F8EF7" opacity="0.6"/>
          <ellipse cx={s*0.635} cy={legY+legH} rx={s*0.12} ry={s*0.04} fill="#4F8EF7" opacity="0.6"/>
          {/* ZZZ quando dorme */}
          {pose===27 && <text x={s*0.72} y={headY-s*0.02} fontSize={s*0.12} fill="#60A5FA" opacity="0.8">zzz</text>}
          {/* Estrelas quando power up */}
          {pose===26 && <>
            <text x={s*0.05} y={headY+s*0.1} fontSize={s*0.12} fill="#FBBF24">⚡</text>
            <text x={s*0.78} y={headY+s*0.1} fontSize={s*0.12} fill="#FBBF24">⚡</text>
          </>}
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
  const [showResetLogin, setShowResetLogin] = useState(false);
  const [resetEmail, setResetEmail]         = useState("");
  const [resetMsg, setResetMsg]             = useState("");
  const [resetBusy, setResetBusy]           = useState(false);

  // Previsão do tempo em tempo real
  const [weather, setWeather]   = useState(null);
  const [cityName, setCityName] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&forecast_days=5`);
        const d = await r.json();
        setWeather(d);
        try {
          const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pt`);
          const gd  = await geo.json();
          const city  = gd.address?.city || gd.address?.town || gd.address?.village || "";
          const state = gd.address?.state_code || "";
          setCityName(city && state ? `${city}, ${state}` : city || state || null);
        } catch {}
      } catch {}
    }, () => {});
  }, []);

  const doLoginReset = async () => {
    if (!resetEmail.trim()) { setResetMsg("Digite seu e-mail de acesso."); return; }
    setResetBusy(true); setResetMsg("");
    try {
      const { sendPasswordResetEmail } = await import("firebase/auth");
      const { auth: fbAuth } = await import("./firebase");
      await sendPasswordResetEmail(fbAuth, resetEmail.trim());
      setResetMsg("✅ E-mail enviado! Verifique sua caixa de entrada.");
    } catch(e) {
      const code = e.code || "";
      if (code === "auth/user-not-found") setResetMsg("❌ E-mail não encontrado.");
      else if (code === "auth/invalid-email") setResetMsg("❌ E-mail inválido.");
      else setResetMsg("❌ Erro: " + e.message);
    }
    setResetBusy(false);
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

  // Determinar cenário baseado no clima real
  const wcode   = weather?.current_weather?.weathercode ?? -1;
  const temp    = weather?.current_weather?.temperature ?? null;
  const hour    = new Date().getHours();
  const isNight = hour >= 20 || hour < 6;
  const isRain  = wcode >= 51 && wcode <= 82;
  const isSnow  = wcode >= 71 && wcode <= 77;
  const isCloud = (wcode >= 2 && wcode <= 3) || wcode === 45 || wcode === 48;
  const isThunder = wcode >= 95;
  const isClear = wcode === 0 || wcode === 1;

  // Gradiente de fundo dinâmico
  const getBg = () => {
    if (isThunder) return "linear-gradient(180deg,#050a12 0%,#0a1020 50%,#0d1428 100%)";
    if (isRain && isNight) return "linear-gradient(180deg,#060c18 0%,#0c1830 50%,#101e38 100%)";
    if (isRain)  return "linear-gradient(180deg,#101828 0%,#1a2c42 50%,#233450 100%)";
    if (isSnow && isNight) return "linear-gradient(180deg,#0d1520 0%,#1a2535 50%,#243040 100%)";
    if (isSnow)  return "linear-gradient(180deg,#1a2535 0%,#2a3f55 50%,#3a5070 100%)";
    if (isNight) return "linear-gradient(180deg,#020510 0%,#050d22 40%,#080f28 100%)";
    if (isCloud) return "linear-gradient(180deg,#1c2f48 0%,#2a4060 50%,#364e70 100%)";
    if (hour < 9) return "linear-gradient(180deg,#1a2c50 0%,#2a4a80 40%,#e07030 85%,#f0a050 100%)"; // manhã
    if (hour > 17) return "linear-gradient(180deg,#2a1040 0%,#5a1a6a 35%,#c04020 70%,#f06030 100%)"; // tarde/pôr
    return "linear-gradient(180deg,#0a1828 0%,#1040a0 40%,#2060d0 75%,#80b8f0 100%)"; // dia claro
  };

  // WMO icons
  const WMO = {0:"☀️",1:"🌤",2:"⛅",3:"☁️",45:"🌫",48:"🌫",51:"🌦",53:"🌦",55:"🌧",61:"🌧",63:"🌧",65:"🌧",71:"❄️",73:"❄️",75:"❄️",80:"🌦",81:"🌧",82:"⛈",95:"⛈",96:"⛈",99:"⛈"};
  const wxIcon = WMO[wcode] || (isNight ? "🌙" : "☀️");

  return (
    <div style={{ width:"100vw", height:"100vh", background:getBg(), display:"flex", alignItems:"center", justifyContent:"center", position:"fixed", inset:0, overflow:"hidden" }}>

      <style>{`
        @keyframes fadeIn      { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes floatUp     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes twinkle     { 0%,100%{opacity:0.3} 50%{opacity:1} }
        @keyframes cloudDrift  { 0%{transform:translateX(0)} 100%{transform:translateX(60px)} }
        @keyframes cloudDriftR { 0%{transform:translateX(0)} 100%{transform:translateX(-50px)} }
        @keyframes rainFall    { from{transform:translateY(-30px)} to{transform:translateY(102vh)} }
        @keyframes snowFall    { from{transform:translateY(-20px) rotate(0deg)} to{transform:translateY(102vh) rotate(360deg)} }
        @keyframes lightning1  { 0%,91%,100%{opacity:0} 92%,94%{opacity:1} 93%,95%{opacity:0} 96%{opacity:0.6} 97%{opacity:0} }
        @keyframes lightning2  { 0%,74%,100%{opacity:0} 75%,77%{opacity:0.9} 76%,78%{opacity:0} 82%{opacity:0.4} 83%{opacity:0} }
        @keyframes skyFlash    { 0%,90%,100%{opacity:0} 91%,93%{opacity:0.07} 92%,94%{opacity:0} }
        @keyframes sunRays     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes sunPulse    { 0%,100%{r:58} 50%{r:62} }
        @keyframes moonGlow    { 0%,100%{opacity:0.06} 50%{opacity:0.14} }
        @keyframes splashRing  { from{r:1;opacity:0.5} to{r:8;opacity:0} }
      `}</style>

      {/* ══ FUNDO SVG DINÂMICO ══ */}
      <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", zIndex:0, pointerEvents:"none" }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="lgSunGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFF7D4" stopOpacity="1"/>
            <stop offset="50%" stopColor="#FDE68A" stopOpacity="0.6"/>
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="lgMoonGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#EEF2FF" stopOpacity="0.15"/>
            <stop offset="100%" stopColor="#C7D2FE" stopOpacity="0"/>
          </radialGradient>
          <filter id="lgGlow"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="lgGlow2"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <linearGradient id="lgRoad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a2234"/>
            <stop offset="100%" stopColor="#0f1520"/>
          </linearGradient>
          <linearGradient id="lgGrass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isRain||isThunder?"#0a1a0f":"#112a14"}/>
            <stop offset="100%" stopColor={isRain||isThunder?"#060d08":"#0a1a0c"}/>
          </linearGradient>
        </defs>

        {/* Flash céu (trovão) */}
        {(isThunder||isRain) && <>
          <rect width="1440" height="900" fill="#6EA8FF" style={{ animation:"skyFlash 7s ease-in-out infinite" }}/>
          <rect width="1440" height="900" fill="#A0C4FF" style={{ animation:"skyFlash 11s ease-in-out infinite 4s" }}/>
        </>}

        {/* ── ESTRELAS (noite) ── */}
        {isNight && [
          [80,40],[200,25],[380,55],[560,30],[740,45],[920,20],[1100,50],[1300,35],[1420,60],
          [140,100],[320,80],[500,110],[680,90],[860,120],[1040,85],[1220,105],[1390,95],
          [60,160],[240,140],[440,170],[620,155],[800,175],[980,145],[1160,165],[1360,150],
          [170,220],[350,200],[530,230],[710,210],[890,235],[1070,205],[1250,225],[1430,215],
          [100,280],[280,260],[460,290],[640,270],[820,295],[1000,265],[1180,285],[1380,275],
        ].map(([cx,cy],i)=>(
          <circle key={i} cx={cx} cy={cy} r={i%7===0?2.2:i%3===0?1.4:0.9}
            fill={i%5===0?"#FEF9C3":i%3===0?"#C7D2FE":"#fff"}
            opacity={0.3+(i%4)*0.15}>
            <animate attributeName="opacity"
              values={`${0.2+(i%3)*0.2};${0.9};${0.2+(i%3)*0.2}`}
              dur={`${1.8+(i%5)*0.6}s`} begin={`${i*0.13}s`} repeatCount="indefinite"/>
          </circle>
        ))}

        {/* ── LUA (noite, não chuva intensa) ── */}
        {isNight && !isThunder && (
          <g filter="url(#lgGlow)">
            <circle cx="1080" cy="120" r="100" fill="url(#lgMoonGlow)">
              <animate attributeName="opacity" values="0.06;0.14;0.06" dur="4s" repeatCount="indefinite"/>
            </circle>
            <circle cx="1080" cy="120" r="62" fill="#F5E878"/>
            <circle cx="1080" cy="120" r="62" fill="#C8B030" opacity="0.2"/>
            <circle cx="1108" cy="112" r="55" fill="#04081a" opacity="0.93"/>
            <circle cx="1080" cy="120" r="62" fill="none" stroke="#FDE68A" strokeWidth="1.5" opacity="0.4"/>
            <circle cx="1062" cy="108" r="7" fill="#B8960A" opacity="0.45"/>
            <circle cx="1075" cy="135" r="5" fill="#B8960A" opacity="0.4"/>
            <circle cx="1090" cy="108" r="3.5" fill="#A07808" opacity="0.35"/>
            <circle cx="1064" cy="100" r="9" fill="#FFFDE7" opacity="0.2"/>
          </g>
        )}

        {/* ── SOL (dia claro ou parcialmente nublado) ── */}
        {!isNight && !isRain && !isThunder && (
          <g filter="url(#lgGlow)">
            <circle cx="200" cy="110" r="110" fill="url(#lgSunGlow)" opacity="0.4">
              <animate attributeName="opacity" values="0.3;0.55;0.3" dur="5s" repeatCount="indefinite"/>
            </circle>
            <circle cx="200" cy="110" r="85" fill="url(#lgSunGlow)" opacity="0.55"/>
            <g style={{ transformOrigin:"200px 110px", animation:"sunRays 80s linear infinite" }}>
              {Array.from({length:18}).map((_,ri)=>{
                const a = ri*20 * Math.PI/180;
                return <line key={ri}
                  x1={200+Math.cos(a)*70} y1={110+Math.sin(a)*70}
                  x2={200+Math.cos(a)*100} y2={110+Math.sin(a)*100}
                  stroke="#FDE68A" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>;
              })}
            </g>
            <circle cx="200" cy="110" r="58" fill="#FDE68A"/>
            <circle cx="200" cy="110" r="46" fill="#FFFDE7"/>
            <circle cx="182" cy="92" r="13" fill="#fff" opacity="0.3"/>
          </g>
        )}

        {/* ── NUVENS ── */}
        {/* Nuvens escuras (chuva/trovão) */}
        {(isRain||isThunder||isCloud) && [
          {cx:160,cy:72,rx:155,ry:58,f:"#1c2535"},{cx:340,cy:52,rx:118,ry:48,f:"#1a2030"},
          {cx:520,cy:82,rx:175,ry:62,f:"#151e2d"},{cx:720,cy:50,rx:195,ry:68,f:"#1c2535"},
          {cx:950,cy:68,rx:165,ry:58,f:"#1a2030"},{cx:1130,cy:46,rx:148,ry:56,f:"#151e2d"},
          {cx:1310,cy:80,rx:128,ry:50,f:"#1c2535"},{cx:80,cy:125,rx:98,ry:38,f:"#1a2030"},
          {cx:620,cy:118,rx:138,ry:46,f:"#151e2d"},{cx:1050,cy:128,rx:118,ry:43,f:"#1c2535"},
        ].map((cl,i)=>(
          <ellipse key={i} cx={cl.cx} cy={cl.cy} rx={cl.rx} ry={cl.ry} fill={cl.f} opacity={0.85+(i%3)*0.04}>
            <animateTransform attributeName="transform" type="translate"
              values={`0 0;${i%2===0?30:-22} 0;0 0`} dur={`${20+(i*4)}s`} repeatCount="indefinite"/>
          </ellipse>
        ))}
        {/* Nuvens brancas/claras (dia) */}
        {!isRain && !isThunder && !isNight && (
          <>
            <g opacity={isCloud?0.9:0.55}>
              <ellipse cx="600" cy="130" rx="110" ry="44" fill="white" opacity="0.9">
                <animateTransform attributeName="transform" type="translate" values="0 0;35 0;0 0" dur="28s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="530" cy="148" rx="74" ry="34" fill="white" opacity="0.85">
                <animateTransform attributeName="transform" type="translate" values="0 0;35 0;0 0" dur="28s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="668" cy="152" rx="64" ry="30" fill="white" opacity="0.78">
                <animateTransform attributeName="transform" type="translate" values="0 0;35 0;0 0" dur="28s" repeatCount="indefinite"/>
              </ellipse>
            </g>
            <g opacity={isCloud?0.8:0.42}>
              <ellipse cx="1100" cy="95" rx="95" ry="38" fill="white" opacity="0.82">
                <animateTransform attributeName="transform" type="translate" values="0 0;-25 0;0 0" dur="35s" repeatCount="indefinite"/>
              </ellipse>
              <ellipse cx="1038" cy="112" rx="65" ry="30" fill="white" opacity="0.74">
                <animateTransform attributeName="transform" type="translate" values="0 0;-25 0;0 0" dur="35s" repeatCount="indefinite"/>
              </ellipse>
            </g>
          </>
        )}

        {/* ── RELÂMPAGOS (trovão/chuva forte) ── */}
        {(isThunder||isRain) && <>
          <g filter="url(#lgGlow2)" style={{ animation:"lightning1 8s ease-in-out infinite" }}>
            <polyline points="310,95 284,218 306,218 272,382 296,382 258,525" fill="none" stroke="#E8F4FF" strokeWidth="3.5" strokeLinejoin="round"/>
            <polyline points="310,95 284,218 306,218 272,382 296,382 258,525" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" opacity="0.9"/>
          </g>
          <g filter="url(#lgGlow2)" style={{ animation:"lightning2 11s ease-in-out infinite 3s" }}>
            <polyline points="1095,75 1068,198 1090,198 1050,348 1076,348 1036,492" fill="none" stroke="#CCE8FF" strokeWidth="2.8" strokeLinejoin="round"/>
            <polyline points="1095,75 1068,198 1090,198 1050,348 1076,348 1036,492" fill="none" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" opacity="0.82"/>
          </g>
        </>}

        {/* ── FLOCOS DE NEVE ── */}
        {isSnow && Array.from({length:60}).map((_,i)=>(
          <circle key={i} cx={(i*24+12)%1440} cy="-10" r={i%4===0?3.5:i%3===0?2.5:1.8} fill="white" opacity={0.6+(i%3)*0.13}>
            <animateTransform attributeName="transform" type="translate"
              values={`0 0;${(i%7-3)*18} 920`}
              dur={`${3+(i%5)*0.8}s`} begin={`${(i*0.18)%3.5}s`} repeatCount="indefinite"/>
          </circle>
        ))}

        {/* ── CHUVA ── */}
        {(isRain||isThunder) && Array.from({length:130}).map((_,i)=>(
          <line key={i} x1={(i*11+5)%1440} y1="-12" x2={(i*11+10)%1440} y2="28"
            stroke={i%4===0?"rgba(147,197,253,0.55)":"rgba(147,197,253,0.38)"} strokeWidth={i%5===0?1.7:1.1} strokeLinecap="round">
            <animateTransform attributeName="transform" type="translate"
              values={`0 0;4 940`} dur={`${0.44+(i%7)*0.055}s`} begin={`${(i*0.036)%1.1}s`} repeatCount="indefinite"/>
          </line>
        ))}

        {/* ── PRÉDIOS ── */}
        {[
          {x:0,  w:55,h:165},{x:65, w:42,h:122},{x:117,w:62,h:205},{x:189,w:36,h:145},
          {x:235,w:58,h:178},{x:303,w:44,h:132},{x:357,w:68,h:225},{x:435,w:40,h:158},
          {x:485,w:60,h:188},{x:555,w:46,h:148},{x:611,w:72,h:244},{x:693,w:38,h:162},
          {x:741,w:56,h:198},{x:807,w:44,h:152},{x:861,w:64,h:214},{x:935,w:40,h:168},
          {x:985,w:57,h:183},{x:1052,w:42,h:143},{x:1104,w:70,h:234},{x:1184,w:38,h:158},
          {x:1232,w:54,h:188},{x:1296,w:46,h:148},{x:1352,w:62,h:204},{x:1424,w:40,h:162},
        ].map((b,i)=>(
          <g key={i}>
            <rect x={b.x} y={710-b.h} width={b.w} height={b.h}
              fill={isNight||isRain||isThunder?(i%2===0?"#0c1520":"#0e1828"):(i%2===0?"#1a2535":"#1e2d42")}/>
            {Array.from({length:Math.floor(b.h/28)}).map((_,row)=>
              Array.from({length:Math.max(1,Math.floor(b.w/18))}).map((_,col)=>{
                const lit = isNight ? (i*7+row*3+col*5)%9 < 4 : false;
                const dusk = !isNight && (hour > 17 || hour < 8) ? (i*5+row*2+col*4)%11 < 3 : false;
                return <rect key={`${row}-${col}`} x={b.x+4+col*18} y={710-b.h+8+row*28} width={12} height={8} rx={1}
                  fill={lit?"#FDE68A":dusk?"#FBBF24":"#0a1320"} opacity={lit?0.75:dusk?0.5:0.4}/>;
              })
            )}
            <line x1={b.x+b.w/2} y1={710-b.h} x2={b.x+b.w/2} y2={710-b.h-14} stroke="#475569" strokeWidth="1.8"/>
            {isNight && <circle cx={b.x+b.w/2} cy={710-b.h-16} r="2.2" fill="#EF4444" opacity="0.85">
              <animate attributeName="opacity" values="0.85;0.12;0.85" dur={`${1.6+(i%4)*0.3}s`} repeatCount="indefinite"/>
            </circle>}
          </g>
        ))}

        {/* ── ESTRADA ── */}
        <rect x="0" y="710" width="1440" height="38" fill="url(#lgRoad)"/>
        <rect x="0" y="727" width="1440" height="2" fill="#252f40" opacity="0.8"/>
        {Array.from({length:14}).map((_,i)=>(
          <rect key={i} x={i*110} y="727" width="55" height="2" rx="1" fill="#2d3a50" opacity="0.6">
            <animateTransform attributeName="transform" type="translate" values="0 0;-110 0" dur="5s" begin={`${i*0.35}s`} repeatCount="indefinite"/>
          </rect>
        ))}
        {/* Reflexo molhado na estrada */}
        {(isRain||isThunder) && <rect x="0" y="710" width="1440" height="38" fill="#4F8EF7" opacity="0.07"/>}

        {/* ── GRAMA ── */}
        <rect x="0" y="748" width="1440" height="152" fill="url(#lgGrass)"/>

        {/* ── POSTES (noite) ── */}
        {isNight && [120,360,600,840,1080,1320].map((x,i)=>(
          <g key={i} transform={`translate(${x},710)`}>
            <rect x="-3" y="-68" width="6" height="68" rx="2" fill="#2d3a50"/>
            <rect x="-15" y="-71" width="30" height="5" rx="2" fill="#3a4a60"/>
            <ellipse cx="0" cy="-74" rx="6.5" ry="4.5" fill="#FDE68A" opacity="0.9" filter="url(#lgGlow2)"/>
            <path d="M -6,-71 L -26,-12 L 26,-12 L 6,-71 Z" fill="#FDE68A" opacity="0.07"/>
          </g>
        ))}

        {/* Respingos de chuva no chão */}
        {(isRain||isThunder) && Array.from({length:28}).map((_,i)=>(
          <circle key={i} cx={(i*52+18)%1440} cy="750" fill="none" stroke="rgba(147,197,253,0.28)" strokeWidth="0.8">
            <animate attributeName="r" values="1;7;0" dur={`${0.55+(i%4)*0.1}s`} begin={`${(i*0.09)%1.0}s`} repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.4;0;0" dur={`${0.55+(i%4)*0.1}s`} begin={`${(i*0.09)%1.0}s`} repeatCount="indefinite"/>
          </circle>
        ))}
        {/* Neve no chão */}
        {isSnow && <rect x="0" y="745" width="1440" height="8" fill="white" opacity="0.25" rx="2"/>}
      </svg>

      {/* ══ CONTEÚDO CENTRAL ══ */}
      <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:18, animation:"fadeIn 0.7s ease", width:"100%", maxWidth:380, padding:"0 20px" }}>

        {/* Clima em tempo real (compacto, acima do card) */}
        {weather?.current_weather && (
          <div style={{ background:"rgba(8,12,22,0.55)", backdropFilter:"blur(12px)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:"10px 18px", display:"flex", alignItems:"center", gap:12, width:"100%", animation:"fadeIn 0.9s ease 0.2s both" }}>
            <span style={{ fontSize:26 }}>{wxIcon}</span>
            <div style={{ flex:1 }}>
              {cityName && <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, marginBottom:1 }}>📍 {cityName}</div>}
              <div style={{ color:"#fff", fontSize:18, fontWeight:800, lineHeight:1 }}>{Math.round(temp)}°C</div>
              <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, marginTop:1 }}>
                {isThunder?"Tempestade":isRain?"Chuva":isSnow?"Neve":isCloud?"Nublado":isClear?(isNight?"Céu limpo":"Ensolarado"):"—"}
              </div>
            </div>
            {/* Mini previsão 3 dias */}
            <div style={{ display:"flex", gap:8 }}>
              {(weather.daily?.time||[]).slice(1,4).map((d,i)=>{
                const wc2 = weather.daily.weathercode[i+1];
                const tmax = Math.round(weather.daily.temperature_2m_max[i+1]);
                const day = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][new Date(d+"T12:00:00").getDay()];
                return (
                  <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                    <div style={{ color:"rgba(255,255,255,0.4)", fontSize:9 }}>{day}</div>
                    <div style={{ fontSize:13 }}>{WMO[wc2]||"🌡"}</div>
                    <div style={{ color:"rgba(255,255,255,0.65)", fontSize:9.5, fontWeight:600 }}>{tmax}°</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Card de login centralizado */}
        <div style={{ background:"rgba(8,12,22,0.75)", backdropFilter:"blur(24px)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:22, padding:"32px 28px", width:"100%", boxShadow:"0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)", animation:"fadeIn 0.7s ease" }}>
          {/* Logo */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:26 }}>
            <NexpRobot size={34} showFaceOnly />
            <div>
              <div style={{ fontWeight:900, fontSize:19, letterSpacing:"-0.6px", background:"linear-gradient(135deg,#4F8EF7,#7C3AED)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Nexp Consultas</div>
              <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10.5 }}>Sistema de Leads</div>
            </div>
          </div>

          {err && <div style={{ background:"rgba(45,21,21,0.8)", border:"1px solid #EF444433", borderRadius:9, padding:"9px 13px", marginBottom:16, color:"#F87171", fontSize:12.5 }}>⚠ {err}</div>}

          <div style={{ marginBottom:13 }}>
            <label style={{ color:"rgba(255,255,255,0.5)", fontSize:11.5, display:"block", marginBottom:5 }}>E-mail</label>
            <input value={un} onChange={e=>setUn(e.target.value)} placeholder="seu@email.com" onKeyDown={e=>e.key==="Enter"&&go()}
              style={{ ...S.input, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#E8EAEF" }} />
          </div>
          <div style={{ marginBottom:22 }}>
            <label style={{ color:"rgba(255,255,255,0.5)", fontSize:11.5, display:"block", marginBottom:5 }}>Senha</label>
            <div style={{ position:"relative" }}>
              <input value={pw} onChange={e=>setPw(e.target.value)} type={show?"text":"password"} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&go()}
                style={{ ...S.input, paddingRight:42, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#E8EAEF" }} />
              <button onClick={()=>setShow(p=>!p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"rgba(255,255,255,0.35)", cursor:"pointer", fontSize:14 }}>
                {show?"🙈":"👁"}
              </button>
            </div>
          </div>
          <button onClick={go} disabled={loading}
            style={{ ...S.btn("#3B6EF5","#fff"), width:"100%", padding:"12px", fontSize:14, opacity:loading?0.7:1, cursor:loading?"not-allowed":"pointer", background:"linear-gradient(135deg,#3B6EF5,#7C3AED)", boxShadow:"0 4px 24px rgba(59,110,245,0.35)", borderRadius:12 }}>
            {loading ? "Entrando..." : "Entrar →"}
          </button>

          {/* Esqueci minha senha */}
          <div style={{ marginTop:12, borderTop:"1px solid rgba(255,255,255,0.07)", paddingTop:12 }}>
            <button onClick={()=>{ setShowResetLogin(p=>!p); setResetMsg(""); setResetEmail(""); }}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:8, background:"transparent", border:"none", cursor:"pointer", padding:"4px 0" }}>
              <span style={{ fontSize:13 }}>🔑</span>
              <span style={{ color:"rgba(255,255,255,0.38)", fontSize:11.5 }}>Esqueci minha senha</span>
              <span style={{ color:"rgba(255,255,255,0.2)", fontSize:11, marginLeft:"auto" }}>{showResetLogin?"▲":"▼"}</span>
            </button>
            {showResetLogin && (
              <div style={{ marginTop:8 }}>
                <input value={resetEmail} onChange={e=>{setResetEmail(e.target.value);setResetMsg("");}}
                  onKeyDown={e=>e.key==="Enter"&&doLoginReset()} placeholder="seu@email.com"
                  style={{ ...S.input, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#E8EAEF", marginBottom:7 }} />
                <button onClick={doLoginReset} disabled={resetBusy}
                  style={{ ...S.btn("linear-gradient(135deg,#3B6EF5,#7C3AED)","#fff"), width:"100%", padding:"8px", fontSize:12.5, opacity:resetBusy?0.7:1 }}>
                  {resetBusy ? "Enviando..." : "📧 Enviar link de redefinição"}
                </button>
                {resetMsg && <div style={{ color:resetMsg.startsWith("✅")?"#34D399":"#F87171", fontSize:11, marginTop:6, textAlign:"center" }}>{resetMsg}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ BOTÃO DE SUPORTE — direita, circular e discreto ══ */}
      <a href="https://wa.me/5584981323542" target="_blank" rel="noopener noreferrer"
        title="Suporte WhatsApp"
        style={{
          position:"fixed", right:22, bottom:22, zIndex:10,
          width:48, height:48, borderRadius:"50%",
          background:"rgba(10,35,20,0.55)", backdropFilter:"blur(12px)",
          border:"1px solid rgba(37,211,102,0.28)",
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:"0 4px 20px rgba(0,0,0,0.4)",
          textDecoration:"none", transition:"transform 0.2s, box-shadow 0.2s",
        }}
        onMouseEnter={e=>{ e.currentTarget.style.transform="scale(1.1)"; e.currentTarget.style.boxShadow="0 6px 28px rgba(37,211,102,0.25)"; }}
        onMouseLeave={e=>{ e.currentTarget.style.transform="scale(1)";   e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,0.4)"; }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#25D366">
          <path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.17 1.6 5.98L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.21-3.48-8.52zM12 21.94a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.73.98.99-3.63-.23-.37A9.93 9.93 0 0 1 2.06 12C2.06 6.5 6.5 2.06 12 2.06S21.94 6.5 21.94 12 17.5 21.94 12 21.94zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97s-.47-.15-.67.15-.77.97-.94 1.17-.35.22-.65.07a8.15 8.15 0 0 1-2.4-1.48 9.01 9.01 0 0 1-1.66-2.07c-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5s.05-.38-.02-.52c-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.48 1.07 2.88 1.22 3.08 2.1 3.2 5.09 4.49c.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/>
        </svg>
      </a>
    </div>
  );
}



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

function Sidebar({ page, setPage, user, users, onLogout, unreadChat, unreadNotif, unreadStories, unreadPropostas, unreadDigitacao, presence, flashUserId, stories, sysConfig }) {
  const uObj = users.find((u) => u.id === user.id) || user;
  const all = [
    { id:"dashboard",  label:"Relatório de Leads",  icon:"◈", roles:["administrador","gerente","supervisor","operador","mestre","master","indicado","visitante"] },
    { id:"contacts",   label:"Contatos",       icon:"⬡", roles:["administrador","gerente","supervisor","operador","mestre","master","indicado","visitante"] },
    { id:"add",        label:"Adicionar",       icon:"⊕", roles:["administrador","gerente","supervisor","mestre","master","indicado"] },
    { id:"import",     label:"Importar",        icon:"⤓", roles:["administrador","gerente","supervisor","mestre","master","indicado"] },
    { id:"review",     label:"Ver Clientes",    icon:"◎", roles:["administrador","gerente","supervisor","operador","mestre","master","indicado","visitante"] },
    { id:"cstatus",    label:"Status",          icon:"◐", roles:["administrador","gerente","supervisor","operador","mestre","master","indicado","visitante"] },
    { id:"simulador",  label:"Simulador",       icon:"⊟", roles:["administrador","gerente","supervisor","mestre","master","indicado"] },
    { id:"apis",       label:"Bancos",          icon:"⬧", roles:["administrador","gerente","mestre","master"] },
    { id:"leds",       label:"Leds",            icon:"⬦", roles:["administrador","gerente","mestre","master"] },
    { id:"usuarios_page", label:"Usuários",     icon:"👥", roles:["administrador","gerente","supervisor","mestre","master"] },
    { id:"digitacao",  label:"Digitação",       icon:"📝", roles:["administrador","gerente","supervisor","operador","mestre","master","indicado","digitador"] },
    { id:"propostas",  label:"Propostas",       icon:"📋", roles:["administrador","gerente","mestre","master","digitador"], badge:"propostas" },
    { id:"atalhos",    label:"Atalhos",         icon:"⌘", roles:["administrador","gerente","supervisor","operador","mestre","master","indicado","visitante"] },
    { id:"calendario", label:"Agenda",          icon:"◷", roles:["administrador","gerente","supervisor","operador","mestre","master","indicado","visitante"] },
    { id:"pagamentos", label:"Pagamentos",       icon:"💳", roles:["administrador","mestre"], requireConfig:"pagamentosEnabled" },
    { id:"premium",    label:"Premium Nexp",    icon:"◈", roles:["administrador","mestre"] },
    { id:"config",     label:"Configurações",   icon:"⊞", roles:["administrador","gerente","supervisor","mestre","master","indicado"] },
  ];
  // For visitante: filter by mestre-controlled tab config
  const cfg = sysConfig?.visitanteTabs || {};
  const nav = all.filter(it => {
    if (!it.roles.includes(user.role)) return false;
    if (user.role === "visitante") return cfg[it.id] !== false;
    if (it.requireConfig && sysConfig && sysConfig[it.requireConfig] === false) return false;
    return true;
  });
  const roleLabel = ROLE_LABEL;
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
      <div className={sidebarOpen ? "nexp-sidebar nexp-sidebar-open" : "nexp-sidebar"} style={{
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
                    {/* Badge propostas */}
                    {it.id === "propostas" && unreadPropostas > 0 && (
                      <span style={{ background:"#EF4444", color:"#fff", fontSize:9, padding:"2px 6px", borderRadius:9, fontWeight:800, animation:"pulse 1.5s infinite", marginLeft:2 }}>
                        {unreadPropostas}
                      </span>
                    )}
                    {/* Badge digitação */}
                    {it.id === "digitacao" && (unreadDigitacao||0) > 0 && (
                      <span style={{ background:"#EF4444", color:"#fff", fontSize:9, padding:"2px 6px", borderRadius:9, fontWeight:800, animation:"pulse 1.5s infinite", marginLeft:2 }}>
                        {unreadDigitacao}
                      </span>
                    )}
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
                  <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderRadius: "50%", background: isReallyOnline(presence[(uObj.uid||uObj.id)]) ? "#16A34A" : "#FBBF24", border: `1.5px solid ${C.sb}` }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.ts, fontSize: 12, fontWeight: 600 }}>{uObj.name || uObj.username}</div>
                  <div style={{ color: C.td, fontSize: 10, display: "flex", alignItems: "center", gap: 4, flexWrap:"wrap" }}>
                    {roleLabel[user.role]}
                    {isReallyOnline(presence[(uObj.uid || uObj.id)])
                      ? <span style={{ color: "#16A34A", fontSize: 9, display:"flex", alignItems:"center", gap:2 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#16A34A", display:"inline-block", animation:"pulse 1.5s infinite" }} />🟢 online</span>
                      : <span style={{ color:"#FBBF24", fontSize:9 }}>🟡 offline</span>
                    }
                    {(() => {
                      const uid2 = uObj.uid||uObj.id;
                      const override = sysConfig?.userOverrides?.[uid2];
                      const chatOff = override?.chat === false;
                      return chatOff ? <span style={{ color:"#F87171", fontSize:9 }}>· Chat desativado</span> : null;
                    })()}
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
          Relatório de Leads
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
            {contact.hasWhatsapp && (
              <span title="WhatsApp validado" style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:14, height:14, borderRadius:"50%", background:"#25D366", flexShrink:0 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="#fff"><path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.17 1.6 5.98L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.21-3.48-8.52z"/></svg>
              </span>
            )}
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
              {/* Endereço */}
              {(contact.cep || contact.rua || contact.cidade || contact.bairro) && (
                <div style={{ background:C.deep, borderRadius:9, padding:"10px 13px", marginBottom:12, border:`1px solid ${C.b1}` }}>
                  <div style={{ color:C.tm, fontSize:10.5, fontWeight:700, marginBottom:7, textTransform:"uppercase", letterSpacing:"0.5px" }}>📍 Endereço</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px 16px" }}>
                    {[["CEP",contact.cep],["Rua",contact.rua],["Número",contact.numero],["Bairro",contact.bairro],["Cidade",contact.cidade],["Complemento",contact.complemento]].map(([l,v])=>v?(
                      <div key={l}>
                        <div style={{ color:C.td, fontSize:10, marginBottom:2 }}>{l}</div>
                        <div style={{ color:C.ts, fontSize:12 }}>{v}</div>
                      </div>
                    ):null)}
                  </div>
                </div>
              )}

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
                    {(() => {
                      return <CommSimTabs contact={contact} />;
                    })()}
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
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
          {inp("CPF", "cpf", "text", "000.000.000-00")}
          {inp("Telefone 1", "phone", "tel", "(11) 99999-0000")}
          {inp("Telefone 2", "phone2", "tel", "(11) 98888-0000")}
          {inp("Telefone 3", "phone3", "tel", "(11) 97777-0000")}
          {inp("CNPJ", "cnpj", "text", "00.000.000/0000-00")}
          {inp("Email", "email", "email", "email@exemplo.com")}
          {inp("Matrícula", "matricula", "text", "M0001")}
        </div>
        {/* Endereço */}
        <div style={{ color:C.ts, fontSize:11.5, fontWeight:700, marginBottom:10, paddingBottom:6, borderBottom:`1px solid ${C.b1}` }}>📍 Endereço</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr 1fr", gap:14, marginBottom:10 }}>
          {inp("CEP", "cep", "text", "00000-000")}
          {inp("Rua / Logradouro", "rua", "text", "Ex: Rua das Flores")}
          {inp("Número", "numero", "text", "123")}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14 }}>
          {inp("Bairro", "bairro", "text", "Ex: Centro")}
          {inp("Cidade", "cidade", "text", "Ex: Natal")}
          {inp("Complemento", "complemento", "text", "Ex: Apto 12")}
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

  const isAdmin = currentUser?.role === "mestre" || currentUser?.role === "administrador";

  // Tabs disponíveis — Verificação e Histórico só para Administrador
  const tabs = [
    { id: "import", label: "⬆ Importar" },
    ...(isAdmin ? [{ id: "verify", label: "🔍 Verificação de Leds" }] : []),
    ...(isAdmin ? [{ id: "history", label: `📋 Histórico${history.length > 0 ? ` (${history.length})` : ""}` }] : []),
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
            <div style={{ color: C.tm, fontSize: 12, marginBottom: 14, lineHeight: 1.9 }}>
              Importe qualquer planilha CSV — o sistema reconhece automaticamente as colunas pelo cabeçalho. Campos aceitos: <span style={{ color:C.atxt }}>Nome, CPF, Telefone, Telefone2, Telefone3, CNPJ, Email, Matricula, TipoLead, Observacao, Rua, Numero, Bairro, CEP, Cidade, UF</span>.
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <button onClick={dlModelo} style={{ ...S.btn(C.abg, C.atxt), border: `1px solid ${C.atxt}33`, fontSize: 12, padding: "7px 14px" }}>⬇ Baixar modelo da planilha</button>
              <span style={{ color:C.td, fontSize:11, fontStyle:"italic" }}>Dica: baixe o modelo para ver o formato exato das colunas.</span>
            </div>
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
function ReviewClient({ contacts, setContacts, filtered = null, onDigitar = null }) {
  const list = filtered || contacts;

  // ── NAVEGAÇÃO 100% estável: ref é fonte de verdade, tick força re-render ──
  const curIdRef  = useRef(list[0]?.id || null);
  const [, setTick] = useState(0); // só serve para forçar re-render
  const navigate = (id) => { curIdRef.current = id; setTick(t => t + 1); };

  const [sc, setSc]   = useState(false);
  const [done, setDone] = useState(false);
  const [modalDigitar, setModalDigitar] = useState(false);

  const cur = list.find(c => c.id === curIdRef.current) || list[0] || {};
  const si  = list.findIndex(c => c.id === curIdRef.current);

  // ── Estados locais por cliente — refs para valores correntes ──
  const [reactions,   setReactions]   = useState(cur.reactions   || []);
  const [leadType,    setLeadType]    = useState(cur.leadType    || "FGTS");
  const [extraLeads,  setExtraLeads]  = useState(cur.extraLeads  || []);
  const [extraStatus, setExtraStatus] = useState(cur.extraStatus || []);

  const reactionsRef   = useRef(reactions);
  const leadTypeRef    = useRef(leadType);
  const extraLeadsRef  = useRef(extraLeads);
  const extraStatusRef = useRef(extraStatus);
  useEffect(() => { reactionsRef.current   = reactions;   }, [reactions]);
  useEffect(() => { leadTypeRef.current    = leadType;    }, [leadType]);
  useEffect(() => { extraLeadsRef.current  = extraLeads;  }, [extraLeads]);
  useEffect(() => { extraStatusRef.current = extraStatus; }, [extraStatus]);

  // Sincronizar estados quando muda de cliente
  const prevClientId = useRef(cur.id);
  const savingRef    = useRef(false);
  useEffect(() => {
    if (savingRef.current) return;
    if (cur.id === prevClientId.current) return;
    prevClientId.current = cur.id;
    const c = list.find(x => x.id === curIdRef.current) || {};
    setReactions(c.reactions   || []);
    setLeadType(c.leadType    || "FGTS");
    setExtraLeads(c.extraLeads  || []);
    setExtraStatus(c.extraStatus || []);
    setDone(false);
    setSc(false);
  }, [cur.id, list]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const lc = LEAD_COLOR[leadTypeRef.current] || "#9CA3AF";
  const nexts = list.filter(c => c.id !== curIdRef.current).slice(0, 10);

  const upd = async (u) => {
    savingRef.current = true;
    await saveContact(u);
    setContacts((cs) => cs.map((c) => (c.id === u.id ? u : c)));
    setTimeout(() => { savingRef.current = false; }, 800);
  };

  // Emojis — máx 3, isolados por cliente
  const tog = (e) => {
    setReactions((prev) => {
      const newR = prev.includes(e)
        ? prev.filter((x) => x !== e)
        : prev.length >= 3 ? prev : [...prev, e];
      if (newR !== prev)
        upd({ ...cur, reactions: newR, leadType: leadTypeRef.current, extraLeads: extraLeadsRef.current, extraStatus: extraStatusRef.current });
      return newR;
    });
  };

  // Status — toggle multi-seleção, estável sem reset de paginação
  const toggleStatus = (s) => {
    setExtraStatus((prev) => {
      const newExtra = prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s];
      upd({ ...cur, leadType: leadTypeRef.current, extraLeads: extraLeadsRef.current, reactions: reactionsRef.current, extraStatus: newExtra });
      return newExtra;
    });
  };

  // Concluído — avança para o próximo pelo ID
  const conclude = async () => {
    await upd({ ...cur, reactions: reactionsRef.current, leadType: leadTypeRef.current, extraLeads: extraLeadsRef.current, extraStatus: extraStatusRef.current });
    setDone(true);
    setTimeout(() => {
      const nextIdx = si + 1;
      if (nextIdx < list.length) navigate(list[nextIdx].id);
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
            onClick={() => { if (si > 0) navigate(list[si - 1].id); }}
            disabled={si === 0}
            style={{ ...S.btn(si === 0 ? C.deep : C.abg, si === 0 ? C.td : C.atxt), border: `1px solid ${C.b2}`, padding: "7px 14px", fontSize: 13 }}
          >← Anterior</button>
          <button
            onClick={() => { if (si < list.length - 1) navigate(list[si + 1].id); }}
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

        {/* Tipo de Lead */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: C.tm, fontSize: 10.5, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Tipo de Lead
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {LEAD_TYPES.filter(t => t !== "Outro").map((t) => {
              const col = LEAD_COLOR[t] || "#9CA3AF";
              const isSel = leadTypeRef.current === t || extraLeadsRef.current.includes(t);
              const isPrimary = leadTypeRef.current === t;
              return (
                <button key={t}
                  onClick={() => {
                    if (!isPrimary) {
                      const oldPrimary = leadTypeRef.current;
                      const wasExtra = extraLeadsRef.current.includes(t);
                      const newExtra = wasExtra
                        ? extraLeadsRef.current.filter(x => x !== t)
                        : [oldPrimary, ...extraLeadsRef.current.filter(x => x !== t)];
                      setLeadType(t);
                      setExtraLeads(newExtra);
                      upd({ ...cur, leadType: t, extraLeads: newExtra, reactions: reactionsRef.current, extraStatus: extraStatusRef.current });
                    }
                  }}
                  style={{ background: isSel ? col+"18" : C.deep, color: isSel ? col : C.tm, border: isSel ? `1px solid ${col}55` : `1px solid ${C.b2}`, borderRadius: 20, padding: "5px 11px", fontSize: 10.5, cursor: isPrimary ? "default" : "pointer", fontWeight: isSel ? 600 : 400, transition: "all 0.12s" }}>
                  {isPrimary ? "★ " : isSel ? "✓ " : ""}{t}
                </button>
              );
            })}
          </div>
          <div style={{ color: C.td, fontSize: 9.5, marginTop: 4 }}>★ = principal · clique para definir como principal</div>
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
            onChange={(e) => upd({ ...cur, observacao: e.target.value, reactions: reactionsRef.current, leadType: leadTypeRef.current, extraLeads: extraLeadsRef.current, extraStatus: extraStatusRef.current })}
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

          {/* Prosseguir com Digitação */}
          <button
            onClick={() => setModalDigitar(true)}
            style={{ background:"linear-gradient(135deg,#6366F1,#4F46E5)", color:"#fff", border:"none", borderRadius:8, padding:"10px 18px", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap" }}
          >
            📝 Digitar
          </button>

          {/* V8 Digital — só para FGTS e CLT */}
          {(leadTypeRef.current === "FGTS" || leadTypeRef.current === "CLT" || (extraLeadsRef.current||[]).some(l=>l==="FGTS"||l==="CLT")) && (
            <button
              onClick={() => {
                sessionStorage.setItem("nexp_v8_simular_cpf", cur.cpf||"");
                const event = new CustomEvent("nexp_navigate", { detail:{ page:"apis", cpf:cur.cpf } });
                window.dispatchEvent(event);
              }}
              style={{ background:"linear-gradient(135deg,#0f4c81,#1a6bb5)", color:"#fff", border:"1px solid rgba(79,142,247,0.4)", borderRadius:8, padding:"10px 16px", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap", boxShadow:"0 2px 12px rgba(79,142,247,0.3)" }}
            >
              🏦 V8 Digital
            </button>
          )}

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
                <CommSimTabs contact={cur} />
              </div>
            )}
      </div>

      {/* ── Modal: Prosseguir com Digitação ── */}
      {modalDigitar && (
        <div style={{ position:"fixed", inset:0, zIndex:9900, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", animation:"fadeIn 0.2s ease" }}
          onClick={() => setModalDigitar(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.card, borderRadius:18, padding:"24px 28px", maxWidth:460, width:"92%", border:"1px solid #6366F155", boxShadow:"0 12px 48px rgba(0,0,0,0.8)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ color:"#818CF8", fontSize:15, fontWeight:800 }}>📝 Prosseguir com Digitação</div>
              <button onClick={()=>setModalDigitar(false)} style={{ background:"none", border:"none", color:C.tm, cursor:"pointer", fontSize:18 }}>✕</button>
            </div>
            {/* Info do cliente */}
            <div style={{ background:C.deep, borderRadius:10, padding:"12px 16px", marginBottom:16, border:`1px solid ${C.b1}` }}>
              <div style={{ color:C.tp, fontSize:14, fontWeight:700, marginBottom:4 }}>{cur.name||"—"}</div>
              <div style={{ color:C.tm, fontSize:11.5 }}>CPF: {cur.cpf||"—"}</div>
              {cur.phone&&<div style={{ color:C.tm, fontSize:11.5 }}>Tel: {cur.phone}</div>}
              {cur.email&&<div style={{ color:C.tm, fontSize:11.5 }}>Email: {cur.email}</div>}
              {(cur.cep||cur.cidade)&&<div style={{ color:C.tm, fontSize:11.5 }}>Endereço: {[cur.rua,cur.numero,cur.bairro,cur.cidade,cur.ufEnd].filter(Boolean).join(", ")}</div>}
              {cur.nomeMae&&<div style={{ color:C.tm, fontSize:11.5 }}>Mãe: {cur.nomeMae}</div>}
            </div>
            <div style={{ color:C.td, fontSize:11.5, marginBottom:16 }}>
              Todos os dados do cliente serão preenchidos automaticamente na tela de Digitação. Você poderá editar qualquer informação antes de enviar.
            </div>
            {/* Tipo de proposta */}
            <div style={{ marginBottom:16 }}>
              <div style={{ color:C.tm, fontSize:11, marginBottom:8, fontWeight:600 }}>Selecione o tipo de proposta:</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {["FGTS","CLT","INSS","CARTÃO"].map(t=>(
                  <button key={t} onClick={()=>{
                    // Salvar cliente em sessionStorage para DigitacaoPage carregar
                    sessionStorage.setItem("nexp_digitar_cliente", JSON.stringify(cur));
                    sessionStorage.setItem("nexp_digitar_tipo", t);
                    setModalDigitar(false);
                    if (onDigitar) onDigitar(cur);
                  }}
                    style={{ background:C.abg, color:C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:8, padding:"8px 16px", fontSize:12, fontWeight:700, cursor:"pointer", flex:1 }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
                <div key={c.id} onClick={() => navigate(c.id)}
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


// ── Página de Usuários (nova aba no menu) ──────────────────────
function RankTab({ users, currentUser }) {
  const myId   = currentUser.uid || currentUser.id;
  const [search, setSearch] = useState("");

  // Todos os usuários não deletados visíveis para este usuário
  const allUsers = users.filter(u => !u.deleted);

  // Para cada usuário, calcula quantos ele criou
  const stats = allUsers.map(u => {
    const uid = u.uid || u.id;
    const criados = allUsers.filter(x => x.createdBy === uid);
    const ativos   = criados.filter(x => x.active !== false).length;
    const inativos = criados.filter(x => x.active === false).length;
    // distribuição por nível
    const dist = {};
    criados.forEach(x => {
      const lbl = ROLE_LABEL[x.role] || x.role || "Operador";
      dist[lbl] = (dist[lbl] || 0) + 1;
    });
    return { ...u, criados: criados.length, ativos, inativos, dist };
  });

  // Ordenar por total de criados desc
  const sorted = [...stats]
    .filter(u => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (u.name||"").toLowerCase().includes(q) || (ROLE_LABEL[u.role]||"").toLowerCase().includes(q);
    })
    .sort((a, b) => b.criados - a.criados);

  // Estatísticas globais por nível
  const niveis = ["administrador","gerente","supervisor","operador"];
  const nivelStats = niveis.map(r => {
    const aliases = { administrador:["administrador","mestre"], gerente:["gerente","master"], supervisor:["supervisor"], operador:["operador","indicado","visitante","digitador"] };
    const grupo = allUsers.filter(u => (aliases[r]||[r]).includes(u.role));
    const ativos = grupo.filter(u => u.active !== false).length;
    return { role: r, total: grupo.length, ativos, inativos: grupo.length - ativos };
  });

  const roleIcons = { administrador:"👑", gerente:"🏆", supervisor:"🎯", operador:"👤" };

  return (
    <div>
      {/* Cards de distribuição por nível */}
      <div style={{ marginBottom:24 }}>
        <div style={{ color:C.ts, fontSize:13, fontWeight:700, marginBottom:12 }}>📊 Distribuição por Nível</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))", gap:12 }}>
          {nivelStats.map(n => (
            <div key={n.role} style={{ background:C.card, border:`1px solid ${ROLE_COLOR[n.role]}33`, borderRadius:14, padding:"16px 18px", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", top:-8, right:-8, fontSize:44, opacity:0.06 }}>{roleIcons[n.role]}</div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <span style={{ fontSize:20 }}>{roleIcons[n.role]}</span>
                <span style={{ color:ROLE_COLOR[n.role], fontSize:12, fontWeight:700 }}>{ROLE_LABEL[n.role]}</span>
              </div>
              <div style={{ color:C.tp, fontSize:28, fontWeight:800, lineHeight:1 }}>{n.total}</div>
              <div style={{ display:"flex", gap:10, marginTop:8 }}>
                <span style={{ color:"#34D399", fontSize:11 }}>✔ {n.ativos} ativos</span>
                {n.inativos > 0 && <span style={{ color:"#F87171", fontSize:11 }}>✘ {n.inativos}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ranking de criadores */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap", gap:8 }}>
        <div style={{ color:C.ts, fontSize:13, fontWeight:700 }}>🥇 Ranking de Cadastros</div>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.td, fontSize:12, pointerEvents:"none" }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar usuário..."
            style={{ ...S.input, paddingLeft:28, fontSize:12, padding:"6px 10px 6px 26px", width:200 }} />
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {sorted.map((u, idx) => {
          const col = ROLE_COLOR[u.role] || C.atxt;
          const isMe = (u.uid||u.id) === myId;
          const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx+1}`;
          return (
            <div key={u.id} style={{ background:C.card, border:`1px solid ${isMe ? C.atxt+"44" : C.b1}`, borderRadius:12, padding:"14px 16px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
              {/* Posição */}
              <div style={{ fontSize:idx < 3 ? 22 : 13, fontWeight:700, color:C.td, minWidth:32, textAlign:"center", flexShrink:0 }}>{medal}</div>
              {/* Avatar */}
              {u.photo
                ? <img src={u.photo} alt="" style={{ width:40, height:40, borderRadius:"50%", objectFit:"cover", border:`2px solid ${col}33`, flexShrink:0 }} />
                : <div style={{ width:40, height:40, borderRadius:"50%", background:col+"18", color:col, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:700, border:`2px solid ${col}33`, flexShrink:0 }}>{(u.name||"?")[0].toUpperCase()}</div>
              }
              {/* Info */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
                  <span style={{ color:C.tp, fontSize:13, fontWeight:700 }}>{u.name||u.email}</span>
                  {isMe && <span style={{ color:C.atxt, fontSize:10, background:C.abg, borderRadius:8, padding:"1px 7px", border:`1px solid ${C.atxt}33` }}>você</span>}
                  <span style={{ background:col+"18", color:col, fontSize:10, padding:"2px 7px", borderRadius:12, fontWeight:600, border:`1px solid ${col}33` }}>
                    {roleIcons[u.role]||"👤"} {ROLE_LABEL[u.role]||u.role}
                  </span>
                  {u.active === false && <span style={{ color:"#F87171", fontSize:10 }}>Inativo</span>}
                </div>
                {/* Distribuição dos criados */}
                {u.criados > 0 && (
                  <div style={{ display:"flex", gap:6, marginTop:5, flexWrap:"wrap" }}>
                    {Object.entries(u.dist).map(([lbl, cnt]) => (
                      <span key={lbl} style={{ color:C.td, fontSize:10.5, background:C.deep, borderRadius:8, padding:"2px 8px", border:`1px solid ${C.b2}` }}>
                        {lbl}: {cnt}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {/* Contadores */}
              <div style={{ display:"flex", gap:16, flexShrink:0, textAlign:"center" }}>
                <div>
                  <div style={{ color:C.atxt, fontSize:22, fontWeight:800, lineHeight:1 }}>{u.criados}</div>
                  <div style={{ color:C.td, fontSize:10 }}>cadastrados</div>
                </div>
                <div>
                  <div style={{ color:"#34D399", fontSize:18, fontWeight:700, lineHeight:1 }}>{u.ativos}</div>
                  <div style={{ color:C.td, fontSize:10 }}>ativos</div>
                </div>
                {u.inativos > 0 && (
                  <div>
                    <div style={{ color:"#F87171", fontSize:18, fontWeight:700, lineHeight:1 }}>{u.inativos}</div>
                    <div style={{ color:C.td, fontSize:10 }}>inativos</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div style={{ color:C.td, fontSize:13, textAlign:"center", padding:"32px 0" }}>Nenhum usuário encontrado.</div>
        )}
      </div>
    </div>
  );
}

function UsuariosPage({ users, setUsers, currentUser, sysConfig, onSysConfig }) {
  const [tab, setTab] = useState("usuarios");
  const [permSearch, setPermSearch] = useState("");
  const [permExpandedId, setPermExpandedId] = useState(null);
  const isMestre = currentUser.role === "mestre";
  const isMaster = currentUser.role === "master";

  const tabs = [
    { id:"usuarios",   label:"Criação de Usuários", icon:"➕", roles:["administrador","gerente","supervisor","mestre","master"] },
    { id:"rank",       label:"Rank",                 icon:"🏆", roles:["administrador","gerente","mestre","master"] },
    { id:"perfis",     label:"Perfis",               icon:"📋", roles:["administrador","mestre"] },
    { id:"permissoes", label:"Permissões",           icon:"🔐", roles:["administrador","gerente","mestre","master"] },
  ].filter(t => t.roles.includes(currentUser.role));

  return (
    <div style={{ minHeight:"100%", background:C.bg }}>
      <div style={{ padding:"30px 36px 0" }}>
        <h1 style={{ color:C.tp, fontSize:21, fontWeight:700, margin:"0 0 4px" }}>👥 Usuários</h1>
        <p style={{ color:C.tm, fontSize:12.5, margin:"0 0 20px" }}>Gerencie usuários, perfis e permissões</p>
        <div style={{ display:"flex", gap:2, borderBottom:`1px solid ${C.b1}` }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background:"transparent", border:"none", cursor:"pointer", padding:"9px 18px", fontSize:13,
                fontWeight: tab===t.id ? 600 : 400, color: tab===t.id ? C.atxt : C.tm,
                borderBottom: tab===t.id ? `2px solid ${C.atxt}` : "2px solid transparent",
                marginBottom:"-1px", transition:"all 0.12s", display:"flex", alignItems:"center", gap:6 }}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding:"26px 36px", maxWidth:860 }}>
        {tab === "usuarios" && <UsuariosTab users={users} setUsers={setUsers} currentUser={currentUser} />}
        {tab === "rank" && <RankTab users={users} currentUser={currentUser} />}
        {tab === "perfis" && (currentUser.role === "mestre" || currentUser.role === "administrador") && <PerfisTab users={users} setUsers={setUsers} currentUser={currentUser} />}
        {tab === "permissoes" && (isMestre || isMaster) && sysConfig && onSysConfig && (() => {
          const visibleUsers = users.filter(u => {
            if (u.role === "mestre") return false;
            if (isMestre) return true;
            return u.createdBy === (currentUser.uid || currentUser.id);
          });
          const ALL_TABS = [
            { id:"dashboard",    label:"Relatório de Leads" },
            { id:"contacts",     label:"Contatos" },
            { id:"review",       label:"Ver Clientes" },
            { id:"cstatus",      label:"Status" },
            { id:"add",          label:"Adicionar" },
            { id:"import",       label:"Importar" },
            { id:"simulador",    label:"Simulador" },
            { id:"apis",         label:"Bancos" },
            { id:"leds",         label:"Leds" },
            { id:"usuarios_page",label:"Usuários" },
            { id:"atalhos",      label:"Atalhos" },
            { id:"calendario",   label:"Agenda" },
            { id:"notificacoes", label:"Notificações" },
            { id:"chat",         label:"Nexp Chat" },
            { id:"premium",      label:"Premium Nexp" },
            { id:"config",       label:"Configurações" },
            { id:"digitacao",    label:"Digitação" },
            { id:"propostas",    label:"Propostas" },
          ];
          const roleColor2 = { master:"#94a3b8", indicado:"#34D399", visitante:"#60a5fa" };
          const filtered = visibleUsers.filter(u => !permSearch || (u.name||u.email||"").toLowerCase().includes(permSearch.toLowerCase()));

          return (
            <div>
              <h2 style={{ color:C.tp, fontSize:17, fontWeight:700, marginBottom:4 }}>🔐 Permissões por Usuário</h2>
              <p style={{ color:C.tm, fontSize:13, marginBottom:20 }}>
                {isMestre ? "Controle o acesso de todos os usuários." : "Controle o acesso dos usuários que você criou."}
              </p>
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
              <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"18px 20px" }}>
                <div style={{ color:C.tp, fontSize:13, fontWeight:700, marginBottom:10 }}>👤 Permissões individuais</div>
                <input placeholder="🔍 Pesquisar usuário..." value={permSearch}
                  onChange={e=>{setPermSearch(e.target.value);setPermExpandedId(null);}}
                  style={{ ...S.input, marginBottom:14 }} />
                {filtered.length === 0 && <div style={{ color:C.tm, fontSize:12.5, textAlign:"center", padding:"20px 0" }}>Nenhum usuário encontrado.</div>}
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {filtered.map(u => {
                    const uid = u.uid||u.id;
                    const col = roleColor2[u.role]||C.atxt;
                    const override = sysConfig.userOverrides?.[uid] || {};
                    const expanded = permExpandedId === uid;
                    const setOv = (key, val) => {
                      const prev = sysConfig.userOverrides||{};
                      onSysConfig({...sysConfig, userOverrides:{...prev,[uid]:{...(prev[uid]||{}),[key]:val}}});
                    };
                    return (
                      <div key={uid} style={{ borderRadius:12, background:C.deep, border:`1px solid ${expanded?C.atxt+"44":C.b2}`, overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer" }}
                          onClick={()=>setPermExpandedId(expanded?null:uid)}>
                          <div style={{ width:34, height:34, borderRadius:"50%", flexShrink:0, background:col+"1A", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:col }}>
                            {u.photo ? <img src={u.photo} alt="" style={{ width:"100%", height:"100%", borderRadius:"50%", objectFit:"cover" }} /> : (u.name||"?").charAt(0).toUpperCase()}
                          </div>
                          <div style={{ flex:1 }}>
                            <div style={{ color:C.tp, fontSize:13, fontWeight:600 }}>{u.name||u.email}</div>
                            <div style={{ color:col, fontSize:10.5 }}>{u.role}</div>
                          </div>
                          <span style={{ color:C.td, fontSize:12 }}>{expanded?"▲":"▼"}</span>
                        </div>
                        {expanded && (
                          <div style={{ padding:"12px 16px", borderTop:`1px solid ${C.b1}`, display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                            {ALL_TABS.map(t => {
                              const allowed = override.tabs ? override.tabs.includes(t.id) : true;
                              return (
                                <div key={t.id} onClick={()=>{
                                  const cur = override.tabs || ALL_TABS.map(x=>x.id);
                                  const next = allowed ? cur.filter(x=>x!==t.id) : [...cur, t.id];
                                  setOv("tabs", next);
                                }} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 9px", borderRadius:8, cursor:"pointer", background: allowed?C.abg:C.card, border:`1px solid ${allowed?C.atxt+"33":C.b1}` }}>
                                  <span style={{ color: allowed?C.atxt:C.tm, fontSize:11.5 }}>{t.label}</span>
                                  <div style={{ width:26, height:14, borderRadius:7, background:allowed?C.acc:C.b2, position:"relative", flexShrink:0, marginLeft:6 }}>
                                    <div style={{ position:"absolute", top:1, left:allowed?12:1, width:12, height:12, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                                  </div>
                                </div>
                              );
                            })}
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

// ── Configurar API (aba em Configurações) ─────────────────────
function ConfigurarAPITab({ currentUser }) {
  const isMestre = currentUser.role === "mestre" || currentUser.role === "administrador";
  const [apis, setApis] = useState(() => { try { return JSON.parse(localStorage.getItem("nexp_bank_apis")||"[]"); } catch { return []; } });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ banco:"", apiKey:"", endpoint:"", descricao:"" });
  const saveApis = (list) => { setApis(list); localStorage.setItem("nexp_bank_apis", JSON.stringify(list)); };
  const addApi = () => {
    if (!form.banco.trim() || !form.apiKey.trim()) return;
    saveApis([...apis, { ...form, id:Date.now() }]);
    setForm({ banco:"", apiKey:"", endpoint:"", descricao:"" }); setShowAdd(false);
  };
  const removeApi = (id) => saveApis(apis.filter(a=>a.id!==id));
  return (
    <div style={{ padding:"24px 0" }}>
      <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"20px 24px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div>
            <div style={{ color:C.tp, fontSize:14, fontWeight:700 }}>⬧ APIs configuradas ({apis.length})</div>
            <div style={{ color:C.tm, fontSize:12, marginTop:2 }}>Endpoints bancários para consultas no sistema.</div>
          </div>
          {isMestre && (
            <button onClick={()=>setShowAdd(p=>!p)} style={{ background:showAdd?C.deep:C.acc, color:showAdd?C.tm:"#fff", border:showAdd?`1px solid ${C.b2}`:"none", borderRadius:8, padding:"7px 14px", fontSize:12, cursor:"pointer", fontWeight:600 }}>
              {showAdd?"✕ Cancelar":"＋ Nova API"}
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
        {apis.length===0&&!showAdd&&<div style={{ textAlign:"center", padding:"28px 0", color:C.tm }}>{isMestre?"Clique em ＋ Nova API para adicionar":"Solicite ao administrador configurar as APIs"}</div>}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {apis.map(a=>(
            <div key={a.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:C.deep, borderRadius:10, border:`1px solid ${C.b2}` }}>
              <div style={{ width:36, height:36, borderRadius:9, background:C.abg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>🏦</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:C.tp, fontSize:13, fontWeight:600 }}>{a.banco}</div>
                <div style={{ color:C.td, fontSize:11 }}>{a.descricao||"API configurada"}{a.endpoint?" · Endpoint ✓":" · ⚠ Sem endpoint"}</div>
              </div>
              {isMestre&&<button onClick={()=>removeApi(a.id)} style={{ background:"#2D1515", border:"1px solid #EF444422", borderRadius:7, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}><svg width="11" height="12" viewBox="0 0 12 13" fill="none"><path d="M1 3h10M4 3V2h4v1M2 3l.7 8h6.6L10 3" stroke="#F87171" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 6v3M7 6v3" stroke="#F87171" strokeWidth="1.3" strokeLinecap="round"/></svg></button>}
            </div>
          ))}
        </div>
      </div>
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
      id: "temas",
      label: "Temas",
      icon: "🎨",
      roles: ["mestre", "master", "indicado"],
    },
    {
      id: "apis",
      label: "Configurar API",
      icon: "⬧",
      roles: ["mestre", "administrador"],
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
        {tab === "temas" && <TemasTab currentTheme={theme} onTheme={onTheme} />}
        {tab === "apis" && <ConfigurarAPITab currentUser={currentUser} />}
        {false && (() => {
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
            { id:"dashboard",    label:"Relatório de Leads" },
            { id:"contacts",     label:"Contatos" },
            { id:"review",       label:"Ver Clientes" },
            { id:"cstatus",      label:"Status" },
            { id:"add",          label:"Adicionar" },
            { id:"import",       label:"Importar" },
            { id:"simulador",    label:"Simulador" },
            { id:"apis",         label:"Bancos" },
            { id:"leds",         label:"Leds" },
            { id:"atalhos",      label:"Atalhos" },
            { id:"calendario",   label:"Agenda" },
            { id:"notificacoes", label:"Notificações" },
            { id:"stories",      label:"Stories" },
            { id:"chat",         label:"Nexp Chat" },
            { id:"premium",      label:"Premium Nexp" },
            { id:"config",       label:"Configurações" },
            { id:"digitacao",    label:"Digitação" },
            { id:"propostas",    label:"Propostas" },
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

// Subcomponente isolado para exibir/redefinir senha no painel de edição
function UsuariosTab({ users, setUsers, currentUser }) {
  const myRole = currentUser.role || "operador";
  const myId   = currentUser.uid || currentUser.id;
  const myLvl  = ROLE_HIERARCHY[myRole] ?? 99;
  const rolesCanCreate = getRolesCanCreate(myRole);
  const canCreateUsers = rolesCanCreate.length > 0;

  const [mode, setMode] = useState("list");
  const [form, setForm] = useState({
    name: "", cpf: "", email: "", password: "",
    role: rolesCanCreate[0] || "operador",
    photo: null,
  });
  const [err, setErr]   = useState("");
  const [ok,  setOk]    = useState("");
  const [expandId, setExpandId]     = useState(null);
  const [editForm, setEditForm]     = useState(null);
  const [showPwId, setShowPwId]     = useState(null);
  const [resetPw, setResetPw]       = useState(""); // eslint-disable-line no-unused-vars
  const [searchUser, setSearchUser] = useState("");
  const pRef     = useRef();
  const pEditRef = useRef();

  // Quem este usuário pode ver: administrador vê todos; outros veem só os que criaram + si próprio
  const allVisible = users.filter(u => {
    if (u.deleted) return false;
    if (myLvl === 0) return true;
    return u.createdBy === myId || (u.uid || u.id) === myId;
  });
  const visible = searchUser.trim()
    ? allVisible.filter(u => {
        const q = searchUser.toLowerCase();
        return (u.name||"").toLowerCase().includes(q) ||
               (u.email||"").toLowerCase().includes(q) ||
               (u.cpf||"").includes(q) ||
               (ROLE_LABEL[u.role]||"").toLowerCase().includes(q);
      })
    : allVisible;

  const setF  = (k, v) => setForm(f  => ({ ...f,  [k]: v }));
  const setEF = (k, v) => setEditForm(f => ({ ...f, [k]: v }));

  const flash = (msg) => { setOk(msg); setTimeout(() => setOk(""), 3000); };

  // ── Create user ──────────────────────────────────────────────
  const create = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim() || !form.cpf.trim()) {
      setErr("Nome, CPF, e-mail e senha são obrigatórios."); return;
    }
    if (!rolesCanCreate.includes(form.role)) {
      setErr("Você não tem permissão para criar usuários com esse nível."); return;
    }
    setErr(""); setOk("Criando usuário...");
    try {
      let uid; let reativado = false;
      try {
        uid = await createOperator(form.email, form.password);
      } catch (e) {
        if (e.code === "auth/email-already-in-use") {
          const found = users.find(u => u.email === form.email);
          const snapOld = await getDocs(query(collection(db,"users"), where("email","==",form.email)));
          if (found) { uid = found.uid || found.id; reativado = true; }
          else if (!snapOld.empty) { uid = snapOld.docs[0].id; reativado = true; }
          else throw new Error("Email já existe mas o perfil não foi encontrado.");
          if (!snapOld.empty) {
            const oldPass = snapOld.docs[0].data().password || null;
            if (oldPass) {
              try {
                const rApp  = initFirebaseApp(FB_CFG_DEL, "reativacao_"+Date.now());
                const rAuth = getAuth(rApp);
                const rCred = await signInSecondary(rAuth, form.email, oldPass);
                await updatePassword(rCred.user, form.password);
                await rAuth.signOut();
              } catch {}
            }
          }
        } else { throw e; }
      }
      const newU = {
        id: uid, uid,
        username: form.email, email: form.email,
        password: form.password,
        role: form.role,
        name: form.name, cpf: form.cpf,
        photo: form.photo || null,
        createdBy: myId,
        active: true, deleted: false,
      };
      await saveUserProfile(uid, newU);
      try {
        await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            service_id:"nexp_service", template_id:"template_hubbahe", user_id:"GaZRJdTXt0UMdEY3H",
            template_params:{ to_name:form.name, to_email:form.email, user_email:form.email,
              user_password:form.password, user_role:ROLE_LABEL[newU.role]||newU.role,
              access_link:"https://nexp-company.vercel.app" },
          }),
        });
        flash(reativado ? "Usuário reativado e e-mail enviado! ✉" : "Usuário criado e e-mail enviado! ✉");
      } catch { flash(reativado ? "Usuário reativado!" : "Usuário criado!"); }
      setForm({ name:"", cpf:"", email:"", password:"", role:rolesCanCreate[0]||"operador", photo:null });
      setMode("list");
    } catch (e) { setErr("Erro: "+e.message); setOk(""); }
  };

  // ── Delete user ──────────────────────────────────────────────
  const deleteUser = async (u) => {
    if (!window.confirm(`Excluir DEFINITIVAMENTE "${u.name}"?\nEsta ação não pode ser desfeita.`)) return;
    try {
      const uid2 = u.uid || u.id;
      if (u.email && u.password) {
        const secApp = initFirebaseApp(FB_CFG_DEL, "del_"+Date.now());
        const secAuth = getAuth(secApp);
        try { const c = await signInSecondary(secAuth, u.email, u.password); await c.user.delete(); }
        catch {} finally { try { await secAuth.signOut(); } catch {} }
      }
      await deleteDoc(doc(db,"users",uid2));
      flash(`Usuário "${u.name}" excluído!`);
    } catch (e) { setErr("Erro ao excluir: "+e.message); }
  };

  const openEdit = (u) => {
    if (expandId === u.id) { setExpandId(null); setEditForm(null); setResetPw(""); return; }
    setExpandId(u.id); setEditForm({ ...u }); setResetPw("");
  };

  const saveEdit = async () => {
    if (!editForm.name.trim() || !editForm.email.trim() || !editForm.cpf.trim()) {
      setErr("Nome, CPF e e-mail são obrigatórios."); return;
    }
    const conflict = users.find(u => u.email === editForm.email && u.id !== editForm.id);
    if (conflict) { setErr("Esse e-mail já está em uso."); return; }
    // Verifica que não está tentando elevar acima do seu próprio nível
    if ((ROLE_HIERARCHY[editForm.role]??99) < myLvl) {
      setErr("Você não pode conceder um nível acima do seu."); return;
    }
    try {
      await saveUserProfile(editForm.uid||editForm.id, editForm);
      setExpandId(null); setEditForm(null); setResetPw("");
      flash("Usuário atualizado!");
    } catch (e) { setErr("Erro ao salvar: "+e.message); }
  };

  const FB_CFG_DEL = {
    apiKey:"AIzaSyAnYyVIb5AxUd1qkQuXVEpEw7COzW2nvDw",
    authDomain:"nexpcompany-9a7ba.firebaseapp.com",
    projectId:"nexpcompany-9a7ba",
    storageBucket:"nexpcompany-9a7ba.firebasestorage.app",
    messagingSenderId:"1043432853586",
    appId:"1:1043432853586:web:10d443d6757420fe01cf8b",
  };

  const doReset = async (newPassword) => { // eslint-disable-line no-unused-vars
    const pw = (newPassword || resetPw || "").trim();
    if (!pw || pw.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");
    const email    = editForm.email;
    const uid2     = editForm.uid || editForm.id;
    const savedPass = editForm.password || null;
    let authOk = false;
    if (savedPass) {
      try {
        const sApp  = initFirebaseApp(FB_CFG_DEL, "reset_"+Date.now());
        const sAuth = getAuth(sApp);
        const cred  = await signInSecondary(sAuth, email, savedPass);
        await updatePassword(cred.user, pw);
        await sAuth.signOut();
        authOk = true;
      } catch {}
    }
    await saveUserProfile(uid2, { ...editForm, password: pw });
    setEditForm(f => f ? { ...f, password: pw } : f);
    setResetPw(""); return authOk;
  };

  const toggleActive = async (u) => {
    const updated = { ...u, active: u.active === false ? true : false };
    try { await saveUserProfile(u.uid||u.id, updated); flash(`Usuário ${updated.active?"ativado":"desativado"}!`); }
    catch (e) { setErr("Erro: "+e.message); }
  };

  const handlePhoto     = (e) => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setF("photo",ev.target.result); r.readAsDataURL(f); };
  const handleEditPhoto = (e) => { const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setEF("photo",ev.target.result); r.readAsDataURL(f); };

  // Roles que o editor pode atribuir ao editar (só abaixo do seu nível)
  const rolesCanAssign = myLvl === 0
    ? ["gerente","supervisor","operador"]
    : myLvl === 1 ? ["supervisor","operador"]
    : myLvl === 2 ? ["operador"] : [];

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
          <div style={{ color:C.ts, fontSize:13, flexShrink:0 }}>
            {visible.length} usuário{visible.length!==1?"s":""}
            {searchUser && allVisible.length!==visible.length && <span style={{ color:C.td, fontSize:11 }}> de {allVisible.length}</span>}
          </div>
          <div style={{ position:"relative", flex:1, maxWidth:220 }}>
            <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.td, fontSize:13, pointerEvents:"none" }}>🔍</span>
            <input value={searchUser} onChange={e=>setSearchUser(e.target.value)} placeholder="Buscar usuário..."
              style={{ ...S.input, paddingLeft:30, fontSize:12, padding:"6px 10px 6px 28px" }} />
            {searchUser && <button onClick={()=>setSearchUser("")} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:13 }}>✕</button>}
          </div>
        </div>
        {canCreateUsers && (
          <button onClick={() => { setMode(m=>m==="list"?"create":"list"); setErr(""); }}
            style={{ ...S.btn(mode==="create"?C.abg:C.acc, mode==="create"?C.atxt:"#fff"), border:mode==="create"?`1px solid ${C.atxt}33`:"none", padding:"8px 16px", fontSize:12.5 }}>
            {mode==="create"?"← Lista":"+ Novo usuário"}
          </button>
        )}
      </div>

      {ok  && <div style={{ background:"#091E12", border:"1px solid #34D39933", borderRadius:8, padding:"10px 14px", marginBottom:14, color:"#34D399", fontSize:13 }}>✓ {ok}</div>}
      {err && <div style={{ background:"#2D1515", border:"1px solid #EF444433", borderRadius:8, padding:"10px 14px", marginBottom:14, color:"#F87171", fontSize:13 }}>⚠ {err}</div>}

      {/* ── Hierarquia visual ── */}
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        {[
          { role:"administrador", icon:"👑", desc:"Acesso total" },
          { role:"gerente",       icon:"🏆", desc:"Cria supervisores e operadores" },
          { role:"supervisor",    icon:"🎯", desc:"Cria operadores" },
          { role:"operador",      icon:"👤", desc:"Sem criação de usuários" },
        ].map(h => {
          const isMy = myRole === h.role || (myRole==="mestre"&&h.role==="administrador") || (myRole==="master"&&h.role==="gerente") || (["indicado","visitante","digitador"].includes(myRole)&&h.role==="operador");
          return (
            <div key={h.role} style={{ background:isMy?ROLE_COLOR[h.role]+"22":C.deep, border:`1px solid ${isMy?ROLE_COLOR[h.role]+"55":C.b1}`, borderRadius:10, padding:"7px 13px", display:"flex", alignItems:"center", gap:7, flexShrink:0 }}>
              <span style={{ fontSize:14 }}>{h.icon}</span>
              <div>
                <div style={{ color:isMy?ROLE_COLOR[h.role]:C.ts, fontSize:11.5, fontWeight:isMy?700:400 }}>{ROLE_LABEL[h.role]}</div>
                <div style={{ color:C.td, fontSize:10 }}>{h.desc}</div>
              </div>
              {isMy && <span style={{ color:ROLE_COLOR[h.role], fontSize:10, fontWeight:700, marginLeft:2 }}>← você</span>}
            </div>
          );
        })}
      </div>

      {/* ── Formulário de criação ── */}
      {mode==="create" && canCreateUsers && (
        <div style={{ ...S.card, padding:"24px" }}>
          <div style={{ color:C.ts, fontSize:13, fontWeight:600, marginBottom:16 }}>Criar Novo Usuário</div>
          <div style={{ marginBottom:14 }}>
            <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>Foto</label>
            <input ref={pRef} type="file" accept="image/*" onChange={handlePhoto} style={{ color:C.ts, fontSize:13, display:"block" }} />
            {form.photo && <img src={form.photo} alt="" style={{ width:52, height:52, borderRadius:"50%", objectFit:"cover", marginTop:8, border:`2px solid ${C.atxt}33` }} />}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
            {[["Nome *","name","text"],["CPF *","cpf","text"],["E-mail *","email","email"],["Senha inicial *","password","password"]].map(([l,k,t])=>(
              <div key={k}>
                <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:4 }}>{l}</label>
                <input value={form[k]} onChange={e=>setF(k,e.target.value)} type={t} style={{ ...S.input }} />
              </div>
            ))}
          </div>
          {/* Nível de acesso — só mostra roles que pode criar */}
          <div style={{ marginBottom:16 }}>
            <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:7 }}>Nível de acesso</label>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {rolesCanCreate.map(r => {
                const sel = form.role===r;
                const col = ROLE_COLOR[r]||"#94a3b8";
                const icons = {gerente:"🏆",supervisor:"🎯",operador:"👤"};
                return (
                  <button key={r} onClick={()=>setF("role",r)}
                    style={{ background:sel?col+"18":C.deep, color:sel?col:C.tm, border:sel?`1px solid ${col}55`:`1px solid ${C.b2}`, borderRadius:20, padding:"7px 16px", fontSize:12, cursor:"pointer", fontWeight:sel?600:400 }}>
                    {icons[r]||"👤"} {sel?"✓ ":""}{ROLE_LABEL[r]}
                  </button>
                );
              })}
            </div>
          </div>
          <button onClick={create} style={{ ...S.btn(C.acc,"#fff"), padding:"11px 22px", fontSize:13.5 }}>Criar usuário</button>
        </div>
      )}

      {/* ── Lista de usuários ── */}
      {mode==="list" && (
        <div>
          {visible.length===0 && (
            <div style={{ color:C.td, fontSize:13, textAlign:"center", padding:"32px 0" }}>Nenhum usuário encontrado.</div>
          )}
          {visible.map(u => {
            const col      = ROLE_COLOR[u.role] || C.atxt;
            const isActive = u.active !== false;
            const isExpand = expandId === u.id;
            const tgLvl    = ROLE_HIERARCHY[u.role] ?? 99;
            const canEdit  = myLvl===0 || (myLvl < tgLvl && u.createdBy===myId) || (u.uid||u.id)===myId;
            const canToggle= myLvl===0 || (myLvl < tgLvl && u.createdBy===myId);
            const canDel   = myLvl < tgLvl && (myLvl===0 || u.createdBy===myId);
            const showPw   = showPwId === u.id && canSeePassword(myRole, u.role);
            const isSelf   = (u.uid||u.id) === myId;

            return (
              <div key={u.id} style={{ ...S.card, marginBottom:10, overflow:"hidden", opacity:isActive?1:0.55 }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", flexWrap:"wrap" }}>
                  {/* Avatar */}
                  <div style={{ position:"relative", flexShrink:0 }}>
                    {u.photo
                      ? <img src={u.photo} alt="" style={{ width:42, height:42, borderRadius:"50%", objectFit:"cover", border:`1.5px solid ${col}44` }} />
                      : <div style={{ width:42, height:42, borderRadius:"50%", background:col+"18", color:col, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:700, border:`1.5px solid ${col}33` }}>{ini(u.name||u.username)}</div>}
                    {!isActive && <div style={{ position:"absolute", bottom:0, right:0, width:12, height:12, borderRadius:"50%", background:"#EF4444", border:`2px solid ${C.card}` }}/>}
                  </div>
                  {/* Info */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
                      <span style={{ color:C.tp, fontSize:13.5, fontWeight:700 }}>{u.name||u.username}</span>
                      {isSelf && <span style={{ color:C.atxt, fontSize:10, background:C.abg, borderRadius:9, padding:"1px 7px", border:`1px solid ${C.atxt}33` }}>você</span>}
                      <span style={{ background:col+"18", color:col, fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:700, border:`1px solid ${col}33` }}>
                        {{administrador:"👑",gerente:"🏆",supervisor:"🎯",operador:"👤",mestre:"👑",master:"🏆",indicado:"👤",visitante:"👤",digitador:"👤"}[u.role]||"👤"} {ROLE_LABEL[u.role]||u.role}
                      </span>
                      {!isActive && <span style={{ color:"#F87171", fontSize:10, background:"#2D151522", borderRadius:9, padding:"1px 7px" }}>Inativo</span>}
                    </div>
                    <div style={{ color:C.tm, fontSize:11.5, marginTop:2 }}>{u.email}</div>
                    {u.cpf && <div style={{ color:C.td, fontSize:10.5 }}>CPF: {u.cpf}</div>}
                  </div>
                  {/* Ações */}
                  <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                    {canToggle && !isSelf && (
                      <button onClick={()=>toggleActive(u)}
                        style={{ ...S.btn(isActive?"#2D1515":"#091E12", isActive?"#F87171":"#34D399"), border:`1px solid ${isActive?"#F8717133":"#34D39933"}`, padding:"5px 11px", fontSize:11.5 }}>
                        {isActive?"Desativar":"Ativar"}
                      </button>
                    )}
                    {canEdit && (
                      <button onClick={()=>openEdit(u)}
                        style={{ ...S.btn(isExpand?C.acc:C.abg, isExpand?"#fff":C.atxt), border:`1px solid ${C.atxt}33`, padding:"5px 11px", fontSize:11.5 }}>
                        {isExpand?"▲ Fechar":"✏ Editar"}
                      </button>
                    )}
                    {canDel && !isSelf && (
                      <button onClick={()=>deleteUser(u)}
                        style={{ ...S.btn("transparent","#F87171"), border:"1px solid #F8717133", padding:"5px 11px", fontSize:11.5 }}>
                        🗑
                      </button>
                    )}
                  </div>
                </div>

                {/* Painel de edição */}
                {isExpand && editForm && (
                  <div style={{ padding:"16px 18px", borderTop:`1px solid ${C.b1}`, background:C.deep }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                      {[["Nome","name","text"],["CPF","cpf","text"],["E-mail","email","email"]].map(([l,k,t])=>(
                        <div key={k}>
                          <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:3 }}>{l}</label>
                          <input value={editForm[k]||""} onChange={e=>setEF(k,e.target.value)} type={t} style={{ ...S.input, fontSize:12 }} />
                        </div>
                      ))}
                      {/* Senha — Ver/Ocultar */}
                      <div>
                        <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:3 }}>Senha</label>
                        <div style={{ position:"relative" }}>
                          <input
                            value={editForm.password||""}
                            onChange={e=>setEF("password",e.target.value)}
                            type={showPw?"text":"password"}
                            placeholder="••••••"
                            style={{ ...S.input, fontSize:12, paddingRight:80 }}
                          />
                          {canSeePassword(myRole, u.role) && (
                            <button
                              onClick={()=>setShowPwId(showPwId===u.id?null:u.id)}
                              style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)", background:C.abg, border:`1px solid ${C.b2}`, borderRadius:6, color:C.atxt, cursor:"pointer", fontSize:10.5, padding:"2px 8px", fontWeight:600 }}>
                              {showPw?"🙈 Ocultar":"👁 Ver"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Foto */}
                    <div style={{ marginBottom:12 }}>
                      <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Foto</label>
                      <input ref={pEditRef} type="file" accept="image/*" onChange={handleEditPhoto} style={{ color:C.ts, fontSize:12, display:"block" }} />
                      {editForm.photo && <img src={editForm.photo} alt="" style={{ width:40, height:40, borderRadius:"50%", objectFit:"cover", marginTop:6, border:`2px solid ${C.atxt}33` }} />}
                    </div>
                    {/* Alterar nível — só se tiver permissão e não for si mesmo */}
                    {!isSelf && rolesCanAssign.length > 0 && (
                      <div style={{ marginBottom:14 }}>
                        <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:6 }}>Nível de acesso</label>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {rolesCanAssign.map(r => {
                            const sel = editForm.role===r;
                            const col2 = ROLE_COLOR[r]||"#94a3b8";
                            const icons = {gerente:"🏆",supervisor:"🎯",operador:"👤"};
                            return (
                              <button key={r} onClick={()=>setEF("role",r)}
                                style={{ background:sel?col2+"18":C.card, color:sel?col2:C.tm, border:sel?`1px solid ${col2}55`:`1px solid ${C.b2}`, borderRadius:20, padding:"5px 13px", fontSize:11.5, cursor:"pointer", fontWeight:sel?600:400 }}>
                                {icons[r]||"👤"} {sel?"✓ ":""}{ROLE_LABEL[r]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={saveEdit} style={{ ...S.btn(C.acc,"#fff"), padding:"8px 18px", fontSize:12.5 }}>💾 Salvar</button>
                      <button onClick={()=>{ setExpandId(null); setEditForm(null); }} style={{ ...S.btn(C.deep,C.tm), border:`1px solid ${C.b2}`, padding:"8px 14px", fontSize:12.5 }}>Cancelar</button>
                    </div>
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
      const TIPOS_PROPOSTA = ["proposta_editada","proposta_atualizada","edicao_liberada","pendente_documentacao","documentos_enviados","lembrete_evidencia","edicao_liberada"];
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(n => {
          if (TIPOS_PROPOSTA.includes(n.type)) return false; // nunca aparecem em notificações
          return n.toId === myId || n.broadcast === true;
        })
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
        <button onClick={onRestore} title="Restaurar chat" style={{ background:"rgba(255,255,255,0.2)", border:"none", color:"#fff", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center" }}>▲</button>
        <button onClick={onClose} title="Fechar — volta para bolinha" style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", borderRadius:"50%", width:22, height:22, cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
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
                const onlineCount = members.filter(uid => isReallyOnline(presence[uid])).length;
                return `👥 ${members.length} membros · 🟢 ${onlineCount} online${isGroupAdm ? " · Você é adm" : ""}`;
              })()
              : activeTab === "geral"
              ? (() => {
                  const onlineCount = users.filter(u => isReallyOnline(presence[u.uid||u.id])).length;
                  return `${users.length} membros · 🟢 ${onlineCount} online agora`;
                })()
              : tabUser
              ? (
                <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background: isReallyOnline(presence[activeTab]) ? "#16A34A" : "#FBBF24", display:"inline-block", flexShrink:0, boxShadow: isReallyOnline(presence[activeTab])?"0 0 5px #16A34A88":"0 0 5px #FBBF2488" }} />
                  <span style={{ color: isReallyOnline(presence[activeTab]) ? "#16A34A" : "#FBBF24" }}>
                    {isReallyOnline(presence[activeTab]) ? "online agora" : "offline"}
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
            const isOnline = isReallyOnline(presence[uid]);
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
                        <div style={{ color: isReallyOnline(presence[activeTab]) ? "#16A34A" : C.tm, fontSize:11.5, marginTop:2 }}>
                          {isReallyOnline(presence[activeTab]) ? "🟢 Online agora" : lastMsgTime(activeTab) ? `👁 Visto por último às ${lastMsgTime(activeTab)}` : "Nunca visto"}
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
                const online = isReallyOnline(presence[uid]);
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
              const isOnlineV = isReallyOnline(presence[vId]);
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
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("nexp_widget_collapsed") !== "false"; }
    catch { return true; }
  });
  const [activeSection, setActiveSection] = useState(() => {
    try { return localStorage.getItem("nexp_widget_section") || "weather"; }
    catch { return "weather"; }
  });

  const setCollapsedPersist = (v) => {
    setCollapsed(v);
    try { localStorage.setItem("nexp_widget_collapsed", String(v)); } catch {}
  };
  const setActiveSectionPersist = (v) => {
    setActiveSection(v);
    try { localStorage.setItem("nexp_widget_section", v); } catch {}
  };

  // Auto-fechar após 3 minutos sem interação
  const autoCloseRef = useRef(null);
  const resetAutoClose = () => {
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    autoCloseRef.current = setTimeout(() => setCollapsedPersist(true), 3 * 60 * 1000);
  };
  useEffect(() => {
    if (!collapsed) resetAutoClose();
    return () => { if (autoCloseRef.current) clearTimeout(autoCloseRef.current); };
  }, [collapsed]); // eslint-disable-line

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
    <div onClick={() => setCollapsedPersist(false)} style={{ position:"fixed", top:10, right:10, zIndex:300, background:C.card, border:`1px solid ${C.b1}`, borderRadius:10, padding:"6px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:6, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
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
          <button onClick={()=>setActiveSectionPersist("weather")} style={{ background:activeSection==="weather"?C.abg:"transparent", border:"none", color:activeSection==="weather"?C.atxt:C.tm, borderRadius:6, padding:"3px 9px", fontSize:11, cursor:"pointer", fontWeight:activeSection==="weather"?700:400 }}>🌤 Tempo</button>
          <button onClick={()=>setActiveSectionPersist("calc")} style={{ background:activeSection==="calc"?C.abg:"transparent", border:"none", color:activeSection==="calc"?C.atxt:C.tm, borderRadius:6, padding:"3px 9px", fontSize:11, cursor:"pointer", fontWeight:activeSection==="calc"?700:400 }}>🧮 Calc</button>
        </div>
        <button onClick={()=>setCollapsedPersist(true)} style={{ background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:14, lineHeight:1 }}>▲</button>
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
      const cred = EmailAuthProvider.credential(currentUser.email, deletePass);
      await reauthenticateWithCredential(auth.currentUser, cred);
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
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:C.deep, borderRadius:9 }}>
            <span style={{ color:C.tm, fontSize:12.5 }}>Valor da parcela (margem)</span>
            <span style={{ color:C.tp, fontSize:14, fontWeight:700 }}>{fmtBRL(info.margem)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.2)", borderRadius:9 }}>
            <span style={{ color:"#FBBF24", fontSize:12.5, fontWeight:600 }}>(⚡ Liberação rápida)</span>
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
  // Coeficientes editáveis por banco
  const [coefs, setCoefs] = useState(() => {
    const obj = {};
    bancos.forEach(b => { obj[b.id] = String(toF(b[chaveCoef]) || toF(b.coef_emp) || 0.02718); });
    return obj;
  });

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
              const c = toF(coefs[b.id]) || 0.02718;
              return (
                <tr key={b.id} style={{ background: i%2===0 ? C.card : C.deep }}>
                  <td style={{ color:C.tp, fontWeight:600, padding:"9px 12px", borderBottom:`1px solid ${C.b1}`, whiteSpace:"nowrap" }}>{b.nome}</td>
                  <td style={{ padding:"5px 8px", borderBottom:`1px solid ${C.b1}` }}>
                    <input value={coefs[b.id] ?? String(c)} onChange={e=>setCoefs(p=>({...p,[b.id]:e.target.value}))}
                      style={{ background:"transparent", border:`1px solid ${C.b2}`, borderRadius:6, color:C.ts, fontSize:11, padding:"3px 6px", width:72, textAlign:"center" }} />
                  </td>
                  {prazos.map(p => {
                    const val = m > 0 && c > 0 ? m / c : null;
                    return (
                      <td key={p.prazo} style={{ textAlign:"center", padding:"9px 10px", borderBottom:`1px solid ${C.b1}` }}>
                        {val !== null
                          ? <span onClick={()=>setBalao({ val, prazo:p.prazo, banco:b.nome, coef:c, margem:m })}
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
                    return (
                      <td key={"r"+p.prazo} style={{ textAlign:"center", padding:"9px 10px", borderBottom:`1px solid ${C.b1}` }}>
                        {val !== null
                          ? <span onClick={()=>setBalao({ val, prazo:p.prazo, banco:b.nome, coef:c, margem:(m+mReaj) })}
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
    { id:1, prazo:"6x",  nParcelas:6,  coef:"0.19612" },
    { id:2, prazo:"8x",  nParcelas:8,  coef:"0.14857" },
    { id:3, prazo:"12x", nParcelas:12, coef:"0.10378" },
    { id:4, prazo:"14x", nParcelas:14, coef:"0.09180" },
    { id:5, prazo:"16x", nParcelas:16, coef:"0.08178" },
    { id:6, prazo:"18x", nParcelas:18, coef:"0.07393" },
    { id:7, prazo:"24x", nParcelas:24, coef:"0.05860" },
    { id:8, prazo:"36x", nParcelas:36, coef:"0.04263" },
    { id:9, prazo:"48x", nParcelas:48, coef:"0.03429" },
  ]);
  const [novaLinha, setNovaLinha] = useState({ prazo:"", nParcelas:"", coef:"" });
  const [showAdd, setShowAdd] = useState(false);
  const [balao, setBalao] = useState(null);
  const m = toF(margem);

  const addLinha = () => {
    if (!novaLinha.prazo || !novaLinha.coef) return;
    const np = parseInt(novaLinha.nParcelas) || parseInt(novaLinha.prazo) || 0;
    setLinhas(p=>[...p,{...novaLinha, id:Date.now(), nParcelas:np}]);
    setNovaLinha({prazo:"",nParcelas:"",coef:""});
    setShowAdd(false);
  };

  return (
    <div>
      <BalaoCelula info={balao} onClose={()=>setBalao(null)} />
      <div style={{ color:C.td, fontSize:11.5, marginBottom:14, padding:"9px 13px", background:C.abg, borderRadius:9, border:`1px solid ${C.atxt}22` }}>
        <b style={{ color:C.atxt }}>Regra CLT:</b> Valor Liberado = Margem ÷ Coeficiente · Parcela = Margem (valor fixo por mês)
      </div>
      <div style={{ display:"flex", gap:14, alignItems:"flex-end", marginBottom:18, flexWrap:"wrap" }}>
        <div style={{ flex:"0 0 220px" }}>
          <label style={{ color:C.tm, fontSize:11.5, display:"block", marginBottom:5 }}>Margem do cliente (R$)</label>
          <input value={margem} onChange={e=>setMargem(e.target.value)} placeholder="Ex: 424,00"
            style={{ ...S.input, fontSize:15, fontWeight:600 }} />
        </div>
        {m > 0 && <div style={{ color:C.atxt, fontSize:13, fontWeight:700, paddingBottom:8 }}>Margem: {fmtBRL(m)}</div>}
      </div>
      <div style={{ overflowX:"auto", marginBottom:12 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5, minWidth:560 }}>
          <thead>
            <tr style={{ background:C.deep }}>
              <th style={{ color:C.tm, fontWeight:700, padding:"9px 12px", textAlign:"left", borderBottom:`1px solid ${C.b1}` }}>Prazo</th>
              <th style={{ color:C.atxt, fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}`, width:110 }}>Coeficiente</th>
              <th style={{ color:"#34D399", fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}` }}>Parcela (R$)</th>
              <th style={{ color:C.tm, fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}` }}>Qtd Parcelas</th>
              <th style={{ color:C.atxt, fontWeight:700, padding:"9px 10px", textAlign:"center", borderBottom:`1px solid ${C.b1}` }}>Valor Liberado</th>
              <th style={{ width:28, borderBottom:`1px solid ${C.b1}` }} />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => {
              const c = toF(l.coef);
              const valorLiberado = m > 0 && c > 0 ? m / c : null;
              return (
                <tr key={l.id} style={{ background: i%2===0 ? C.card : C.deep }}>
                  {/* Prazo */}
                  <td style={{ color:C.tp, fontWeight:700, padding:"8px 12px", borderBottom:`1px solid ${C.b1}` }}>{l.prazo}</td>
                  {/* Coef editável */}
                  <td style={{ padding:"5px 8px", borderBottom:`1px solid ${C.b1}` }}>
                    <input value={l.coef} onChange={e=>setLinhas(p=>p.map(x=>x.id===l.id?{...x,coef:e.target.value}:x))}
                      style={{ background:"transparent", border:`1px solid ${C.b2}`, borderRadius:6, color:C.ts, fontSize:12, padding:"4px 7px", width:"100%", textAlign:"center" }} />
                  </td>
                  {/* Parcela = margem, editável */}
                  <td style={{ padding:"5px 8px", borderBottom:`1px solid ${C.b1}` }}>
                    <input
                      value={l.parcelaEdit !== undefined ? l.parcelaEdit : (m > 0 ? String(m) : "")}
                      onChange={e=>setLinhas(p=>p.map(x=>x.id===l.id?{...x,parcelaEdit:e.target.value}:x))}
                      placeholder={m > 0 ? fmtBRL(m) : "= margem"}
                      style={{ background:"transparent", border:`1px solid rgba(52,211,153,0.4)`, borderRadius:6, color:"#34D399", fontSize:12, padding:"4px 7px", width:"100%", textAlign:"center", fontWeight:600 }} />
                  </td>
                  {/* Qtd Parcelas editável */}
                  <td style={{ padding:"5px 8px", borderBottom:`1px solid ${C.b1}` }}>
                    <input value={l.nParcelas} onChange={e=>setLinhas(p=>p.map(x=>x.id===l.id?{...x,nParcelas:e.target.value}:x))}
                      style={{ background:"transparent", border:`1px solid ${C.b2}`, borderRadius:6, color:C.ts, fontSize:12, padding:"4px 7px", width:60, textAlign:"center" }} />
                  </td>
                  {/* Valor Liberado clicável */}
                  <td style={{ textAlign:"center", padding:"8px 10px", borderBottom:`1px solid ${C.b1}` }}>
                    {valorLiberado !== null
                      ? <span onClick={()=>setBalao({val:valorLiberado, prazo:l.prazo, banco:"CLT", coef:c, margem:m})}
                          style={{ color:C.atxt, fontWeight:800, cursor:"pointer", padding:"4px 10px", borderRadius:8, display:"inline-block", fontSize:13, background:C.abg, border:`1px solid ${C.atxt}22` }}
                          onMouseEnter={e=>e.currentTarget.style.background=C.acc+"22"}
                          onMouseLeave={e=>e.currentTarget.style.background=C.abg}>
                          {fmtBRL(valorLiberado)}
                        </span>
                      : <span style={{ color:C.td }}>—</span>}
                  </td>
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
            <input value={novaLinha.nParcelas} onChange={e=>setNovaLinha(p=>({...p,nParcelas:e.target.value}))} placeholder="Nº parcelas" style={{ ...S.input, width:110 }} />
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
// ── Modal Digitação Rápida (V8) — com revisão e edição ───────────
function ModalDigitacaoRapida({ tabela, balance, cpf, provider, apiFetch, fmtBRL, onClose, onSuccess, setAcompData, contacts, currentUser, clientePreFill,
  // Elevated states — passed from V8DigitalTab to prevent remount
  step, setStep, banks, setBanks, payType, setPayType, loading, setLoading,
  result, setResult, err, setErr, cepLoading, setCepLoading, bankSearch, setBankSearch,
  // initialForm passed once — form state lives INSIDE modal to prevent re-render typing bug
  initialForm,
}) {
  // ✅ Form state local — evita re-render do pai ao digitar (bug 1 caractere)
  const [form, setForm] = useState(() => initialForm || {});

  // ✅ Sincroniza form quando initialForm muda (cruzamento de dados carregado depois)
  useEffect(() => {
    if (initialForm && Object.keys(initialForm).length > 0) {
      setForm(initialForm);
    }
  }, [initialForm]); // eslint-disable-line

  // ✅ Quando initialForm mudar (novo cliente), atualiza o form interno
  // Preserva campos de pagamento se o usuário já preencheu
  useEffect(() => {
    if (initialForm && Object.keys(initialForm).length > 0) {
      setForm(prev => {
        const paymentFilled = prev.pix || prev.bankId || prev.bankAccountNumber;
        if (paymentFilled) {
          // Mantém os dados de pagamento já preenchidos
          return {
            ...initialForm,
            pix:              prev.pix              || initialForm.pix              || "",
            bankId:           prev.bankId           || initialForm.bankId           || "",
            bankAccountNumber:prev.bankAccountNumber|| initialForm.bankAccountNumber|| "",
            bankAccountBranch:prev.bankAccountBranch|| initialForm.bankAccountBranch|| "",
            bankAccountDigit: prev.bankAccountDigit || initialForm.bankAccountDigit || "",
            bankAccountType:  prev.bankAccountType  || initialForm.bankAccountType  || "checking_account",
          };
        }
        return initialForm;
      });
    }
  }, [initialForm]); // eslint-disable-line
  const vlr   = parseFloat(tabela?.sim?.availableBalance || 0);
  const simId = tabela?.sim?.id || "";
  const balId = balance?.id || "";
  const cpfClean = (cpf||"").replace(/\D/g,"");

  // v8c for payment suggestions display
  const pre = clientePreFill || {};
  const v8c = pre.clienteV8 || {};

  // Buscar endereço pelo CEP (ViaCEP)
  const buscarCEP = async (cep) => {
    const c = cep.replace(/\D/g,"");
    if (c.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${c}/json/`);
      const d = await r.json();
      if (!d.erro) {
        setForm(p=>({
          ...p,
          street:       d.logradouro || p.street,
          neighborhood: d.bairro     || p.neighborhood,
          city:         d.localidade || p.city,
          state:        d.uf         || p.state,
          complement:   d.complemento|| p.complement,
        }));
      }
    } catch {}
    setCepLoading(false);
  };

  useEffect(() => {
    if (!banks.length) apiFetch("/banks").then(d=>setBanks(d?.data||[])).catch(()=>{});
    if (form.postalCode && !form.street) buscarCEP(form.postalCode);
  }, []); // eslint-disable-line

  const digitar = async () => {
    setLoading(true); setErr("");

    // ── Normaliza telefone — pega sempre os últimos 11 dígitos ──
    const phoneRaw = (form.phone||"").replace(/\D/g,"");
    // Pega os últimos 11 dígitos (ou 10 se menor) — nunca bloqueia
    const phoneNorm = phoneRaw.length > 11 ? phoneRaw.slice(-11) : phoneRaw;
    const phoneDDD = phoneNorm.length >= 10 ? phoneNorm.slice(0,2) : "11";
    const phoneNum = phoneNorm.length >= 10 ? phoneNorm.slice(2) : phoneNorm;

    try {
      // Normaliza chave PIX — remove formatação de CPF, formata telefone
      const normalizePix = (raw) => {
        const v = (raw||"").trim();
        const digitos = v.replace(/\D/g,"");
        // CPF com formatação → só números
        if (/^\d{3}[.-]\d{3}[.-]\d{3}-\d{2}$/.test(v)) return digitos;
        if (/^\d{11}$/.test(digitos) && /^[\d.-]+$/.test(v)) return digitos;
        // Telefone → +55DDDNUMERO
        if (/^[(+\d][\d\s()-]+$/.test(v) && digitos.length >= 10) {
          return digitos.startsWith("55") ? `+${digitos}` : `+55${digitos}`;
        }
        return v; // e-mail ou UUID — mantém como está
      };

      const pixKey = normalizePix(form.pix);

      // V8 payment format: { type, data: { ... } }
      // type must match exactly what V8 expects — "PIX" or "TED"
      const paymentData = payType === "pix"
        ? { type: "PIX", data: { pix: pixKey } }
        : { type: "TED", data: {
              bankId:             form.bankId,
              bankAccountNumber:  form.bankAccountNumber,
              bankAccountBranch:  form.bankAccountBranch,
              bankAccountDigit:   form.bankAccountDigit,
              bankAccountType:    form.bankAccountType,
            }};

      const body = {
        fgtsSimulationId:             simId,
        simulationFeesId:             tabela?.feeId || "",
        balanceId:                    balId,
        name:                         form.name,
        individualDocumentNumber:     cpfClean,
        documentIdentificationNumber: form.rg,
        motherName:                   form.motherName,
        nationality:                  form.nationality,
        isPEP:                        form.isPEP,
        email:                        form.email,
        birthDate:                    form.birthDate,
        maritalStatus:                form.maritalStatus,
        personType:                   "natural",
        phone:                        phoneNum,
        phoneCountryCode:             "55",
        phoneRegionCode:              phoneDDD,
        postalCode:                   form.postalCode,
        state:                        form.state,
        neighborhood:                 form.neighborhood,
        addressNumber:                form.addressNumber,
        city:                         form.city,
        street:                       form.street,
        complement:                   form.complement,
        formalizationLink:            "",
        provider,
        payment:                      paymentData,
        fgtsProposalsPeriods: (balance?.periods||balance?.installments||[]).map(p=>({
          amount: parseFloat(p.amount||p.totalAmount||0),
          dueDate: p.dueDate||p.date,
        })),
      };
      const res = await apiFetch("/fgts/proposal","POST",body);
      setResult(res);

      // Limpa cache do acompanhamento para forçar reload na próxima visita
      setAcompData(null);

      // Notifica o pai para navegar para acompanhamento
      if (onSuccess) onSuccess(res);

      // Salvar/atualizar contato nos dados salvos
      try {
        const { addDoc, collection: fbCol, query, where, getDocs, updateDoc, doc: fbDoc } = await import("firebase/firestore");
        const { db: fbDb } = await import("./firebase");
        // Busca contato existente pelo CPF
        const qContato = query(fbCol(fbDb,"contacts"), where("cpf","==",cpfClean));
        const snap = await getDocs(qContato);
        const dadosContato = {
          name: form.name, cpf: cpfClean, email: form.email,
          phone: `${phoneDDD}${phoneNum}`, rg: form.rg||"",
          nomeMae: form.motherName||"", dataNascimento: form.birthDate||"",
          cep: form.postalCode||"", rua: form.street||"", numero: form.addressNumber||"",
          complemento: form.complement||"", bairro: form.neighborhood||"",
          cidade: form.city||"", ufEnd: form.state||"",
          updatedAt: Date.now(),
        };
        if (!snap.empty) {
          await updateDoc(fbDoc(fbDb,"contacts",snap.docs[0].id), dadosContato);
        } else {
          await addDoc(fbCol(fbDb,"contacts"), { ...dadosContato, createdAt: Date.now() });
        }
      } catch(e2) { console.warn("Aviso: dados do cliente não salvos:", e2.message); }

      // Salvar cópia no Firestore
      try {
        const { addDoc, collection: fbCol } = await import("firebase/firestore");
        const { db: fbDb } = await import("./firebase");
        await addDoc(fbCol(fbDb,"propostas"), {
          tipo: "FGTS",
          origem: "V8 Digital",
          v8ProposalId: res?.id || "",
          v8ContractNumber: res?.contractNumber || "",
          v8FormalizationLink: res?.formalizationLink || "",
          v8Status: res?.status || "",
          nome:      form.name,
          cpf:       cpfClean,
          email:     form.email,
          phone:     form.phone,
          provider,
          tabela:    tabela?.label || "",
          valorLiberado: parseFloat(tabela?.sim?.availableBalance||0),
          balanceId: balId,
          simulationId: simId,
          pagamento: payType === "pix" ? { tipo:"PIX", chave:form.pix } : { tipo:"Transferência", banco:form.bankId, agencia:form.bankAccountBranch, conta:form.bankAccountNumber, digito:form.bankAccountDigit },
          status:    "Proposta Digitada",
          criadoPor: currentUser?.uid || currentUser?.id || "v8",
          criadoPorNome: currentUser?.name || currentUser?.email || "V8 Digital",
          createdAt: Date.now(),
          docFiles:  [],
        });
      } catch(saveErr) {
        console.warn("Aviso: proposta criada na V8 mas não salva no Firestore:", saveErr.message);
      }
    } catch(e) { 
      // Mostra erro detalhado sem apagar campos
      const detail = `❌ ${e.message}\n\n📋 Telefone enviado: DDD=${phoneDDD} | Número=${phoneNum}`;
      setErr(detail);
    }
    setLoading(false);
  };

  const inputStyle = { ...S.input, fontSize:12, padding:"7px 10px" };
  const labelStyle = { color:C.tm, fontSize:10.5, display:"block", marginBottom:3 };
  const setF = (k,v) => setForm(p=>({...p,[k]:v}));
  const fieldGroup = (label, key, type="text", placeholder="") => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={form[key]||""} onChange={e=>{ const v=e.target.value; setForm(p=>({...p,[key]:v})); }} type={type} placeholder={placeholder} autoComplete="off" style={inputStyle}/>
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:18, width:"100%", maxWidth:600, maxHeight:"95vh", overflowY:"auto", display:"flex", flexDirection:"column" }}>

        {/* Header fixo */}
        <div style={{ padding:"18px 22px 14px", borderBottom:`1px solid ${C.b1}`, background:C.card, position:"sticky", top:0, zIndex:1, borderRadius:"18px 18px 0 0" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ color:C.ts, fontSize:14, fontWeight:700 }}>📝 Digitar Proposta FGTS</div>
              <div style={{ display:"flex", gap:12, marginTop:4 }}>
                <span style={{ color:C.tm, fontSize:12 }}>CPF: <b style={{ color:C.tp }}>{cpf}</b></span>
                <span style={{ color:C.tm, fontSize:12 }}>Tabela: <b style={{ color:C.atxt, textTransform:"capitalize" }}>{tabela?.label}</b></span>
                <span style={{ color:"#34D399", fontSize:12, fontWeight:700 }}>{fmtBRL(vlr)}</span>
              </div>
            </div>
            <button onClick={onClose} style={{ background:C.deep, border:`1px solid ${C.b2}`, color:C.tm, borderRadius:8, padding:"6px 14px", cursor:"pointer", fontSize:13 }}>✕</button>
          </div>
          {/* Steps */}
          <div style={{ display:"flex", gap:6, marginTop:12 }}>
            {[["review","1. Revisar dados"],["payment","2. Pagamento"],["done","3. Concluído"]].map(([s,l])=>(
              <div key={s} style={{ flex:1, padding:"5px 0", textAlign:"center", background:step===s?C.abg:C.deep, color:step===s?C.atxt:C.td, borderRadius:8, fontSize:11.5, fontWeight:step===s?700:400, border:step===s?`1px solid ${C.atxt}33`:`1px solid ${C.b2}` }}>{l}</div>
            ))}
          </div>
        </div>

        <div style={{ padding:"18px 22px", flex:1 }}>
          {result ? (
            <div>
              <div style={{ background:"rgba(52,211,153,0.1)", border:"1px solid #34D39933", borderRadius:12, padding:"18px", marginBottom:14 }}>
                <div style={{ color:"#34D399", fontSize:15, fontWeight:700, marginBottom:12 }}>✅ Proposta Criada com Sucesso!</div>
                {[["ID da Proposta",result.id],["Número do Contrato",result.contractNumber],["Link de Formalização",result.formalizationLink],["Status",result.status],["Valor Liberado",fmtBRL(result.disbursedIssueAmount||vlr)]].filter(([,v])=>v).map(([l,v])=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid rgba(52,211,153,0.15)` }}>
                    <span style={{ color:C.tm, fontSize:12 }}>{l}</span>
                    <span style={{ color:C.tp, fontSize:12, fontWeight:600, wordBreak:"break-all", textAlign:"right", maxWidth:"60%", fontFamily:l.includes("ID")||l.includes("Contrato")?"monospace":"inherit" }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>{ if(onSuccess) onSuccess(result); onClose(); }}
                  style={{ flex:1, background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:10, padding:"12px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                  📡 Ver em Acompanhamento
                </button>
                <button onClick={onClose}
                  style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:10, padding:"12px 18px", fontSize:13, cursor:"pointer" }}>
                  Fechar
                </button>
              </div>
            </div>
          ) : step === "review" ? (
            <div>
              <div style={{ color:C.ts, fontSize:12.5, fontWeight:700, marginBottom:12 }}>Revise e edite os dados antes de continuar:</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                {fieldGroup("Nome completo *","name","text","Nome")}
                {fieldGroup("CPF *","cpf","text","000.000.000-00")}
                {fieldGroup("RG / Documento *","rg","text","Número do documento")}
                {fieldGroup("Nome da mãe *","motherName","text","Nome da mãe")}
                <div>
                  <label style={labelStyle}>Data de nascimento * <span style={{ color:C.td, fontSize:9 }}>(AAAA-MM-DD ou cole)</span></label>
                  <input value={form.birthDate} onChange={e=>setF("birthDate",e.target.value)}
                    onPaste={e=>{
                      e.preventDefault();
                      const raw=(e.clipboardData||window.clipboardData).getData("text");
                      // Normaliza DD/MM/AAAA → AAAA-MM-DD
                      const m=raw.trim().match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
                      if(m) setF("birthDate",`${m[3]}-${m[2]}-${m[1]}`);
                      else setF("birthDate",raw.trim());
                    }}
                    placeholder="AAAA-MM-DD" type="text"
                    style={inputStyle}/>
                </div>
                {fieldGroup("E-mail *","email","email","email@exemplo.com")}
                <div>
                  <label style={labelStyle}>Telefone (DDD + número) *</label>
                  <input
                    value={(form.phone||"").replace(/\D/g,"").slice(0,11)}
                    onChange={e=>{
                      const v = e.target.value.replace(/\D/g,"").slice(0,11);
                      setF("phone", v);
                    }}
                    placeholder="84999999999"
                    inputMode="numeric"
                    autoComplete="off"
                    style={{ ...inputStyle, fontFamily:"monospace", letterSpacing:1 }}
                  />
                  <div style={{ marginTop:3, fontSize:10.5, color: (form.phone||"").replace(/\D/g,"").length>=10?"#34D399":"#FBBF24" }}>
                    {(form.phone||"").replace(/\D/g,"").length}/11 dígitos
                    {(form.phone||"").replace(/\D/g,"").length>=10 ? " ✓" : " — mínimo 10 dígitos com DDD"}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Nacionalidade *</label>
                  <select value={form.nationality} onChange={e=>setF("nationality",e.target.value)} style={inputStyle}>
                    <option>Brasileiro(a)</option>
                    <option>Outros</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Estado civil *</label>
                  <select value={form.maritalStatus} onChange={e=>setF("maritalStatus",e.target.value)} style={inputStyle}>
                    <option value="single">Solteiro(a)</option>
                    <option value="married">Casado(a)</option>
                    <option value="widower">Viúvo(a)</option>
                    <option value="divorced">Divorciado(a)</option>
                  </select>
                </div>
              </div>
              <div style={{ color:C.ts, fontSize:12, fontWeight:700, marginBottom:8 }}>Endereço</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                {/* CEP com busca automática */}
                <div>
                  <label style={labelStyle}>CEP *</label>
                  <div style={{ display:"flex", gap:6 }}>
                    <input value={form.postalCode} onChange={e=>setF("postalCode",e.target.value.replace(/\D/g,""))}
                      onBlur={e=>buscarCEP(e.target.value)}
                      placeholder="00000000" maxLength={8}
                      style={{ ...inputStyle, flex:1 }}/>
                    <button type="button" onClick={()=>buscarCEP(form.postalCode)} disabled={cepLoading}
                      style={{ background:C.acc, color:"#fff", border:"none", borderRadius:8, padding:"0 10px", fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>
                      {cepLoading?"...":"🔍"}
                    </button>
                  </div>
                  {cepLoading && <div style={{ color:C.atxt, fontSize:10, marginTop:3 }}>Buscando endereço...</div>}
                </div>
                {fieldGroup("Rua / Logradouro *","street","text","Rua")}
                {fieldGroup("Número *","addressNumber","text","Nº")}
                {fieldGroup("Complemento","complement","text","Apto, casa...")}
                {fieldGroup("Bairro *","neighborhood","text","Bairro")}
                {fieldGroup("Cidade *","city","text","Cidade")}
                <div>
                  <label style={labelStyle}>Estado (UF) *</label>
                  <select value={form.state} onChange={e=>setF("state",e.target.value)} style={inputStyle}>
                    <option value="">Selecione</option>
                    {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf=><option key={uf}>{uf}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8, paddingTop:18 }}>
                  <input type="checkbox" checked={form.isPEP} onChange={e=>setF("isPEP",e.target.checked)} id="pep_check"/>
                  <label htmlFor="pep_check" style={{ color:C.tm, fontSize:12, cursor:"pointer" }}>Pessoa Politicamente Exposta (PEP)</label>
                </div>
              </div>
              <div style={{ background:C.deep, borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:11 }}>
                <div style={{ color:C.td }}>Simulation ID: <span style={{ fontFamily:"monospace", color:C.tm }}>{simId||"—"}</span></div>
                <div style={{ color:C.td }}>Balance ID: <span style={{ fontFamily:"monospace", color:C.tm }}>{balId||"—"}</span></div>
                <div style={{ color:C.td }}>Tabela: <b style={{ color:C.atxt, textTransform:"capitalize" }}>{tabela?.label}</b> · Valor: <b style={{ color:"#34D399" }}>{fmtBRL(vlr)}</b></div>
              </div>
              <button onClick={()=>setStep("payment")}
                style={{ width:"100%", background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:10, padding:"12px", fontSize:14, fontWeight:700, cursor:"pointer" }}>
                Continuar → Dados de Pagamento
              </button>
            </div>
          ) : (
            <div>
              <div style={{ color:C.ts, fontSize:12.5, fontWeight:700, marginBottom:12 }}>Forma de recebimento:</div>
              <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                {[["pix","💠 Chave PIX"],["transfer","🏦 Dados Bancários"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setPayType(v)}
                    style={{ flex:1, background:payType===v?C.abg:C.deep, color:payType===v?C.atxt:C.tm, border:payType===v?`1px solid ${C.atxt}44`:`1px solid ${C.b2}`, borderRadius:9, padding:"9px", fontSize:13, cursor:"pointer", fontWeight:payType===v?700:400 }}>
                    {l}
                  </button>
                ))}
              </div>

              {payType==="pix" ? (
                <div style={{ marginBottom:14 }}>
                  <label style={labelStyle}>Chave PIX *</label>
                  <input
                    value={form.pix}
                    onChange={e=>{ const v=e.target.value; setForm(p=>({...p,pix:v})); }}
                    placeholder="CPF (com ou sem pontos), telefone, e-mail ou UUID"
                    autoComplete="off"
                    style={inputStyle}/>
                  {/* Preview ao vivo da chave normalizada */}
                  {form.pix && (() => {
                    const v=(form.pix||"").trim();
                    let norm=v, tipo="";
                    const digitos=v.replace(/\D/g,"");
                    if(/^\d{3}[.-]\d{3}[.-]\d{3}-\d{2}$/.test(v)||(/^\d{11}$/.test(digitos)&&/^[\d.-]+$/.test(v))){ norm=digitos; tipo="CPF"; }
                    else if(/^[(+\d][\d\s()-]+$/.test(v)&&digitos.length>=10){ norm=digitos.startsWith("55")?`+${digitos}`:`+55${digitos}`; tipo="Telefone"; }
                    else if(v.includes("@")){ tipo="E-mail"; }
                    else if(/^[0-9a-f-]{36}$/i.test(v)){ tipo="Chave aleatória"; }
                    return (
                      <div style={{ marginTop:6,background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.2)",borderRadius:8,padding:"6px 10px",display:"flex",gap:8,alignItems:"center" }}>
                        <span style={{ color:"#34D399",fontSize:10.5,fontWeight:700 }}>{tipo||"Chave"}:</span>
                        <span style={{ color:C.tp,fontSize:11,fontFamily:"monospace" }}>{norm}</span>
                        {norm!==v&&<span style={{ color:C.td,fontSize:10 }}>← será enviada assim</span>}
                      </div>
                    );
                  })()}
                  <div style={{ color:C.td, fontSize:10, marginTop:4 }}>Aceita CPF com ou sem formatação · Telefone em qualquer formato · E-mail · UUID</div>

                  {/* Sugestão de PIX do V8 */}
                  {(v8c?.payment?.data?.pix||v8c?.payment?.data?.pixKey) && !form.pix && (
                    <div style={{ marginTop:10, background:"rgba(79,142,247,0.08)", border:"1px solid rgba(79,142,247,0.25)", borderRadius:10, padding:"10px 14px" }}>
                      <div style={{ color:C.atxt, fontSize:11, fontWeight:700, marginBottom:6 }}>🔑 Chave PIX cadastrada no V8:</div>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                        <span style={{ color:C.tp, fontSize:12.5, fontFamily:"monospace" }}>{v8c.payment.data.pix||v8c.payment.data.pixKey}</span>
                        <button onClick={()=>setForm(p=>({...p,pix:v8c.payment.data.pix||v8c.payment.data.pixKey}))}
                          style={{ background:C.acc, color:"#fff", border:"none", borderRadius:7, padding:"5px 14px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                          ✓ Usar esta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>

                  {/* Sugestão de banco do V8 */}
                  {v8c?.payment?.data?.bankId && !form.bankId && (
                    <div style={{ background:"rgba(79,142,247,0.08)", border:"1px solid rgba(79,142,247,0.25)", borderRadius:10, padding:"12px 14px" }}>
                      <div style={{ color:C.atxt, fontSize:11, fontWeight:700, marginBottom:8 }}>🏦 Dados bancários cadastrados no V8:</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:8 }}>
                        {[
                          ["Banco", banks.find(b=>b.id===v8c.payment.data.bankId)?.name || v8c.payment.data.bankId],
                          ["Agência", v8c.payment.data.bankAccountBranch || "—"],
                          ["Conta", `${v8c.payment.data.bankAccountNumber||"—"}-${v8c.payment.data.bankAccountDigit||""}`],
                          ["Tipo", v8c.payment.data.bankAccountType==="saving_account"?"Poupança":"Corrente"],
                        ].map(([l,val])=>(
                          <div key={l} style={{ background:"rgba(255,255,255,0.05)", borderRadius:7, padding:"5px 8px" }}>
                            <div style={{ color:C.td, fontSize:10 }}>{l}</div>
                            <div style={{ color:C.tp, fontSize:12, fontWeight:600 }}>{val}</div>
                          </div>
                        ))}
                      </div>
                      <button onClick={()=>setForm(p=>({
                        ...p,
                        bankId:            v8c.payment.data.bankId,
                        bankAccountNumber: v8c.payment.data.bankAccountNumber||"",
                        bankAccountBranch: v8c.payment.data.bankAccountBranch||"",
                        bankAccountDigit:  v8c.payment.data.bankAccountDigit||"",
                        bankAccountType:   v8c.payment.data.bankAccountType||"checking_account",
                      }))}
                        style={{ background:C.acc, color:"#fff", border:"none", borderRadius:7, padding:"6px 16px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                        ✓ Usar estes dados
                      </button>
                    </div>
                  )}

                  {/* Banco com pesquisa */}
                  <div>
                    <label style={labelStyle}>Banco *</label>
                    <input
                      value={bankSearch}
                      onChange={e=>setBankSearch(e.target.value)}
                      placeholder="🔍 Digite nome ou número do banco..."
                      autoComplete="off"
                      style={{ ...inputStyle, marginBottom:4 }}/>
                    <select value={form.bankId}
                      onChange={e=>{ const v=e.target.value; setForm(p=>({...p,bankId:v})); setBankSearch(""); }}
                      size={Math.min(6, banks.filter(b=>!bankSearch||b.name.toLowerCase().includes(bankSearch.toLowerCase())||b.code?.includes(bankSearch)).length+1)}
                      style={{ ...inputStyle, cursor:"pointer", height:"auto", overflowY:"auto" }}>
                      <option value="">Selecione o banco...</option>
                      {banks
                        .filter(b=>!bankSearch||b.name.toLowerCase().includes(bankSearch.toLowerCase())||String(b.code||"").includes(bankSearch))
                        .map(b=><option key={b.id} value={b.id}>{b.code ? `${b.code} — ` : ""}{b.name}{b.isTurbo?" ⚡":""}</option>)}
                    </select>
                    {form.bankId && (
                      <div style={{ color:C.atxt, fontSize:11, marginTop:3 }}>
                        ✓ {banks.find(b=>b.id===form.bankId)?.name || form.bankId}
                      </div>
                    )}
                  </div>

                  {/* Agência / Conta / Dígito — inputs separados sem fieldGroup */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 80px", gap:8 }}>
                    <div>
                      <label style={labelStyle}>Agência *</label>
                      <input
                        value={form.bankAccountBranch}
                        onChange={e=>{ const v=e.target.value; setForm(p=>({...p,bankAccountBranch:v})); }}
                        placeholder="0001"
                        autoComplete="off"
                        style={inputStyle}/>
                    </div>
                    <div>
                      <label style={labelStyle}>Conta *</label>
                      <input
                        value={form.bankAccountNumber}
                        onChange={e=>{ const v=e.target.value; setForm(p=>({...p,bankAccountNumber:v})); }}
                        placeholder="123456"
                        autoComplete="off"
                        style={inputStyle}/>
                    </div>
                    <div>
                      <label style={labelStyle}>Dígito</label>
                      <input
                        value={form.bankAccountDigit}
                        onChange={e=>{ const v=e.target.value; setForm(p=>({...p,bankAccountDigit:v})); }}
                        placeholder="2"
                        autoComplete="off"
                        maxLength={2}
                        style={inputStyle}/>
                    </div>
                  </div>

                  {/* Tipo de conta */}
                  <div>
                    <label style={labelStyle}>Tipo de Conta *</label>
                    <div style={{ display:"flex", gap:8 }}>
                      {[["checking_account","Corrente"],["saving_account","Poupança"]].map(([v,l])=>(
                        <button key={v} onClick={()=>setForm(p=>({...p,bankAccountType:v}))}
                          style={{ flex:1, background:form.bankAccountType===v?C.abg:C.deep, color:form.bankAccountType===v?C.atxt:C.tm, border:form.bankAccountType===v?`1px solid ${C.atxt}44`:`1px solid ${C.b2}`, borderRadius:8, padding:"8px", fontSize:12.5, cursor:"pointer", fontWeight:form.bankAccountType===v?700:400 }}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {err && <div style={{ color:"#F87171", background:"rgba(239,68,68,0.08)", border:"1px solid #EF444433", borderRadius:8, padding:"9px 12px", marginBottom:12, fontSize:12 }}>{err}</div>}

              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>setStep("review")}
                  style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:10, padding:"12px 18px", fontSize:13, cursor:"pointer" }}>
                  ← Voltar
                </button>
                <button onClick={digitar}
                  disabled={loading||(payType==="pix"&&!form.pix)||(payType==="transfer"&&!form.bankId)}
                  style={{ flex:1, background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:10, padding:"12px", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", opacity:loading||(payType==="pix"&&!form.pix)||(payType==="transfer"&&!form.bankId)?0.6:1 }}>
                  {loading?"⏳ Enviando...":"📤 Criar Proposta"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Diagnóstico de erros V8 ─────────────────────────────────
function diagnosticarErroV8(rawMsg, cpf) {
  const msg = (rawMsg||"").toLowerCase();

  if (msg.includes("autorização") || msg.includes("autorizacao") || msg.includes("fiduciária") || msg.includes("fiduciaria") || msg.includes("não possui autorização") || msg.includes("institution isn")) {
    return {
      titulo: "❌ Cliente sem adesão ao Saque Aniversário",
      descricao: "Este CPF não possui autorização para Saque Aniversário junto à Caixa Econômica Federal.",
      solucao: "O cliente precisa aderir ao Saque Aniversário no app FGTS ou nas agências da Caixa antes de prosseguir.",
      tipo: "sem_adesao",
      cor: "#F87171",
      bg: "rgba(239,68,68,0.08)",
    };
  }
  if (msg.includes("aniversário") || msg.includes("aniversario") || msg.includes("próximo mês") || msg.includes("proximo mes") || msg.includes("dia ")) {
    const data = rawMsg.match(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/)?.[0] || "";
    return {
      titulo: "📅 Simulação indisponível no momento",
      descricao: `Este cliente é aniversariante do mês. A simulação só estará disponível${data ? ` a partir de ${data}` : " no próximo período"}.`,
      solucao: "Aguarde o período correto e tente novamente.",
      tipo: "aniversariante",
      cor: "#FBBF24",
      bg: "rgba(251,191,36,0.08)",
    };
  }
  if (msg.includes("saldo insuficiente") || msg.includes("saldo zero") || msg.includes("sem saldo") || msg.includes("saldo indisponível")) {
    return {
      titulo: "💰 Saldo FGTS insuficiente ou indisponível",
      descricao: "O cliente não possui saldo disponível para antecipação do Saque Aniversário no momento.",
      solucao: "Verifique se o cliente tem saldo no FGTS e se está modalidade Saque Aniversário.",
      tipo: "sem_saldo",
      cor: "#F87171",
      bg: "rgba(239,68,68,0.08)",
    };
  }
  if (msg.includes("cpf") && (msg.includes("inválido") || msg.includes("invalido") || msg.includes("não encontrado") || msg.includes("nao encontrado"))) {
    return {
      titulo: "⚠ CPF não encontrado ou inválido",
      descricao: `O CPF ${cpf ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : ""} não foi localizado na base de dados da V8 / Caixa.`,
      solucao: "Verifique se o CPF está correto e se o cliente tem conta no FGTS.",
      tipo: "cpf_invalido",
      cor: "#F87171",
      bg: "rgba(239,68,68,0.08)",
    };
  }
  if (msg.includes("timeout") || msg.includes("45s") || msg === "timeout") {
    return {
      titulo: "⏳ Tempo limite excedido",
      descricao: "A consulta não retornou em 45 segundos. Isso pode ser instabilidade temporária na API.",
      solucao: "Tente novamente em alguns segundos. Se persistir, verifique se o CPF tem conta ativa no FGTS.",
      tipo: "timeout",
      cor: "#FBBF24",
      bg: "rgba(251,191,36,0.08)",
    };
  }
  if (msg.includes("token") || msg.includes("autent") || msg.includes("unauthorized") || msg.includes("401")) {
    return {
      titulo: "🔑 Sessão expirada",
      descricao: "O token de acesso V8 expirou.",
      solucao: "Clique em 'Desconectar' e faça login novamente.",
      tipo: "auth",
      cor: "#F87171",
      bg: "rgba(239,68,68,0.08)",
    };
  }
  // Genérico — mostra a mensagem original da V8
  return {
    titulo: rawMsg && !rawMsg.includes("https://") ? `❌ ${rawMsg}` : "❌ Erro na consulta V8",
    descricao: rawMsg && rawMsg.includes("https://")
      ? "A API V8 retornou um erro mas a mensagem específica não foi capturada. Verifique os logs do Vercel para o detalhe completo."
      : (rawMsg || "Erro desconhecido retornado pela API V8."),
    solucao: "Verifique os dados e tente novamente. Se persistir, entre em contato com o suporte.",
    tipo: "generico",
    cor: "#F87171",
    bg: "rgba(239,68,68,0.08)",
  };
}

function V8DigitalTab({ currentUser, contacts }) {
  const PROXY = "/api/v8proxy";
  const fmtBRL = v => { const n = parseFloat(v); return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" }); };
  const fmtPct = v => { const n = parseFloat(v); return isNaN(n) ? "—" : (n * 100).toFixed(2) + "%"; };
  const padCPF = raw => raw.replace(/\D/g,"").padStart(11,"0");
  const fmtCPF = v => { const c = padCPF(v); return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"); };
  const calcAnos = (sim) => {
    const periods = sim?.periods || sim?.installments || sim?.desiredInstallments || [];
    if (!periods.length) return sim?.totalInstallments ? `${sim.totalInstallments} parcelas` : "—";
    const dates = periods.map(p => new Date(p.dueDate||p.date)).filter(d => !isNaN(d));
    if (!dates.length) return "—";
    const minD = new Date(Math.min(...dates)); const maxD = new Date(Math.max(...dates));
    const anos = Math.round((maxD - minD) / (1000*60*60*24*365)) + 1;
    return `${anos} ano${anos!==1?"s":""}`;
  };

  // ── Sessão persistente ───────────────────────────────────────
  const [token,    setToken]    = useState(() => { try { return JSON.parse(localStorage.getItem("nexp_v8_session")||"null")?.token||null; } catch { return null; } });
  const [tokenExp, setTokenExp] = useState(() => { try { return JSON.parse(localStorage.getItem("nexp_v8_session")||"null")?.exp||null; } catch { return null; } });
  const [savedUser, setSavedUser] = useState(() => localStorage.getItem("nexp_v8_user") || "");
  const [credForm, setCredForm] = useState({ username: savedUser, password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authErr, setAuthErr] = useState("");
  const [aba, setAba] = useState(() => token && tokenExp && Date.now() < tokenExp ? "individual" : "config");

  const isTokenValid = token && tokenExp && Date.now() < tokenExp;

  const saveSession = (tk, exp) => { setToken(tk); setTokenExp(exp); localStorage.setItem("nexp_v8_session", JSON.stringify({ token:tk, exp })); };
  const clearSession = () => { setToken(null); setTokenExp(null); localStorage.removeItem("nexp_v8_session"); setAba("config"); };

  const autenticar = async () => {
    if (!credForm.username || !credForm.password) { setAuthErr("Preencha e-mail e senha."); return; }
    setAuthLoading(true); setAuthErr("");
    try {
      localStorage.setItem("nexp_v8_user", credForm.username); setSavedUser(credForm.username);
      const res = await fetch(PROXY, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"auth", payload:{ username:credForm.username, password:credForm.password } }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.message || data.error || `Erro ${res.status}`);
      const exp = Date.now() + ((data.expires_in || 86400) - 60) * 1000;
      saveSession(data.access_token, exp);
      setAba("individual");
    } catch(e) { setAuthErr(e.message); }
    setAuthLoading(false);
  };

  // ── apiFetch — rotas corretas conforme documentação V8 ───────
  const apiFetch = async (path, method="GET", body=null, retries=2) => {
    if (!isTokenValid) throw new Error("Sessão expirada. Faça login novamente.");
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(PROXY, { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ action:"bff", payload:{ path, method, token, body } }) });

        // Trata resposta — pode ser JSON ou HTML de erro do Vercel
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch { throw new Error(`Servidor indisponível (${res.status}). Tente novamente.`); }

        if (!res.ok) {
          const msg = data.message
            || data.error_description
            || data.error
            || (Array.isArray(data.errors) ? data.errors.map(e=>e.message||e).join("; ") : null)
            || data.detail
            || data.details
            || (typeof data === "string" ? data : null)
            || `Erro ${res.status}`;
          throw new Error(msg);
        }
        return data;
      } catch(e) {
        if (attempt === retries) throw e;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  };

  // ── Estados da aba Individual — elevados para evitar re-mount ──
  const [indCpf,       setIndCpf]       = useState(() => localStorage.getItem("nexp_v8_ind_cpf") || sessionStorage.getItem("nexp_v8_simular_cpf") || "");
  const [indProvider,  setIndProvider]  = useState(() => localStorage.getItem("nexp_v8_ind_provider") || "cartos");
  const [indLoading,   setIndLoading]   = useState(false);
  const [indErr,       setIndErr]       = useState("");
  const [indFutureDate,setIndFutureDate]= useState(null);
  const [indBalance,   setIndBalance]   = useState(() => { try { return JSON.parse(localStorage.getItem("nexp_v8_ind_balance")||"null"); } catch { return null; } });
  const [indTableSims, setIndTableSims] = useState(() => { try { return JSON.parse(localStorage.getItem("nexp_v8_ind_sims")||"[]"); } catch { return []; } });
  const [indOperacoes, setIndOperacoes] = useState(() => { try { return JSON.parse(localStorage.getItem("nexp_v8_ind_ops")||"null"); } catch { return null; } });
  const [indCpfSim,    setIndCpfSim]   = useState(() => localStorage.getItem("nexp_v8_ind_cpfsim") || "");
  const [indLogs,      setIndLogs]      = useState(() => { try { return JSON.parse(localStorage.getItem("nexp_v8_ind_logs")||"[]"); } catch { return []; } });
  const [indFees,      setIndFees]      = useState([]);
  const [indSimStep,   setIndSimStep]   = useState("idle");
  const [indDigModal,  setIndDigModal]  = useState(null);
  const [indDigLoading, setIndDigLoading] = useState(false);
  // ── Estados internos do ModalDigitacaoRapida — elevados para evitar remount ──
  const [modalStep,       setModalStep]       = useState("review");
  const [modalBanks,      setModalBanks]      = useState([]);
  const [modalPayType,    setModalPayType]    = useState("pix");
  const [modalLoading,    setModalLoading]    = useState(false);
  const [modalResult,     setModalResult]     = useState(null);
  const [modalErr,        setModalErr]        = useState("");
  const [modalCepLoading, setModalCepLoading] = useState(false);
  const [modalBankSearch, setModalBankSearch] = useState("");
  const [modalForm,       setModalForm]       = useState({});

  // Helper: abre modal e inicializa form com dados do cliente
  const openDigModal = (modalData) => {
    if (!modalData) { setIndDigModal(null); setLoteDigModal(null); return; }
    const pre = modalData.clientePreFill || {};
    const v8c = pre.clienteV8 || {};
    const contacts_ = contacts || [];
    const cpfClean = (modalData.cpf||"").replace(/\D/g,"");
    const nexp = contacts_.find(c=>(c.cpf||"").replace(/\D/g,"")=== cpfClean) || {};
    const pk = (...vals) => vals.find(v=>v&&String(v).trim()) || "";
    setModalForm({
      name:             pk(pre.nome,v8c.name,v8c.clientName,nexp.name),
      cpf:              modalData.cpf||"",
      rg:               pk(v8c.documentIdentificationNumber,nexp.rg),
      motherName:       pk(pre.nomeMae,v8c.motherName,nexp.nomeMae),
      birthDate:        pk(pre.nascimento,v8c.birthDate,nexp.dataNascimento),
      email:            pk(pre.email,v8c.email,nexp.email,nexp.email2),
      phone:            pk(pre.phone?`${pre.phoneDdd||""}${pre.phone}`:null,v8c.phone?(v8c.phoneRegionCode||"")+v8c.phone:null,(nexp.phone||"").replace(/\D/g,"")),
      phoneRegionCode:  pk(pre.phoneDdd,v8c.phoneRegionCode,(nexp.phone||"").replace(/\D/g,"").slice(0,2)),
      nationality:      pk(pre.nacionalidade,v8c.nationality,"Brasileiro(a)"),
      maritalStatus:    pk(pre.estadoCivil,v8c.maritalStatus,"single"),
      isPEP:            pre.isPEP||v8c.isPEP||false,
      postalCode:       pk(pre.cep,v8c.postalCode,(nexp.cep||"").replace(/\D/g,"")),
      street:           pk(pre.rua,v8c.street,nexp.rua),
      addressNumber:    pk(pre.numero,v8c.addressNumber,nexp.numero),
      complement:       pk(pre.complemento,v8c.complement,nexp.complemento),
      neighborhood:     pk(pre.bairro,v8c.neighborhood,nexp.bairro),
      city:             pk(pre.cidade,v8c.city,nexp.cidade),
      state:            pk(pre.uf,v8c.state,nexp.ufEnd,nexp.estado),
      pix:              "",
      bankId:           "",
      bankAccountNumber:"",
      bankAccountBranch:"",
      bankAccountDigit: "",
      bankAccountType:  "checking_account",
    });
    setModalStep("review");
    setModalPayType("pix");
    setModalResult(null);
    setModalErr("");
    setModalBankSearch("");
  };
  const [indSelectedSim, setIndSelectedSim] = useState(null);
  const [indContratosOpen, setIndContratosOpen] = useState(false);
  const [indErrDetail, setIndErrDetail] = useState(null);
  const [indHistorico, setIndHistorico] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexp_v8_ind_historico")||"[]"); } catch { return []; }
  });
  const [indHistPage,    setIndHistPage]    = useState(0);
  const [indHistDetalhe, setIndHistDetalhe] = useState(null);
  const [indHistSearch,  setIndHistSearch]  = useState("");

  // ── Estados LoteTab — elevados para evitar re-mount e perda de estado ──
  const lSaved = (() => { try { return JSON.parse(localStorage.getItem("nexp_v8_lote_state")||"null"); } catch { return null; } })();
  const [loteItems,        setLoteItems]        = useState(()=> lSaved?.items || []);
  const [loteRunning,      setLoteRunning]       = useState(false);
  const [lotePaused,       setLotePaused]        = useState(false);
  const [loteProgress,     setLoteProgress]      = useState(lSaved?.progress||0);
  const [loteFilterSaldo,  setLoteFilterSaldo]   = useState("");
  const [loteFilterMargem, setLoteFilterMargem]  = useState("");
  const [loteFilterStatus, setLoteFilterStatus]  = useState("Todos");
  const [loteLogs,         setLoteLogs]          = useState([]);
  const [lotePage,         setLotePage]          = useState(0);
  const [loteCpfBox,       setLoteCpfBox]        = useState(() => localStorage.getItem("nexp_v8_lote_cpfbox")||"");
  const [loteShowCpfBox,   setLoteShowCpfBox]    = useState(false);
  const [loteProvider,     setLoteProvider]      = useState(() => localStorage.getItem("nexp_v8_lote_provider")||"cartos");
  const [loteFees,         setLoteFees]          = useState([]);
  const [loteDigModal,     setLoteDigModal]      = useState(null);
  const [loteDetalhe,      setLoteDetalhe]       = useState(null);
  const [loteSearch,       setLoteSearch]        = useState("");
  const loteAbortRef = useRef(false);
  const lotePauseRef = useRef(false);

  // ── Estados OperacoesTab elevados ──
  const [opsSearch,   setOpsSearch]   = useState("");
  const [opsStatus,   setOpsStatus]   = useState("");
  const [opsProvider, setOpsProvider] = useState("");
  const [opsPage,     setOpsPage]     = useState(1);
  const [opsData,     setOpsData]     = useState(null);
  const [opsLoading,  setOpsLoading]  = useState(false);
  const [opsErr,      setOpsErr]      = useState("");
  const [opsCancelId, setOpsCancelId] = useState(null);
  const [opsCancelReason, setOpsCancelReason] = useState("invalid_data:other");
  const [opsCancelDesc,   setOpsCancelDesc]   = useState("");
  const [opsCancelLoading,setOpsCancelLoading]= useState(false);
  const [opsDetalhe,  setOpsDetalhe]  = useState(null); // contrato selecionado
  const [opsSimModal, setOpsSimModal] = useState(null); // simulação popup

  // ── Estados AcompanhamentoTab ──
  const [acompSearch,      setAcompSearch]      = useState("");
  const [acompStatus,      setAcompStatus]      = useState("");
  const [acompProvider,    setAcompProvider]    = useState("");
  // acompPage removed — paginação direto na API
  const [acompData,        setAcompData]        = useState(null);
  const [acompLoading,     setAcompLoading]     = useState(false);
  const [acompErr,         setAcompErr]         = useState("");
  const [acompDetalhe,     setAcompDetalhe]     = useState(null);
  const [acompLinkModal,   setAcompLinkModal]   = useState(null);
  const [acompLinkLoading, setAcompLinkLoading] = useState(false);
  const [acompCopied,      setAcompCopied]      = useState(null);
  const [acompDateFrom,    setAcompDateFrom]    = useState("");
  const [acompDateTo,      setAcompDateTo]      = useState("");
  const [acompSimModal,    setAcompSimModal]    = useState(null);

  // ── Fila de Formalização (contratos digitados aguardando processamento) ──
  const [filaFormalizacao, setFilaFormalizacao] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexp_fila_formalizacao")||"[]"); } catch { return []; }
  });
  const salvarFilaLocal = (fila) => {
    setFilaFormalizacao(fila);
    localStorage.setItem("nexp_fila_formalizacao", JSON.stringify(fila));
  };
  const adicionarNaFila = (res, dadosDigitacao) => {
    const novo = {
      id:               res?.id || String(Date.now()),
      v8ProposalId:     res?.id || "",
      contractNumber:   res?.contractNumber || "",
      formalizationLink:res?.formalizationLink || "",
      clientName:       dadosDigitacao?.nome || dadosDigitacao?.name || "",
      cpf:              (dadosDigitacao?.cpf||dadosDigitacao?.documentNumber||"").replace(/\D/g,""),
      valor:            parseFloat(dadosDigitacao?.valorLiberado || dadosDigitacao?.availableBalance || 0),
      provider:         dadosDigitacao?.provider || "",
      status:           "formalization",
      criadoEm:         Date.now(),
      criadoEmStr:      new Date().toLocaleDateString("pt-BR"),
    };
    const atualizada = [novo, ...filaFormalizacao.filter(f => f.id !== novo.id)];
    salvarFilaLocal(atualizada);
    return novo;
  };

  // ════════════════════════════════════════════════════════════
  // ABA: SIMULAÇÃO INDIVIDUAL
  // ════════════════════════════════════════════════════════════
  const IndividualTab = () => {
    const cpf         = indCpf;
    const setCpf      = (v) => { setIndCpf(v); localStorage.setItem("nexp_v8_ind_cpf", v); };
    const provider    = indProvider;
    const setProvider = (v) => { setIndProvider(v); localStorage.setItem("nexp_v8_ind_provider", v); };
    const loading     = indLoading;    const setLoading     = setIndLoading;
    const err         = indErr;        const setErr         = setIndErr;
    const futureDate  = indFutureDate; const setFutureDate  = setIndFutureDate;
    const balance     = indBalance;    const setBalance     = setIndBalance;
    const tableSims   = indTableSims;  const setTableSims   = setIndTableSims;
    const operacoes   = indOperacoes;  const setOperacoes   = setIndOperacoes;
    const cpfSim      = indCpfSim;
    const setCpfSim   = (v) => { setIndCpfSim(v); localStorage.setItem("nexp_v8_ind_cpfsim", v); };
    const logs        = indLogs;       const setLogs        = setIndLogs;
    const fees        = indFees;       const setFees        = setIndFees;
    const simStep     = indSimStep;    const setSimStep     = setIndSimStep;
    const selectedSim = indSelectedSim; const setSelectedSim = setIndSelectedSim;
    const contratosOpen = indContratosOpen; const setContratosOpen = setIndContratosOpen;
    const digLoading = indDigLoading; const setDigLoading = setIndDigLoading;
    const errDetail = indErrDetail;
    const historico     = indHistorico;
    const histPage      = indHistPage;
    const histDetalhe   = indHistDetalhe;
    const histSearch    = indHistSearch;

    const addLog = (msg, ok=true) => setLogs(p => {
      const u=[{ts:new Date().toLocaleTimeString("pt-BR"),msg,ok},...p.slice(0,99)];
      localStorage.setItem("nexp_v8_ind_logs",JSON.stringify(u));
      return u;
    });

    const parseFutureDate = (msg) => {
      if (!msg) return null;
      const m = msg.match(/(\d{1,2})[/-](\d{1,2})/);
      if (m) return `${m[1]}/${m[2]}`;
      const m2 = msg.match(/dia\s+(\d+)/i);
      if (m2) { const d = new Date(); d.setMonth(d.getMonth()+1); d.setDate(parseInt(m2[1])); return d.toLocaleDateString("pt-BR"); }
      return null;
    };

    // Calcula quantidade de anos com base nos periods
    const buscarSaldo = async () => {
      const c = padCPF(cpf);
      if (c.replace(/^0+/,"").length === 0) { setErr("Digite um CPF válido."); return; }
      setLoading(true); setErr(""); setFutureDate(null);
      setBalance(null); setTableSims([]); setOperacoes(null);
      setCpfSim(fmtCPF(c)); setSimStep("saldo");
      setIndErrDetail(null); setIndHistPage(0);
      addLog(`▶ Consultando saldo — CPF ${fmtCPF(c)} (${provider.toUpperCase()})`);
      try {
        addLog("📡 Iniciando consulta de saldo (assíncrona)...");
        await apiFetch("/fgts/balance","POST",{ documentNumber:c, provider });
        addLog("✅ Consulta disparada. Aguardando processamento...");

        // Polling — GET /fgts/balance?search=CPF
        let bal = null;
        const maxTentativas = 18;
        for (let i = 0; i < maxTentativas; i++) {
          await new Promise(r => setTimeout(r, 2500));
          addLog(`🔄 Verificando resultado (${i+1}/${maxTentativas})...`);
          try {
            const res = await apiFetch(`/fgts/balance?search=${c}`);
            addLog(`📦 GET balance: ${JSON.stringify(res).slice(0,150)}`);

            const registros = res?.data || (Array.isArray(res) ? res : [res]).filter(Boolean);
            const sucesso   = registros.find(r => r && (r.status === "success" || r.amount != null) && parseFloat(r.amount||0) > 0);
            const qualquer  = registros.find(r => r && r.status === "success");
            const encontrado = sucesso || qualquer;

            if (encontrado) {
              bal = encontrado;
              addLog(`✅ Saldo: ${fmtBRL(parseFloat(bal.amount||0))} | ID: ${bal.id||"—"}`);
              setBalance(bal);
              localStorage.setItem("nexp_v8_ind_balance", JSON.stringify(bal));
              break;
            }

            // Falha — traduz mensagem da V8 para linguagem clara
            const falha = registros.find(r => r && (r.status === "fail" || r.status === "error" || r.status === "failed"));
            if (falha) {
              const rawMsg = falha.statusInfo || falha.errorMessage || falha.message || "";
              const errDiag = diagnosticarErroV8(rawMsg, c);
              addLog(`❌ ${rawMsg}`, false);
              const fd = parseFutureDate(rawMsg);
              if (fd) setFutureDate(fd);
              setIndErrDetail(errDiag);
              setErr(errDiag.titulo);
              salvarErroHistorico(c, errDiag.titulo);
              setSimStep("done"); setLoading(false);
              return;
            }

            addLog(`⏳ Processando... (${registros.length} registro(s))`);
          } catch(e) {
            addLog(`⚠ Tentativa ${i+1}: ${e.message}`, false);
          }
        }

        if (!bal) {
          try {
            const cached = JSON.parse(localStorage.getItem("nexp_v8_ind_balance")||"null");
            if (cached && padCPF(cached.documentNumber||"") === c) {
              bal = cached; addLog("⚠ Usando cache do saldo anterior.", false); setBalance(bal);
            }
          } catch {}
        }

        if (!bal) {
          const errDiag = diagnosticarErroV8("timeout", c);
          setIndErrDetail(errDiag);
          setErr(errDiag.titulo);
          salvarErroHistorico(c, errDiag.titulo);
          addLog("❌ Timeout: sem resposta em 45s.", false);
          setSimStep("done"); setLoading(false);
          return;
        }

        setBalance(bal);
        await simularTodasTabelas(c, bal);
      } catch(e) {
        addLog(`❌ Erro: ${e.message}`, false);
        const fd = parseFutureDate(e.message);
        if (fd) setFutureDate(fd);
        const errDiag = diagnosticarErroV8(e.message, c);
        setIndErrDetail(errDiag);
        setErr(errDiag.titulo);
        salvarErroHistorico(c, errDiag.titulo);
      }
      setSimStep("done"); setLoading(false);
    };

    const salvarErroHistorico = (c, errMsg) => {
      const entrada = { id:Date.now(), cpf:fmtCPF(c), cpfRaw:c, provider, saldo:0, melhorTabela:"—", melhorValor:0, ts:new Date().toLocaleString("pt-BR"), ok:false, erro:errMsg };
      setIndHistorico(prev => {
        const updated = [entrada, ...prev.filter(h=>h.cpfRaw!==c)].slice(0,200);
        localStorage.setItem("nexp_v8_ind_historico", JSON.stringify(updated));
        return updated;
      });
    };

    const simularTodasTabelas = async (c, bal) => {
      setSimStep("fees");
      addLog("📡 Buscando tabelas de taxas...");
      let feesList = fees;
      if (!feesList.length) {
        
        try {
          const feesData = await apiFetch("/fgts/simulations/fees","GET");
          feesList = Array.isArray(feesData) ? feesData.filter(f=>f.active) : [];
          setFees(feesList);
          addLog(`✅ ${feesList.length} tabelas: ${feesList.map(f=>f.simulation_fees?.label).join(", ")}`);
        } catch(e) { addLog(`⚠ Tabelas: ${e.message}`, false); }
        
      }

      if (!feesList.length || !bal) return;

      // GET balance retorna: { id, amount, periods:[{amount,dueDate}], status, provider }
      const saldoVal = parseFloat(bal?.amount || bal?.balance || bal?.availableBalance || 100);
      const installments = bal?.periods || bal?.installments || [];

      // Monta desiredInstallments a partir dos periods do saldo
      const desiredInstallments = installments.length
        ? installments.map(p=>({ totalAmount: parseFloat(p.amount||p.totalAmount||saldoVal), dueDate: p.dueDate||p.date }))
        : [
            { totalAmount: saldoVal, dueDate: new Date(new Date().getFullYear()+1,1,1).toISOString().split("T")[0] },
            { totalAmount: saldoVal, dueDate: new Date(new Date().getFullYear()+2,1,1).toISOString().split("T")[0] },
          ];

      setSimStep("simulando");
      addLog(`📡 Simulando em ${feesList.length} tabelas...`);

      // Simula TODAS as tabelas em paralelo
      const resultados = await Promise.all(feesList.map(async fee => {
        const feeId = fee.simulation_fees?.id_simulation_fees;
        const label = (fee.simulation_fees?.label || feeId || "").toLowerCase().trim();
        try {
          const simBody = { simulationFeesId:feeId, balanceId:bal?.id, targetAmount:0, documentNumber:c, desiredInstallments, provider };
          const sim = await apiFetch("/fgts/simulations","POST",simBody);
          const vlr = parseFloat(sim?.availableBalance||sim?.availableAmount||0);
          addLog(`✅ ${label}: ${fmtBRL(vlr)} | emissão: ${fmtBRL(sim?.emissionAmount)} | ${calcAnos(sim)}`);
          return { label, feeId, sim, ok:true };
        } catch(e) {
          addLog(`❌ ${label}: ${e.message}`, false);
          return { label, feeId, err:e.message, ok:false };
        }
      }));

      setTableSims(resultados);
      localStorage.setItem("nexp_v8_ind_sims", JSON.stringify(resultados));

      // Persiste
      const res = { balance:bal, tableSims:resultados, cpf:fmtCPF(c), cpfRaw:c, provider, ts:new Date().toLocaleString("pt-BR") };
      localStorage.setItem("nexp_v8_ind_result", JSON.stringify(res));

      // Contratos
      setSimStep("contratos");
      addLog("📡 Buscando contratos...");
      try {
        const ops = await apiFetch(`/fgts/proposal?search=${c}&page=1&limit=10`);
        const opList = ops?.data||ops;
        setOperacoes(opList);
        localStorage.setItem("nexp_v8_ind_ops", JSON.stringify(opList));
        addLog(`✅ ${Array.isArray(opList)?opList.length:0} contrato(s)`);
      } catch(e) { addLog(`⚠ Contratos: ${e.message}`, false); }

      addLog("🏁 Concluído!");

      // Salvar no histórico — com dados completos para auto-preenchimento
      const best = [...resultados].filter(t=>t.ok).sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0))[0];

      // Tentar buscar dados do cliente do contrato mais recente
      let clienteV8 = null;
      try {
        const ops = await apiFetch(`/fgts/proposal?search=${c}&page=1&limit=1`);
        const primeiro = (ops?.data||[])[0];
        if (primeiro?.id) {
          const detalhe = await apiFetch(`/fgts/proposal/${primeiro.id}`);
          clienteV8 = detalhe;
          addLog(`✅ Dados do cliente carregados: ${detalhe.name||detalhe.clientName||""}`);
        }
      } catch {}

      const entrada = {
        id:           Date.now(),
        cpf:          fmtCPF(c),
        cpfRaw:       c,
        provider,
        saldo:        parseFloat(bal?.amount||0),
        melhorTabela: best?.label||"—",
        melhorValor:  parseFloat(best?.sim?.availableBalance||0),
        melhorSimId:  best?.sim?.id||"",
        melhorFeeId:  best?.feeId||"",
        balanceId:    bal?.id||"",
        anos:         calcAnos(best?.sim),
        ts:           new Date().toLocaleString("pt-BR"),
        ok:           true,
        allSims:      resultados,
        balance:      bal,
        // Dados do cliente (do V8 se disponível)
        clienteV8,
        nome:         clienteV8?.name || clienteV8?.clientName || "",
        email:        clienteV8?.email || "",
        phone:        clienteV8?.phone || "",
        phoneDdd:     clienteV8?.phoneRegionCode || "",
        rg:           clienteV8?.documentIdentificationNumber || "",
        nomeMae:      clienteV8?.motherName || "",
        nascimento:   clienteV8?.birthDate || "",
        cep:          clienteV8?.postalCode || "",
        rua:          clienteV8?.street || "",
        numero:       clienteV8?.addressNumber || "",
        complemento:  clienteV8?.complement || "",
        bairro:       clienteV8?.neighborhood || "",
        cidade:       clienteV8?.city || "",
        uf:           clienteV8?.state || "",
        estadoCivil:  clienteV8?.maritalStatus || "single",
        nacionalidade:clienteV8?.nationality || "Brasileiro(a)",
        isPEP:        clienteV8?.isPEP || false,
      };
      setIndHistorico(prev => {
        const updated = [entrada, ...prev.filter(h=>h.cpfRaw!==c)].slice(0,200);
        localStorage.setItem("nexp_v8_ind_historico", JSON.stringify(updated));
        return updated;
      });
    };

    const limpar = () => {
      setBalance(null); setTableSims([]); setOperacoes(null);
      setCpfSim(""); setLogs([]); setErr(""); setSimStep("idle");
      setIndSelectedSim(null); setIndContratosOpen(false); setIndErrDetail(null);
      ["nexp_v8_ind_result","nexp_v8_ind_logs","nexp_v8_ind_balance",
       "nexp_v8_ind_sims","nexp_v8_ind_ops","nexp_v8_ind_cpfsim"].forEach(k=>localStorage.removeItem(k));
    };

    const saldoTotal  = parseFloat(balance?.amount || balance?.balance || balance?.availableBalance || 0);
    const bestSim     = [...tableSims].filter(t=>t.ok).sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0))[0];
    const sortedSims  = [
      ...tableSims.filter(t=>t.ok).sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0)),
      ...tableSims.filter(t=>!t.ok),
    ];
    const stepLabel   = { idle:"", saldo:"Consultando saldo...", fees:"Buscando tabelas...", simulando:"Simulando tabelas...", contratos:"Buscando contratos...", done:"Concluído ✅" };

    return (
      <div>
        {/* ── Painel de entrada ── */}
        <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:16, padding:"16px 20px", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"flex-end", gap:10, flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:180 }}>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>CPF do cliente</label>
              <input
                value={cpf}
                onChange={e=>{ const v=e.target.value; setCpf(v); }}
                onKeyDown={e=>e.key==="Enter"&&!loading&&buscarSaldo()}
                placeholder="000.000.000-00"
                autoComplete="off"
                style={{ ...S.input, fontSize:15, fontWeight:700, letterSpacing:"0.5px" }} />
            </div>
            <div>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Instituição</label>
              <div style={{ display:"flex", gap:5 }}>
                {["cartos","qi","bms"].map(p=>(
                  <button key={p} onClick={()=>setProvider(p)}
                    style={{ background:provider===p?C.abg:C.deep, color:provider===p?C.atxt:C.tm, border:provider===p?`1px solid ${C.atxt}55`:`1px solid ${C.b2}`, borderRadius:8, padding:"7px 12px", fontSize:12, fontWeight:provider===p?700:400, cursor:"pointer", textTransform:"uppercase" }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display:"flex", gap:7 }}>
              <button onClick={buscarSaldo} disabled={loading}
                style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"8px 22px", fontSize:13, fontWeight:700, cursor:loading?"not-allowed":"pointer", opacity:loading?0.6:1, whiteSpace:"nowrap" }}>
                {loading?`⏳ ${stepLabel[simStep]||"Simulando..."}`:"▶ Simular"}
              </button>
              {(balance||tableSims.length>0) && (
                <button onClick={buscarSaldo} disabled={loading} title="Recarregar"
                  style={{ background:C.abg, color:C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:9, padding:"8px 12px", fontSize:13, cursor:"pointer" }}>🔄</button>
              )}
              {(balance||tableSims.length>0||logs.length>0) && (
                <button onClick={limpar} title="Limpar sessão atual"
                  style={{ background:C.deep, color:C.td, border:`1px solid ${C.b2}`, borderRadius:9, padding:"8px 12px", fontSize:13, cursor:"pointer" }} title="Limpar cache">🗑 Cache</button>
              )}
            </div>
          </div>
          {/* Erro detalhado */}
          {err && (
            <div style={{ marginTop:12, background: errDetail?.bg || "rgba(239,68,68,0.08)", border:`1px solid ${errDetail?.cor||"#EF4444"}33`, borderRadius:12, padding:"14px 16px" }}>
              <div style={{ color: errDetail?.cor||"#F87171", fontSize:13.5, fontWeight:700, marginBottom:6 }}>
                {errDetail?.titulo || err}
              </div>
              {errDetail?.descricao && (
                <div style={{ color:"rgba(255,255,255,0.7)", fontSize:12.5, marginBottom:8, lineHeight:1.5 }}>
                  {errDetail.descricao}
                </div>
              )}
              {errDetail?.solucao && (
                <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:8, padding:"8px 12px", borderLeft:`3px solid ${errDetail.cor||"#F87171"}` }}>
                  <span style={{ color:"rgba(255,255,255,0.5)", fontSize:11 }}>💡 O que fazer: </span>
                  <span style={{ color:"rgba(255,255,255,0.75)", fontSize:11.5 }}>{errDetail.solucao}</span>
                </div>
              )}
            </div>
          )}
          {futureDate && (
            <div style={{ background:"rgba(251,191,36,0.1)", border:"1px solid #FBBF2444", borderRadius:8, padding:"10px 14px", marginTop:12 }}>
              <div style={{ color:"#FBBF24", fontSize:12.5, fontWeight:700 }}>📅 Cliente aniversariante do mês</div>
              <div style={{ color:"#FBBF24", fontSize:12, marginTop:2 }}>Simulação disponível a partir de <b>{futureDate}</b></div>
            </div>
          )}
        </div>

        {/* ── Resultado: Saldo + Tabelas ── */}
        {balance && (
          <div style={{ marginBottom:20 }}>
            {/* Header saldo — estilo bancário */}
            <div style={{ background:"linear-gradient(135deg,#0f1f3d 0%,#162a50 50%,#1a3060 100%)", borderRadius:18, padding:"24px 28px", marginBottom:16, border:"1px solid rgba(79,142,247,0.25)", boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:20 }}>
                {/* Lado esquerdo: dados do cliente */}
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:"rgba(79,142,247,0.15)", border:"1px solid rgba(79,142,247,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🏦</div>
                    <div>
                      <div style={{ color:"rgba(255,255,255,0.5)", fontSize:10, textTransform:"uppercase", letterSpacing:"1px" }}>Consulta FGTS — {provider.toUpperCase()}</div>
                      <div style={{ color:"rgba(255,255,255,0.85)", fontSize:11, marginTop:1 }}>{new Date().toLocaleString("pt-BR")}</div>
                    </div>
                  </div>
                  {[
                    ["CPF", cpfSim],
                    ["Nome completo", balance?.name || balance?.clientName || "—"],
                    ["Valor Liberado", fmtBRL(bestSim?.sim?.availableBalance || 0)],
                    ["Saldo FGTS que ficará bloqueado e usado como garantia", fmtBRL(saldoTotal)],
                  ].map(([label, value])=>(
                    <div key={label} style={{ marginBottom:10, paddingBottom:10, borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ color:"rgba(255,255,255,0.45)", fontSize:10.5, marginBottom:2 }}>{label}</div>
                      <div style={{ color:"#fff", fontSize: label==="Valor Liberado"?22:14, fontWeight: label==="Valor Liberado"?900:600, letterSpacing: label==="CPF"?"1px":"normal" }}>
                        {value}
                      </div>
                    </div>
                  ))}
                  {balance?.id && (
                    <div style={{ marginTop:4 }}>
                      <div style={{ color:"rgba(255,255,255,0.35)", fontSize:10 }}>Balance ID</div>
                      <div style={{ color:"rgba(255,255,255,0.5)", fontSize:10, fontFamily:"monospace", marginTop:1 }}>{balance.id}</div>
                    </div>
                  )}
                </div>

                {/* Lado direito: melhor oferta */}
                {bestSim && (
                  <div style={{ background:"linear-gradient(135deg,rgba(52,211,153,0.18),rgba(79,142,247,0.18))", border:"2px solid rgba(52,211,153,0.4)", borderRadius:18, padding:"28px 32px", minWidth:260, textAlign:"center", boxShadow:"0 4px 32px rgba(52,211,153,0.15)" }}>
                    <div style={{ color:"#34D399", fontSize:13, fontWeight:800, letterSpacing:"1px", marginBottom:10, textTransform:"uppercase" }}>✅ Melhor Oferta</div>
                    <div style={{ color:"#fff", fontSize:40, fontWeight:900, lineHeight:1, letterSpacing:"-1px", marginBottom:6 }}>
                      {fmtBRL(bestSim.sim?.availableBalance||0)}
                    </div>
                    <div style={{ color:"rgba(255,255,255,0.6)", fontSize:12.5, marginBottom:12 }}>
                      Valor liberado via PIX
                    </div>
                    <div style={{ color:"rgba(255,255,255,0.45)", fontSize:12, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.12)" }}>
                      {calcAnos(bestSim.sim)} de antecipação
                    </div>
                    <div id="ind_best_print" style={{ display:"none" }}>
                      <h2>✅ Melhor Oferta FGTS</h2>
                      <p>CPF: <b>{cpfSim}</b></p>
                      <p>Tabela: <b style={{ textTransform:"capitalize" }}>{bestSim.label}</b></p>
                      <p class="val">{fmtBRL(bestSim.sim?.availableBalance||0)}</p>
                      <p>Valor liberado via PIX</p>
                      <p>{calcAnos(bestSim.sim)} de antecipação · {provider?.toUpperCase()}</p>
                      <p style={{ fontSize:11, color:"#888" }}>{new Date().toLocaleString("pt-BR")}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Períodos do saldo — data atual */}
              {(balance?.periods||balance?.installments||[]).length > 0 && (
                <div style={{ marginTop:16, paddingTop:16, borderTop:"1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:10 }}>Parcelas disponíveis</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {(balance?.periods||balance?.installments||[]).map((p,i)=>{
                      const d = new Date((p.dueDate||p.date)+"T12:00:00");
                      const agora = new Date();
                      const isPast = d < agora;
                      return (
                        <div key={i} style={{ background:isPast?"rgba(239,68,68,0.1)":"rgba(79,142,247,0.12)", border:`1px solid ${isPast?"rgba(239,68,68,0.2)":"rgba(79,142,247,0.2)"}`, borderRadius:10, padding:"7px 12px", textAlign:"center" }}>
                          <div style={{ color: isPast?"#F87171":"rgba(255,255,255,0.55)", fontSize:10 }}>
                            {d.toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"})}
                          </div>
                          <div style={{ color:"#fff", fontWeight:700, fontSize:12, marginTop:2 }}>{fmtBRL(p.amount||p.totalAmount)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Tabelas — formato compacto */}
            <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, overflow:"hidden" }}>
              <div style={{ padding:"9px 14px", borderBottom:`1px solid ${C.b1}`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                <div style={{ color:C.ts, fontSize:12.5, fontWeight:700 }}>
                  📊 Simulação por Tabela
                  {loading && simStep==="simulando" && <span style={{ color:C.atxt, fontSize:10.5, marginLeft:8, fontWeight:400 }}>⏳ calculando...</span>}
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <span style={{ color:C.td, fontSize:10.5 }}>{tableSims.filter(t=>t.ok).length}/{tableSims.length} tabelas · {provider.toUpperCase()}</span>
                </div>
              </div>

              {tableSims.length === 0 && loading && (
                <div style={{ padding:"24px 18px", color:C.td, fontSize:13, textAlign:"center" }}>⏳ Simulando tabelas em paralelo...</div>
              )}
              {tableSims.length === 0 && !loading && balance && (
                <div style={{ padding:"24px 18px", color:C.td, fontSize:13, textAlign:"center" }}>Aguardando simulação...</div>
              )}

              {/* Header */}
              {tableSims.length > 0 && (
                <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr 0.8fr 0.8fr 0.8fr 0.9fr", background:C.deep, padding:"8px 14px", borderBottom:`1px solid ${C.b1}` }}>
                  {["Tabela","Saldo Liberado","Anos","CET a.m.","Emissão",""].map(h=>(
                    <div key={h} style={{ color:C.td, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.4px" }}>{h}</div>
                  ))}
                </div>
              )}

              {sortedSims.map((t, i) => {
                const vlr    = parseFloat(t.sim?.availableBalance || t.sim?.availableAmount || 0);
                const emissao = parseFloat(t.sim?.emissionAmount || t.sim?.issueAmount || 0);
                const cet    = t.sim?.cet;
                const anos   = calcAnos(t.sim);
                const isBest = bestSim?.feeId === t.feeId;
                const isSel  = selectedSim?.feeId === t.feeId;
                return (
                  <div key={i}
                    onClick={()=> t.ok && setSelectedSim(isSel ? null : t)}
                    style={{
                      display:"grid", gridTemplateColumns:"1.4fr 1fr 0.8fr 0.8fr 0.8fr 0.9fr",
                      gap:0, padding:"11px 14px",
                      background: isSel?`${C.acc}20`:isBest?`${C.acc}12`:i%2===0?C.card:C.deep,
                      borderBottom:`1px solid ${C.b1}`,
                      borderLeft: isSel?`3px solid ${C.acc}`:isBest?`3px solid ${C.acc}88`:"3px solid transparent",
                      cursor:t.ok?"pointer":"default", transition:"all 0.15s", opacity:t.ok?1:0.45,
                    }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      {isBest && <span style={{ fontSize:12 }}>🏆</span>}
                      <div>
                        <div style={{ color:isBest||isSel?C.atxt:C.tp, fontWeight:700, fontSize:12.5, textTransform:"capitalize" }}>{t.label}</div>
                        {!t.ok && <div style={{ color:"#F87171", fontSize:10 }}>{(t.err||"").slice(0,40)}</div>}
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center" }}>
                      {t.ok?<div>
                        <div style={{ color:isBest?"#34D399":C.atxt, fontWeight:800, fontSize:14 }}>{fmtBRL(vlr)}</div>
                        <div style={{ color:C.td, fontSize:10 }}>via PIX</div>
                      </div>:<span style={{ color:"#F87171", fontSize:12 }}>✘</span>}
                    </div>
                    <div style={{ display:"flex", alignItems:"center" }}>
                      {t.ok && <span style={{ color:C.tm, fontSize:12.5, fontWeight:600 }}>{anos}</span>}
                    </div>
                    <div style={{ display:"flex", alignItems:"center" }}>
                      {t.ok && cet && <span style={{ color:C.tm, fontSize:12 }}>{fmtPct(cet)}</span>}
                    </div>
                    <div style={{ display:"flex", alignItems:"center" }}>
                      {t.ok && <span style={{ color:C.ts, fontSize:12, fontWeight:600 }}>{fmtBRL(emissao)}</span>}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
                      {t.ok && (
                        <button onClick={e=>{e.stopPropagation();openDigModal({tabela:t,balance:indBalance,cpf:indCpfSim,provider:indProvider}); setIndDigModal({tabela:t,balance:indBalance,cpf:indCpfSim,provider:indProvider});}}
                          style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:7, padding:"4px 11px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                          DIGITAR
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Proposta selecionada — painel estilo Lote ── */}
        {selectedSim && (
          <div style={{ background:"linear-gradient(135deg,#0f1f3d,#162a50)", border:"1px solid rgba(79,142,247,0.3)", borderRadius:16, padding:"20px 24px", marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ color:"#fff", fontSize:13.5, fontWeight:700 }}>🔍 Detalhe — {selectedSim.label?.toUpperCase()} · <span style={{ color:"rgba(255,255,255,0.5)", fontSize:12, fontWeight:400 }}>{cpfSim}</span></div>
              <div style={{ display:"flex", gap:8 }}>
                <button
                  onClick={()=>{
                    // Print apenas esse painel
                    const el = document.getElementById("ind_sim_print");
                    if(!el) return;
                    const w = window.open("","_blank","width=700,height=600");
                    w.document.write(`<html><head><title>Simulação FGTS</title><style>body{font-family:sans-serif;background:#fff;color:#000;padding:24px}table{border-collapse:collapse;width:100%}td{padding:8px 12px;border:1px solid #ddd;font-size:13px}.head{font-size:11px;color:#666}.val{font-weight:700;font-size:14px}</style></head><body>${el.innerHTML}</body></html>`);
                    w.document.close(); w.focus(); w.print(); w.close();
                  }}
                  style={{ background:"rgba(255,255,255,0.1)", color:"#fff", border:"1px solid rgba(255,255,255,0.2)", borderRadius:7, padding:"5px 14px", fontSize:12, cursor:"pointer" }}>
                  🖨 Print
                </button>
                <button onClick={()=>setSelectedSim(null)} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", borderRadius:7, padding:"5px 12px", cursor:"pointer", fontSize:12 }}>✕</button>
              </div>
            </div>
            <div id="ind_sim_print">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginBottom:14 }}>
                {[
                  ["CPF",          cpfSim],
                  ["Provider",     provider?.toUpperCase()],
                  ["Tabela",       selectedSim.label],
                  ["Valor Liberado",fmtBRL(selectedSim.sim?.availableBalance||0)],
                  ["Valor Emissão",fmtBRL(selectedSim.sim?.emissionAmount||0)],
                  ["Anos",         calcAnos(selectedSim.sim)],
                  ["CET Mensal",   fmtPct(selectedSim.sim?.cet)],
                  ["IOF",          fmtBRL(selectedSim.sim?.iof)],
                  ["Total Bloqueado",fmtBRL(selectedSim.sim?.totalBalance||saldoTotal)],
                  ["Parcelas",     String(selectedSim.sim?.totalInstallments||"—")],
                  ["Data",         new Date().toLocaleString("pt-BR")],
                ].map(([l,v])=>(
                  <div key={l} style={{ background:"rgba(255,255,255,0.07)", borderRadius:9, padding:"8px 12px" }}>
                    <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>{l}</div>
                    <div style={{ color:"#fff", fontWeight:600, fontSize:13, marginTop:2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <button
              disabled={digLoading}
              onClick={async ()=>{
                setDigLoading(true);

                // Busca dados do cliente na V8 (contrato anterior)
                let clienteV8 = null;
                try {
                  const cpfBusca = (indCpfSim||"").replace(/\D/g,"");
                  const ops = await apiFetch(`/fgts/proposal?search=${cpfBusca}&page=1&limit=5`);
                  const rows = ops?.data || ops || [];
                  const paid = rows.find(r=>r.status==="paid");
                  const primeiro = paid || rows[0];
                  if (primeiro?.id) {
                    clienteV8 = await apiFetch(`/fgts/proposal/${primeiro.id}`);
                  }
                } catch {}

                // Cruza com contatos Nexp
                const cpfLimpo = (indCpfSim||"").replace(/\D/g,"");
                const nexp = (contacts||[]).find(nx => (nx.cpf||"").replace(/\D/g,"") === cpfLimpo) || {};

                // Monta telefone — V8 guarda DDD em phoneRegionCode e número em phone
                const v8Phone = clienteV8?.phone
                  ? `${clienteV8.phoneRegionCode||""}${clienteV8.phone}`.replace(/\D/g,"").slice(0,11)
                  : "";
                const nexpPhone = (nexp.phone||"").replace(/\D/g,"").slice(0,11);
                const phoneFinal = v8Phone || nexpPhone;

                const preData = {
                  clienteV8,
                  nome:         clienteV8?.name || clienteV8?.clientName || nexp.name || "",
                  email:        clienteV8?.email || nexp.email || "",
                  phone:        phoneFinal,
                  phoneDdd:     phoneFinal.slice(0,2),
                  rg:           clienteV8?.documentIdentificationNumber || nexp.rg || "",
                  nomeMae:      clienteV8?.motherName || nexp.nomeMae || "",
                  nascimento:   clienteV8?.birthDate || nexp.dataNascimento || "",
                  cep:          clienteV8?.postalCode || (nexp.cep||"").replace(/\D/g,""),
                  rua:          clienteV8?.street || nexp.rua || "",
                  numero:       clienteV8?.addressNumber || nexp.numero || "",
                  complemento:  clienteV8?.complement || nexp.complemento || "",
                  bairro:       clienteV8?.neighborhood || nexp.bairro || "",
                  cidade:       clienteV8?.city || nexp.cidade || "",
                  uf:           clienteV8?.state || nexp.ufEnd || nexp.estado || "",
                  estadoCivil:  clienteV8?.maritalStatus || "single",
                  nacionalidade:clienteV8?.nationality || "Brasileiro(a)",
                  isPEP:        clienteV8?.isPEP || false,
                };

                const d = { tabela:selectedSim, balance:indBalance, cpf:indCpfSim, provider:indProvider, clientePreFill:preData };
                openDigModal(d);
                setIndDigModal(d);
                setDigLoading(false);
              }}
              style={{ background:digLoading?C.deep:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"10px 20px", fontSize:13, fontWeight:700, cursor:digLoading?"not-allowed":"pointer", opacity:digLoading?0.7:1 }}>
              {digLoading ? "⏳ Carregando dados..." : "📝 Digitar esta proposta"}
            </button>
          </div>
        )}

        {/* ── Contratos anteriores (colapsível) ── */}
        {operacoes && Array.isArray(operacoes) && operacoes.length > 0 && (
          <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, overflow:"hidden", marginBottom:16 }}>
            <button onClick={()=>setContratosOpen(p=>!p)}
              style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 18px", background:"transparent", border:"none", cursor:"pointer" }}>
              <div style={{ color:C.ts, fontSize:13, fontWeight:700 }}>📄 Contratos anteriores do FGTS <span style={{ color:C.td, fontSize:11, fontWeight:400 }}>({operacoes.length})</span></div>
              <span style={{ color:C.td, fontSize:13 }}>{contratosOpen?"▲":"▼"}</span>
            </button>
            {contratosOpen && (
              <div style={{ padding:"0 16px 14px" }}>
                {operacoes.map((op,i)=>{
                  const STATUS_COLOR = { paid:"#34D399", canceled:"#F87171", pending:"#FBBF24", processing:"#60A5FA", formalization:"#C084FC" };
                  const stCol = STATUS_COLOR[op.status] || "#94A3B8";
                  return (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 12px", background:C.deep, borderRadius:9, marginBottom:6, border:`1px solid ${C.b1}` }}>
                      <div style={{ flex:1 }}>
                        <div style={{ color:C.tp, fontWeight:600, fontSize:12.5 }}>{op.clientName||"Cliente"} · <span style={{ fontFamily:"monospace", fontSize:11 }}>{op.contractNumber||"—"}</span></div>
                        <div style={{ color:C.tm, fontSize:11, marginTop:2 }}>Parceiro: {op.partnerId||"—"}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ color:C.atxt, fontWeight:700, fontSize:13 }}>{fmtBRL(op.disbursedIssueAmount)}</div>
                        <span style={{ background:stCol+"18", color:stCol, fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:600 }}>{op.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Modal de Digitação ── */}
        {indDigModal && (
          <ModalDigitacaoRapida
            tabela={indDigModal.tabela}
            balance={indDigModal.balance}
            cpf={indDigModal.cpf}
            provider={indDigModal.provider}
            apiFetch={apiFetch}
            fmtBRL={fmtBRL}
            contacts={contacts}
            currentUser={currentUser}
            clientePreFill={indDigModal.clientePreFill}
            step={modalStep} setStep={setModalStep}
            banks={modalBanks} setBanks={setModalBanks}
            payType={modalPayType} setPayType={setModalPayType}
            loading={modalLoading} setLoading={setModalLoading}
            result={modalResult} setResult={setModalResult}
            err={modalErr} setErr={setModalErr}
            cepLoading={modalCepLoading} setCepLoading={setModalCepLoading}
            bankSearch={modalBankSearch} setBankSearch={setModalBankSearch}
            initialForm={modalForm}
            setAcompData={setAcompData}
            onClose={()=>{ setIndDigModal(null); }}
            onSuccess={(res)=>{ 
              setIndDigModal(null); 
              setAcompData(null); 
              if (res) adicionarNaFila(res, { 
                nome: indDigModal?.clientePreFill?.name || indDigModal?.clientePreFill?.nome || "",
                cpf: indDigModal?.cpf || "",
                valorLiberado: indDigModal?.tabela?.sim?.availableBalance || 0,
                provider: indDigModal?.provider || "",
              });
              setAba("acompanhamento"); 
            }}
          />
        )}

        {/* ── Histórico de simulações ── */}
        {historico.length > 0 && (
          <div style={{ marginBottom:16 }}>
            {/* Header + busca + data */}
            <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:"14px 14px 0 0", padding:"12px 16px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <div style={{ color:C.ts, fontSize:13, fontWeight:700 }}>📑 Histórico de Simulações <span style={{ color:C.td, fontSize:11, fontWeight:400 }}>({historico.length})</span></div>
              <input
                value={histSearch} onChange={e=>{ setIndHistSearch(e.target.value); setIndHistPage(0); }}
                placeholder="🔍 Buscar por CPF ou nome..."
                style={{ ...S.input, flex:1, minWidth:150, fontSize:12, padding:"5px 10px" }}
              />
              <input
                type="date"
                onChange={e=>{ setIndHistSearch(e.target.value); setIndHistPage(0); }}
                style={{ ...S.input, width:145, fontSize:12, padding:"5px 9px", cursor:"pointer", colorScheme:"dark" }}
                title="Filtrar por data"
              />
              <button onClick={()=>{
                if(window.__histClearConfirm) { clearTimeout(window.__histClearConfirm); }
                // Show inline popup confirm
                const modal = document.getElementById("hist_clear_modal");
                if(modal) modal.style.display="flex";
              }}
                style={{ background:"rgba(239,68,68,0.1)", border:"1px solid #EF444433", color:"#F87171", borderRadius:8, padding:"5px 14px", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>
                🗑 Limpar tudo
              </button>
            </div>

            {/* Modal confirmação limpar histórico */}
            <div id="hist_clear_modal" style={{ display:"none", position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:2000, alignItems:"center", justifyContent:"center" }}>
              <div style={{ background:C.card, border:"1px solid #EF444433", borderRadius:20, padding:"32px 36px", maxWidth:400, width:"90%", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
                <div style={{ fontSize:44, marginBottom:12 }}>🗑</div>
                <div style={{ color:C.tp, fontSize:17, fontWeight:800, marginBottom:8 }}>Limpar histórico?</div>
                <div style={{ color:C.tm, fontSize:13, marginBottom:24, lineHeight:1.6 }}>
                  Todos os <strong style={{ color:"#F87171" }}>{historico.length} registros</strong> de simulação serão apagados permanentemente. Esta ação não pode ser desfeita.
                </div>
                <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
                  <button onClick={()=>{ document.getElementById("hist_clear_modal").style.display="none"; }}
                    style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:10, padding:"10px 28px", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    Cancelar
                  </button>
                  <button onClick={()=>{
                    setIndHistorico([]); localStorage.removeItem("nexp_v8_ind_historico"); setIndHistDetalhe(null);
                    document.getElementById("hist_clear_modal").style.display="none";
                  }}
                    style={{ background:"linear-gradient(135deg,#DC2626,#B91C1C)", color:"#fff", border:"none", borderRadius:10, padding:"10px 28px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                    ✕ Confirmar exclusão
                  </button>
                </div>
              </div>
            </div>

            {/* Painel de detalhe */}
            {histDetalhe && (
              <div style={{ background:"linear-gradient(135deg,#0f1f3d,#162a50)", border:"1px solid rgba(79,142,247,0.3)", borderTop:"none", padding:"20px 22px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <div style={{ color:"#fff", fontSize:13.5, fontWeight:700 }}>🔍 Detalhe — {histDetalhe.cpf} {histDetalhe.nome && <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:400 }}>· {histDetalhe.nome}</span>}</div>
                  <button onClick={()=>setIndHistDetalhe(null)} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", borderRadius:7, padding:"4px 12px", cursor:"pointer", fontSize:12 }}>✕</button>
                </div>

                {/* Dados do cliente */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginBottom:16 }}>
                  {[
                    ["CPF",          histDetalhe.cpf],
                    ["Nome",         histDetalhe.nome||"—"],
                    ["Provider",     histDetalhe.provider?.toUpperCase()],
                    ["Saldo FGTS",   fmtBRL(histDetalhe.saldo||0)],
                    ["Melhor Oferta",fmtBRL(histDetalhe.melhorValor||0)],
                    ["Tabela",       histDetalhe.melhorTabela],
                    ["Anos",         histDetalhe.anos||"—"],
                    ["Data",         histDetalhe.ts||"—"],
                    ["E-mail",       histDetalhe.email||"—"],
                    ["Telefone",     histDetalhe.phone?`(${histDetalhe.phoneDdd||""}) ${histDetalhe.phone}`:"—"],
                    ["Nascimento",   histDetalhe.nascimento||"—"],
                    ["Cidade/UF",    histDetalhe.cidade&&histDetalhe.uf?`${histDetalhe.cidade}/${histDetalhe.uf}`:"—"],
                  ].map(([l,v])=>(
                    <div key={l} style={{ background:"rgba(255,255,255,0.07)", borderRadius:9, padding:"8px 12px" }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>{l}</div>
                      <div style={{ color:"#fff", fontWeight:600, fontSize:12.5, marginTop:2 }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Tabelas clicáveis */}
                {(histDetalhe.allSims||[]).filter(t=>t.ok).length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:10 }}>
                      Todas as tabelas — clique para digitar
                    </div>
                    <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                      {[...( histDetalhe.allSims||[])].sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0)).map((s,i)=>{
                        const isBest = s.label===histDetalhe.melhorTabela;
                        const vlr = parseFloat(s.sim?.availableBalance||0);
                        return (
                          <div key={i}
                            onClick={()=>{ if(!s.ok) return; const d={ tabela:{ label:s.label, sim:s.sim, feeId:histDetalhe.melhorFeeId||"" }, balance:{ ...histDetalhe.balance, id:histDetalhe.balanceId }, cpf:histDetalhe.cpf, provider:histDetalhe.provider, clientePreFill:histDetalhe }; openDigModal(d); setIndDigModal(d); }}
                            style={{ background:isBest?"rgba(52,211,153,0.15)":"rgba(79,142,247,0.1)", border:`2px solid ${isBest?"rgba(52,211,153,0.4)":"rgba(79,142,247,0.2)"}`, borderRadius:12, padding:"10px 14px", minWidth:130, cursor:s.ok?"pointer":"default", position:"relative", transition:"all 0.12s" }}
                            onMouseEnter={e=>{ if(s.ok){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 6px 20px rgba(0,0,0,0.3)";} }}
                            onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
                            {isBest&&<div style={{ position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",background:"#34D399",color:"#000",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,whiteSpace:"nowrap" }}>🏆 MELHOR</div>}
                            <div style={{ color:"rgba(255,255,255,0.7)", fontSize:11, textTransform:"capitalize", marginTop:isBest?4:0 }}>{s.label}</div>
                            <div style={{ color:isBest?"#34D399":"#fff", fontWeight:800, fontSize:16, lineHeight:1, marginTop:2 }}>{fmtBRL(vlr)}</div>
                            <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, marginTop:2 }}>{calcAnos(s.sim)}</div>
                            {s.ok&&<div style={{ marginTop:6, background:"rgba(255,255,255,0.12)", borderRadius:6, padding:"3px 0", textAlign:"center", fontSize:10, fontWeight:700, color:"#fff" }}>📝 DIGITAR</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!histDetalhe.ok && histDetalhe.erro && (
                  <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:9, padding:"10px 14px" }}>
                    <div style={{ color:"#F87171", fontWeight:600 }}>{histDetalhe.erro}</div>
                  </div>
                )}
              </div>
            )}

            {/* Tabela */}
            <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderTop:"none", overflow:"hidden", borderRadius: histDetalhe?"0":"0 0 14px 14px" }}>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead>
                    <tr style={{ background:C.deep }}>
                      {["#","CPF","Nome","Provider","Status","Saldo FGTS","Melhor Oferta","Tabela","Anos","Data"].map(h=>(
                        <th key={h} style={{ color:C.td, fontSize:10, fontWeight:700, padding:"8px 12px", textAlign:"left", borderBottom:`1px solid ${C.b1}`, whiteSpace:"nowrap", textTransform:"uppercase", letterSpacing:"0.3px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historico
                      .filter(h => !histSearch || h.cpf?.includes(histSearch) || (h.nome||"").toLowerCase().includes(histSearch.toLowerCase()))
                      .slice(histPage*20, (histPage+1)*20)
                      .map((h,i)=>{
                        const isSelected = histDetalhe?.id === h.id;
                        return (
                          <tr key={h.id}
                            onClick={()=>setIndHistDetalhe(isSelected?null:h)}
                            style={{ background:isSelected?`${C.acc}15`:i%2===0?C.card:C.deep, borderBottom:`1px solid ${C.b1}`, cursor:"pointer", transition:"background 0.1s" }}
                            onMouseEnter={e=>!isSelected&&(e.currentTarget.style.background=`${C.acc}08`)}
                            onMouseLeave={e=>(e.currentTarget.style.background=isSelected?`${C.acc}15`:i%2===0?C.card:C.deep)}>
                            <td style={{ color:C.td, padding:"8px 12px", fontSize:11 }}>{histPage*20+i+1}</td>
                            <td style={{ color:C.tp, fontWeight:600, padding:"8px 12px", fontFamily:"monospace", fontSize:11.5 }}>{h.cpf}</td>
                            <td style={{ color:C.tm, padding:"8px 12px", fontSize:11.5, maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.nome||"—"}</td>
                            <td style={{ color:C.td, padding:"8px 12px", fontSize:11, textTransform:"uppercase" }}>{h.provider}</td>
                            <td style={{ padding:"8px 12px" }}>
                              {h.ok
                                ? <span style={{ background:"#091E12", color:"#34D399", fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:600 }}>✅ OK</span>
                                : <span style={{ background:"#2D1515", color:"#F87171", fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:600 }}>❌ Erro</span>}
                            </td>
                            <td style={{ color:h.ok?C.atxt:"#F87171", fontWeight:h.ok?700:400, padding:"8px 12px", fontSize:12 }}>
                              {h.ok ? fmtBRL(h.saldo) : (h.erro||"Erro").slice(0,20)}
                            </td>
                            <td style={{ color:"#34D399", fontWeight:700, padding:"8px 12px", fontSize:12 }}>{h.ok?fmtBRL(h.melhorValor):"—"}</td>
                            <td style={{ color:C.tm, padding:"8px 12px", fontSize:11, textTransform:"capitalize" }}>{h.melhorTabela}</td>
                            <td style={{ color:C.td, padding:"8px 12px", fontSize:11 }}>{h.anos||"—"}</td>
                            <td style={{ color:C.td, padding:"8px 12px", fontSize:10.5, whiteSpace:"nowrap" }}>{h.ts}</td>
                          </tr>
                        );
                      })}
                    {historico.filter(h=>!histSearch||h.cpf?.includes(histSearch)||(h.nome||"").toLowerCase().includes(histSearch.toLowerCase())).length===0 && (
                      <tr><td colSpan={10} style={{ color:C.td, textAlign:"center", padding:"20px", fontSize:13 }}>Nenhum resultado.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {historico.filter(h=>!histSearch||h.cpf?.includes(histSearch)||(h.nome||"").toLowerCase().includes(histSearch.toLowerCase())).length > 20 && (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 16px", background:C.deep, borderTop:`1px solid ${C.b1}`, borderRadius:"0 0 14px 14px" }}>
                  <button onClick={()=>setIndHistPage(p=>Math.max(0,p-1))} disabled={histPage===0}
                    style={{ background:histPage>0?C.abg:C.deep, color:histPage>0?C.atxt:C.td, border:`1px solid ${C.b2}`, borderRadius:7, padding:"5px 12px", fontSize:11.5, cursor:histPage>0?"pointer":"not-allowed" }}>← Anterior</button>
                  <span style={{ color:C.tm, fontSize:11.5 }}>{histPage*20+1}–{Math.min((histPage+1)*20,historico.length)} de {historico.length}</span>
                  <button onClick={()=>setIndHistPage(p=>p+1)} disabled={(histPage+1)*20>=historico.length}
                    style={{ background:(histPage+1)*20<historico.length?C.abg:C.deep, color:(histPage+1)*20<historico.length?C.atxt:C.td, border:`1px solid ${C.b2}`, borderRadius:7, padding:"5px 12px", fontSize:11.5, cursor:(histPage+1)*20<historico.length?"pointer":"not-allowed" }}>Próxima →</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Log colapsável ── */}
        {logs.length > 0 && (
          <details style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:12 }}>
            <summary style={{ padding:"12px 16px", cursor:"pointer", color:C.ts, fontSize:12, fontWeight:700, listStyle:"none", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span>📋 Log da Simulação ({logs.length})</span>
              <button onClick={(e)=>{e.preventDefault();setLogs([]);localStorage.removeItem("nexp_v8_ind_logs");}} style={{ background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:11 }}>Limpar</button>
            </summary>
            <div style={{ padding:"0 16px 12px", maxHeight:220, overflowY:"auto", display:"flex", flexDirection:"column", gap:3 }}>
              {logs.map((l,i)=>(
                <div key={i} style={{ display:"flex", gap:8, fontSize:10.5 }}>
                  <span style={{ color:C.td, flexShrink:0, fontFamily:"monospace" }}>{l.ts}</span>
                  <span style={{ color:l.ok?"#34D399":"#F87171", wordBreak:"break-word" }}>{l.msg}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  };

  const OperacoesTab = () => {
    const search   = opsSearch;   const setSearch   = setOpsSearch;
    const status   = opsStatus;   const setStatus   = setOpsStatus;
    const provider = opsProvider; const setProvider = setOpsProvider;
    const page     = opsPage;     const setPage     = setOpsPage;
    const data     = opsData;     const setData     = setOpsData;
    const loading  = opsLoading;  const setLoading  = setOpsLoading;
    const err      = opsErr;      const setErr      = setOpsErr;
    const cancelId        = opsCancelId;        const setCancelId        = setOpsCancelId;
    const cancelReason    = opsCancelReason;    const setCancelReason    = setOpsCancelReason;
    const cancelDesc      = opsCancelDesc;      const setCancelDesc      = setOpsCancelDesc;
    const cancelLoading   = opsCancelLoading;   const setCancelLoading   = setOpsCancelLoading;
    const detalhe  = opsDetalhe;  const setDetalhe  = setOpsDetalhe;
    const simModal = opsSimModal; const setSimModal = setOpsSimModal;

    const buscar = async (pg=1) => {
      setLoading(true); setErr(""); setPage(pg);
      try {
        const params = new URLSearchParams({ page:pg, limit:20 });
        if (search) params.append("search", search.replace(/\D/g,"") || search);
        if (status) params.append("status", status);
        if (provider) params.append("provider", provider);
        const res = await apiFetch(`/fgts/proposal?${params}`);
        // Sort by most recent
        if (res?.data) res.data.sort((a,b)=>(b.createdAt||b.created_at||0)-(a.createdAt||a.created_at||0));
        setData(res);
      } catch(e) { setErr(e.message); }
      setLoading(false);
    };

    const cancelar = async (id) => {
      setCancelLoading(true);
      try {
        await apiFetch(`/fgts/proposal/${id}/cancel`, "PATCH", { reason:cancelReason, description:cancelDesc });
        setCancelId(null); setCancelDesc("");
        await buscar(page);
      } catch(e) { setErr("Cancelamento: " + e.message); }
      setCancelLoading(false);
    };

    const STATUS_LIST = ["","formalization","analysis","manual_analysis","pending","processing","paid","canceled","refounded"];
    const STATUS_LABEL = { formalization:"Formalização", analysis:"Em Análise", manual_analysis:"Análise Manual", pending:"Pendente", processing:"Processando", paid:"Pago", canceled:"Cancelado", refounded:"Devolvido" };
    const STATUS_COLOR = { paid:"#34D399", canceled:"#F87171", pending:"#FBBF24", processing:"#60A5FA", formalization:"#C084FC", analysis:"#60A5FA", manual_analysis:"#FB923C", refounded:"#94A3B8" };

    return (
      <div>
        {/* Filtros */}
        <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"18px 20px", marginBottom:16 }}>
          <div style={{ color:C.ts, fontSize:14, fontWeight:700, marginBottom:14 }}>📋 Contratos FGTS</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ flex:1, minWidth:160 }}>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Buscar (CPF, nome ou contrato)</label>
              <input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&buscar(1)}
                placeholder="CPF, nome ou nº contrato" autoComplete="off" style={{ ...S.input }} />
            </div>
            <div>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Status</label>
              <select value={status} onChange={e=>setStatus(e.target.value)} style={{ ...S.input, cursor:"pointer" }}>
                {STATUS_LIST.map(s=><option key={s} value={s}>{s?STATUS_LABEL[s]:"Todos"}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Provider</label>
              <select value={provider} onChange={e=>setProvider(e.target.value)} style={{ ...S.input, cursor:"pointer" }}>
                <option value="">Todos</option>
                {["qi","cartos","bms"].map(p=><option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            </div>
            <button onClick={()=>buscar(1)} disabled={loading}
              style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"9px 20px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:loading?0.6:1 }}>
              {loading?"⏳ Buscando...":"🔍 Buscar"}
            </button>
          </div>
          {err && <div style={{ color:"#F87171", marginTop:10, fontSize:12 }}>⚠ {err}</div>}
        </div>

        {/* Detalhe do contrato selecionado */}
        {detalhe && (
          <div style={{ background:"linear-gradient(135deg,#0f1f3d,#162a50)", border:"1px solid rgba(79,142,247,0.3)", borderRadius:16, padding:"22px 26px", marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ color:"#fff", fontSize:14, fontWeight:700 }}>
                🔍 {detalhe.clientName||"Contrato"} · <span style={{ fontFamily:"monospace", fontSize:12, color:"rgba(255,255,255,0.6)" }}>{detalhe.contractNumber||"—"}</span>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {/* Botão Simular */}
                <button
                  onClick={async ()=>{
                    setSimModal({ loading:true, cpf:detalhe.documentNumber||detalhe.individualDocumentNumber||"", nome:detalhe.clientName||"", contrato:detalhe });
                    try {
                      const cpfv = (detalhe.documentNumber||detalhe.individualDocumentNumber||"").replace(/\D/g,"");
                      await apiFetch("/fgts/balance","POST",{ documentNumber:cpfv, provider: detalhe.provider||"cartos" });
                      let bal = null;
                      for (let i=0;i<18;i++) {
                        await new Promise(r=>setTimeout(r,2500));
                        const res = await apiFetch(`/fgts/balance?search=${cpfv}`);
                        const regs = res?.data||(Array.isArray(res)?res:[res]).filter(Boolean);
                        const ok = regs.find(r=>r&&(r.status==="success"||r.amount!=null));
                        if(ok){bal=ok;break;}
                        const fail=regs.find(r=>r&&(r.status==="fail"||r.status==="error"));
                        if(fail){setSimModal(p=>({...p,loading:false,err:fail.statusInfo||fail.message||"Falha"}));return;}
                      }
                      if(!bal){setSimModal(p=>({...p,loading:false,err:"Timeout"}));return;}
                      const feesR = await apiFetch("/fgts/simulations/fees");
                      const fees = Array.isArray(feesR)?feesR.filter(f=>f.active):[];
                      const saldoVal=parseFloat(bal.amount||0);
                      const installments=(bal.periods||bal.installments||[]).length
                        ?(bal.periods||bal.installments).map(p=>({totalAmount:parseFloat(p.amount||p.totalAmount||saldoVal),dueDate:p.dueDate||p.date}))
                        :[{totalAmount:saldoVal||100,dueDate:new Date(new Date().getFullYear()+1,1,1).toISOString().split("T")[0]}];
                      const sims = await Promise.all(fees.map(async fee=>{
                        try{const sim=await apiFetch("/fgts/simulations","POST",{simulationFeesId:fee.simulation_fees?.id_simulation_fees,balanceId:bal.id,targetAmount:0,documentNumber:cpfv,desiredInstallments:installments,provider:detalhe.provider||"cartos"});return{label:fee.simulation_fees?.label||"",sim,ok:true};}
                        catch(e){return{label:fee.simulation_fees?.label||"",err:e.message,ok:false};}
                      }));
                      const best=[...sims].filter(t=>t.ok).sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0))[0];
                      setSimModal(p=>({...p,loading:false,bal,saldo:saldoVal,sims,best}));
                    } catch(e){setSimModal(p=>({...p,loading:false,err:e.message}));}
                  }}
                  style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:8, padding:"7px 16px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                  ⚡ Nova Simulação
                </button>
                <button onClick={()=>setDetalhe(null)} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", borderRadius:8, padding:"7px 14px", fontSize:12, cursor:"pointer" }}>✕</button>
              </div>
            </div>

            {/* Grid de dados */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10, marginBottom:16 }}>
              {[
                ["Cliente",          detalhe.clientName||"—"],
                ["CPF",              detalhe.documentNumber||detalhe.individualDocumentNumber||"—"],
                ["E-mail",           detalhe.email||"—"],
                ["Telefone",         detalhe.phone?(detalhe.phoneRegionCode||"")+detalhe.phone:"—"],
                ["Contrato",         detalhe.contractNumber||"—"],
                ["Status",           STATUS_LABEL[detalhe.status]||detalhe.status||"—"],
                ["Valor Liberado",   fmtBRL(detalhe.disbursedIssueAmount)],
                ["Provider",         (detalhe.provider||"—").toUpperCase()],
                ["Parceiro",         detalhe.partnerId||"—"],
                ["Tabela",           detalhe.simulationFeesLabel||detalhe.feesLabel||"—"],
              ].map(([l,v])=>(
                <div key={l} style={{ background:"rgba(255,255,255,0.07)", borderRadius:9, padding:"8px 12px" }}>
                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>{l}</div>
                  <div style={{ color:"#fff", fontWeight:600, fontSize:12.5, marginTop:2, wordBreak:"break-word" }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Dados bancários */}
            {(detalhe.payment||detalhe.bankAccountNumber) && (
              <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:10, padding:"12px 14px" }}>
                <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:8 }}>Dados de Pagamento</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8 }}>
                  {detalhe.payment?.type==="PIX"||detalhe.payment?.type==="pix" ? (
                    <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:7, padding:"6px 10px" }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>Chave PIX</div>
                      <div style={{ color:"#34D399", fontSize:12, fontWeight:600, marginTop:2, fontFamily:"monospace" }}>{detalhe.payment?.data?.pix||detalhe.payment?.data?.pixKey||"—"}</div>
                    </div>
                  ) : [
                    ["Banco", detalhe.payment?.data?.bankId||detalhe.bankId||"—"],
                    ["Agência", detalhe.payment?.data?.bankAccountBranch||detalhe.bankAccountBranch||"—"],
                    ["Conta", detalhe.payment?.data?.bankAccountNumber||detalhe.bankAccountNumber||"—"],
                    ["Tipo", detalhe.payment?.data?.bankAccountType==="saving_account"?"Poupança":"Corrente"],
                  ].map(([l,v])=>(
                    <div key={l} style={{ background:"rgba(255,255,255,0.05)", borderRadius:7, padding:"6px 10px" }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>{l}</div>
                      <div style={{ color:"#fff", fontSize:12, fontWeight:600, marginTop:2 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Botão cancelar */}
            {detalhe.status!=="paid"&&detalhe.status!=="canceled"&&(
              <button onClick={()=>setCancelId(detalhe.id)}
                style={{ marginTop:12, background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:8, padding:"7px 16px", fontSize:12, cursor:"pointer" }}>
                ✕ Cancelar Contrato
              </button>
            )}
          </div>
        )}

        {/* Modal de simulação popup */}
        {simModal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div style={{ background:"linear-gradient(135deg,#0f1f3d,#162a50)", border:"1px solid rgba(79,142,247,0.3)", borderRadius:18, padding:"24px", width:"100%", maxWidth:660, maxHeight:"90vh", overflowY:"auto" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ color:"#fff", fontSize:14, fontWeight:700 }}>⚡ Simulação — {simModal.nome||simModal.cpf}</div>
                  <div style={{ color:"rgba(255,255,255,0.5)", fontSize:12, marginTop:2 }}>CPF: {simModal.cpf}</div>
                </div>
                <button onClick={()=>setSimModal(null)} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>✕</button>
              </div>

              {simModal.loading ? (
                <div style={{ textAlign:"center", padding:"40px 0" }}>
                  <div style={{ color:"#60A5FA", fontSize:28, marginBottom:12 }}>⏳</div>
                  <div style={{ color:"rgba(255,255,255,0.7)", fontSize:13 }}>Consultando saldo e simulando tabelas...</div>
                </div>
              ) : simModal.err ? (
                <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:10, padding:"14px", color:"#F87171" }}>{simModal.err}</div>
              ) : simModal.sims ? (
                <div>
                  {/* Saldo */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                    <div style={{ background:"rgba(255,255,255,0.07)", borderRadius:10, padding:"12px 16px" }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:11 }}>Saldo FGTS</div>
                      <div style={{ color:"#fff", fontSize:22, fontWeight:900 }}>{fmtBRL(simModal.saldo||0)}</div>
                    </div>
                    {simModal.best && (
                      <div style={{ background:"rgba(52,211,153,0.1)", border:"1px solid rgba(52,211,153,0.3)", borderRadius:10, padding:"12px 16px" }}>
                        <div style={{ color:"#34D399", fontSize:11, fontWeight:700 }}>✅ MELHOR OFERTA — {simModal.best.label}</div>
                        <div style={{ color:"#34D399", fontSize:22, fontWeight:900 }}>{fmtBRL(simModal.best.sim?.availableBalance||0)}</div>
                        <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10.5, marginTop:2 }}>via PIX · {calcAnos(simModal.best.sim)}</div>
                      </div>
                    )}
                  </div>
                  {/* Tabelas */}
                  <div style={{ marginBottom:14 }}>
                    <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:10 }}>Clique para digitar proposta</div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      {[...(simModal.sims||[])].sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0)).map((s,i)=>{
                        const isBest = s.label===simModal.best?.label;
                        return (
                          <div key={i}
                            onClick={()=>{
                              if(!s.ok)return;
                              const d={tabela:{label:s.label,sim:s.sim,feeId:""},balance:{...simModal.bal,id:simModal.bal?.id},cpf:simModal.cpf,provider:simModal.contrato?.provider||loteProvider,clientePreFill:{cpf:simModal.cpf,nome:simModal.nome}};
                              openDigModal(d); setIndDigModal(d); setSimModal(null);
                            }}
                            style={{ background:isBest?"rgba(52,211,153,0.12)":"rgba(79,142,247,0.08)", border:`2px solid ${isBest?"rgba(52,211,153,0.4)":"rgba(79,142,247,0.2)"}`, borderRadius:12, padding:"10px 14px", minWidth:130, cursor:s.ok?"pointer":"default", position:"relative", transition:"all 0.12s" }}
                            onMouseEnter={e=>{if(s.ok){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 6px 20px rgba(0,0,0,0.3)";}}}
                            onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
                            {isBest&&<div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",background:"#34D399",color:"#000",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,whiteSpace:"nowrap"}}>🏆 MELHOR</div>}
                            <div style={{color:"rgba(255,255,255,0.7)",fontSize:11,textTransform:"capitalize",marginTop:isBest?4:0}}>{s.label}</div>
                            {s.ok?<>
                              <div style={{color:isBest?"#34D399":"#fff",fontWeight:800,fontSize:16,lineHeight:1,marginTop:2}}>{fmtBRL(s.sim?.availableBalance||0)}</div>
                              <div style={{color:"rgba(255,255,255,0.35)",fontSize:10,marginTop:2}}>{calcAnos(s.sim)}</div>
                              <div style={{marginTop:8,background:"rgba(255,255,255,0.12)",borderRadius:6,padding:"3px 0",textAlign:"center",fontSize:10,fontWeight:700,color:"#fff"}}>📝 DIGITAR</div>
                            </>:<div style={{color:"#F87171",fontSize:11,marginTop:4}}>✘</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Tabela de contratos */}
        {data && (
          <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:C.deep }}>
                    {["Cliente","CPF","Contrato","Status","Valor","Parceiro","Ações","Nova Simulação"].map(h=>(
                      <th key={h} style={{ color:C.tm, fontWeight:700, padding:"9px 10px", textAlign:"left", borderBottom:`1px solid ${C.b1}`, whiteSpace:"nowrap", fontSize:10.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.data||[]).map((op,i)=>{
                    const stCol = STATUS_COLOR[op.status] || "#94A3B8";
                    const isSelected = detalhe?.id === op.id;
                    return (
                      <tr key={op.id}
                        onClick={()=>setDetalhe(isSelected?null:op)}
                        style={{ background:isSelected?`${C.acc}15`:i%2===0?C.card:C.deep, borderBottom:`1px solid ${C.b1}`, cursor:"pointer", transition:"background 0.1s" }}
                        onMouseEnter={e=>!isSelected&&(e.currentTarget.style.background=`${C.acc}08`)}
                        onMouseLeave={e=>(e.currentTarget.style.background=isSelected?`${C.acc}15`:i%2===0?C.card:C.deep)}>
                        <td style={{ color:C.tp, fontWeight:600, padding:"9px 10px", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{op.clientName||"—"}</td>
                        <td style={{ color:C.tm, padding:"9px 10px", fontFamily:"monospace", fontSize:11 }}>{(op.documentNumber||op.individualDocumentNumber||"—").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4")}</td>
                        <td style={{ color:C.td, padding:"9px 10px", fontFamily:"monospace", fontSize:11 }}>{op.contractNumber||"—"}</td>
                        <td style={{ padding:"9px 10px" }}>
                          <span style={{ background:stCol+"18", color:stCol, fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:600 }}>
                            {STATUS_LABEL[op.status]||op.status}
                          </span>
                        </td>
                        <td style={{ color:C.atxt, fontWeight:700, padding:"9px 10px", fontSize:12.5 }}>{fmtBRL(op.disbursedIssueAmount)}</td>
                        <td style={{ color:C.td, padding:"9px 10px", fontSize:11 }}>{op.partnerId||"—"}</td>
                        <td style={{ padding:"9px 10px" }} onClick={e=>e.stopPropagation()}>
                          {op.status!=="paid"&&op.status!=="canceled"&&(
                            <button onClick={()=>setCancelId(op.id)}
                              style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:7, padding:"3px 9px", fontSize:11, cursor:"pointer" }}>
                              Cancelar
                            </button>
                          )}
                        </td>
                        <td style={{ padding:"9px 10px" }} onClick={e=>e.stopPropagation()}>
                          <button onClick={async ()=>{
                            const cpfv=(op.documentNumber||op.individualDocumentNumber||"").replace(/\D/g,"");
                            setSimModal({loading:true,cpf:cpfv,nome:op.clientName||"",contrato:op});
                            try{
                              await apiFetch("/fgts/balance","POST",{documentNumber:cpfv,provider:op.provider||"cartos"});
                              let bal=null;
                              for(let ii=0;ii<18;ii++){
                                await new Promise(r=>setTimeout(r,2500));
                                const res=await apiFetch(`/fgts/balance?search=${cpfv}`);
                                const regs=res?.data||(Array.isArray(res)?res:[res]).filter(Boolean);
                                const ok=regs.find(r=>r&&(r.status==="success"||r.amount!=null));
                                if(ok){bal=ok;break;}
                                const fail=regs.find(r=>r&&(r.status==="fail"||r.status==="error"));
                                if(fail){setSimModal(p=>({...p,loading:false,err:fail.statusInfo||fail.message||"Falha"}));return;}
                              }
                              if(!bal){setSimModal(p=>({...p,loading:false,err:"Timeout"}));return;}
                              const feesR=await apiFetch("/fgts/simulations/fees");
                              const fees=Array.isArray(feesR)?feesR.filter(f=>f.active):[];
                              const saldoVal=parseFloat(bal.amount||0);
                              const installments=(bal.periods||bal.installments||[]).length
                                ?(bal.periods||bal.installments).map(p=>({totalAmount:parseFloat(p.amount||p.totalAmount||saldoVal),dueDate:p.dueDate||p.date}))
                                :[{totalAmount:saldoVal||100,dueDate:new Date(new Date().getFullYear()+1,1,1).toISOString().split("T")[0]}];
                              const sims=await Promise.all(fees.map(async fee=>{
                                try{const sim=await apiFetch("/fgts/simulations","POST",{simulationFeesId:fee.simulation_fees?.id_simulation_fees,balanceId:bal.id,targetAmount:0,documentNumber:cpfv,desiredInstallments:installments,provider:op.provider||"cartos"});return{label:fee.simulation_fees?.label||"",sim,ok:true};}
                                catch(e){return{label:fee.simulation_fees?.label||"",err:e.message,ok:false};}
                              }));
                              const best=[...sims].filter(t=>t.ok).sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0))[0];
                              setSimModal(p=>({...p,loading:false,bal,saldo:saldoVal,sims,best}));
                            }catch(e){setSimModal(p=>({...p,loading:false,err:e.message}));}
                          }}
                            style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:7, padding:"4px 11px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                            ⚡ Simular
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {(data.data||[]).length===0&&(
                    <tr><td colSpan={8} style={{ color:C.td, textAlign:"center", padding:"28px" }}>Nenhum contrato. Use o campo de busca acima.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {data.pages&&(
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderTop:`1px solid ${C.b1}`, background:C.deep }}>
                <button onClick={()=>buscar(page-1)} disabled={!data.pages.hasPrev||loading}
                  style={{ background:data.pages.hasPrev?C.abg:C.deep, color:data.pages.hasPrev?C.atxt:C.td, border:`1px solid ${C.b2}`, borderRadius:8, padding:"6px 14px", fontSize:12, cursor:data.pages.hasPrev?"pointer":"not-allowed" }}>← Anterior</button>
                <span style={{ color:C.tm, fontSize:12 }}>Página {data.pages.current||page} de {data.pages.totalPages||1} · {data.pages.total||0} contratos</span>
                <button onClick={()=>buscar(page+1)} disabled={!data.pages.hasNext||loading}
                  style={{ background:data.pages.hasNext?C.abg:C.deep, color:data.pages.hasNext?C.atxt:C.td, border:`1px solid ${C.b2}`, borderRadius:8, padding:"6px 14px", fontSize:12, cursor:data.pages.hasNext?"pointer":"not-allowed" }}>Próxima →</button>
              </div>
            )}
          </div>
        )}

        {/* Modal cancelamento */}
        {cancelId&&(
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:999, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:16, padding:"24px", width:420 }}>
              <div style={{ color:C.tp, fontSize:14, fontWeight:700, marginBottom:14 }}>⚠ Cancelar Proposta</div>
              <div style={{ marginBottom:12 }}>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Motivo *</label>
                <select value={cancelReason} onChange={e=>setCancelReason(e.target.value)} style={{ ...S.input, cursor:"pointer" }}>
                  <option value="invalid_data:other">Outros</option>
                  <option value="invalid_data:invalid_address">Endereço incorreto</option>
                  <option value="invalid_data:incomplete_name">Nome incompleto</option>
                  <option value="invalid_data:invalid_name">Nome incorreto</option>
                </select>
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Descrição (recomendado)</label>
                <textarea value={cancelDesc} onChange={e=>setCancelDesc(e.target.value)} rows={3} placeholder="Descreva o motivo..." style={{ ...S.input, resize:"vertical" }} />
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>cancelar(cancelId)} disabled={cancelLoading}
                  style={{ flex:1, background:"#EF4444", color:"#fff", border:"none", borderRadius:9, padding:"10px 0", fontSize:13, fontWeight:700, cursor:"pointer", opacity:cancelLoading?0.7:1 }}>
                  {cancelLoading?"Cancelando...":"Confirmar Cancelamento"}
                </button>
                <button onClick={()=>setCancelId(null)} style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:9, padding:"10px 16px", fontSize:13, cursor:"pointer" }}>Voltar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════
  // ABA: SIMULAÇÃO EM LOTE — completa com polling real
  // ════════════════════════════════════════════════════════════
  const LoteTab = () => {
    const items        = loteItems;       const setItems        = setLoteItems;
    const running      = loteRunning;     const setRunning      = setLoteRunning;
    const paused       = lotePaused;      const setPaused       = setLotePaused;
    const progress     = loteProgress;    const setProgress     = setLoteProgress;
    const filterSaldo  = loteFilterSaldo; const setFilterSaldo  = setLoteFilterSaldo;
    const filterMargem = loteFilterMargem;const setFilterMargem = setLoteFilterMargem;
    const filterStatus = loteFilterStatus;const setFilterStatus = setLoteFilterStatus;
    const logs         = loteLogs;        const setLogs         = setLoteLogs;
    const page         = lotePage;        const setPage         = setLotePage;
    const cpfBox       = loteCpfBox;      // setCpfBox via setCpfBoxPersist
    const showCpfBox   = loteShowCpfBox;  const setShowCpfBox   = setLoteShowCpfBox;
    const provider     = loteProvider;
    const fees         = loteFees;        const setFees         = setLoteFees;
    const detalheItem  = loteDetalhe;     const setDetalheItem  = setLoteDetalhe;
    const abortRef     = loteAbortRef;
    const pauseRef     = lotePauseRef;
    const PAGE_SIZE    = 50;

    const setProviderPersist = (p) => { setLoteProvider(p); localStorage.setItem("nexp_v8_lote_provider", p); };
    const setCpfBoxPersist   = (v) => { setLoteCpfBox(v);  localStorage.setItem("nexp_v8_lote_cpfbox", v); };

    const addLog = (msg, ok=true) => setLogs(p=>[{ts:new Date().toLocaleTimeString("pt-BR"),msg,ok},...p.slice(0,199)]);
    const saveState = (newItems, prog) => localStorage.setItem("nexp_v8_lote_state", JSON.stringify({ items:newItems, progress:prog }));

    const carregarFees = async () => {
      if (fees.length) return fees;
      const data = await apiFetch("/fgts/simulations/fees");
      const lista = Array.isArray(data) ? data.filter(f=>f.active) : [];
      setFees(lista);
      return lista;
    };

    // simularUm com polling completo (igual ao individual)
    const simularUm = async (item) => {
      const c = padCPF(item.cpf);
      if (c.replace(/^0+/,"").length === 0) return { ...item, status:"erro", erro:"CPF inválido", erroTipo:"cpf_invalido" };
      try {
        // 1. Dispara consulta assíncrona
        await apiFetch("/fgts/balance","POST",{ documentNumber:c, provider });

        // 2. Polling GET até ter resultado (max 45s)
        let bal = null;
        for (let i=0; i<18; i++) {
          await new Promise(r=>setTimeout(r,2500));
          try {
            const res = await apiFetch(`/fgts/balance?search=${c}`);
            const registros = res?.data || (Array.isArray(res)?res:[res]).filter(Boolean);
            const sucesso = registros.find(r=>r && (r.status==="success"||r.amount!=null));
            if (sucesso) { bal=sucesso; break; }
            const falha = registros.find(r=>r && (r.status==="fail"||r.status==="error"||r.status==="failed"));
            if (falha) {
              const rawMsg = falha.statusInfo||falha.errorMessage||falha.message||"Falha";
              const diag = diagnosticarErroV8(rawMsg, c);
              addLog(`❌ ${fmtCPF(c)}: ${diag.titulo}`, false);
              return { ...item, cpf:fmtCPF(c), status:"erro", erro:diag.titulo, erroTipo:diag.tipo, saldo:0, margem:0, ts:new Date().toLocaleString("pt-BR") };
            }
          } catch {}
        }

        if (!bal) {
          addLog(`⏳ ${fmtCPF(c)}: Timeout`, false);
          return { ...item, cpf:fmtCPF(c), status:"erro", erro:"Timeout — sem resposta em 45s", erroTipo:"timeout", saldo:0, margem:0, ts:new Date().toLocaleString("pt-BR") };
        }

        const saldoVal = parseFloat(bal.amount||bal.balance||0);

        // 3. Simular tabelas
        const feesList = await carregarFees();
        let melhorSim=null; let melhorVal=0; let melhorLabel=""; let melhorFeeId=""; let melhorAnos="—"; let allSims=[];
        if (feesList.length && bal.id) {
          const installments = (bal.periods||bal.installments||[]).length
            ? (bal.periods||bal.installments).map(p=>({ totalAmount:parseFloat(p.amount||p.totalAmount||saldoVal), dueDate:p.dueDate||p.date }))
            : [
                { totalAmount:saldoVal||100, dueDate:new Date(new Date().getFullYear()+1,1,1).toISOString().split("T")[0] },
                { totalAmount:saldoVal||100, dueDate:new Date(new Date().getFullYear()+2,1,1).toISOString().split("T")[0] },
              ];
          for (const fee of feesList) {
            try {
              const sim = await apiFetch("/fgts/simulations","POST",{ simulationFeesId:fee.simulation_fees?.id_simulation_fees, balanceId:bal.id, targetAmount:0, documentNumber:c, desiredInstallments:installments, provider });
              const v = parseFloat(sim?.availableBalance||0);
              const label = fee.simulation_fees?.label||"";
              allSims.push({ label, sim, ok:true });
              if (v > melhorVal) { melhorVal=v; melhorSim=sim; melhorLabel=label; melhorFeeId=fee.simulation_fees?.id_simulation_fees||""; melhorAnos=calcAnos(sim); }
            } catch(e) {
              allSims.push({ label:fee.simulation_fees?.label||"", err:e.message, ok:false });
            }
          }
        }

        const ts = new Date().toLocaleString("pt-BR");
        addLog(`✅ ${fmtCPF(c)} saldo:${fmtBRL(saldoVal)} melhor:${fmtBRL(melhorVal)} (${melhorLabel})`);

        // Busca dados do cliente do V8 (contratos existentes)
        let clienteV8 = null;
        let nomeCliente = item.nome && item.nome !== "Manual" ? item.nome : "";
        try {
          const ops = await apiFetch(`/fgts/proposal?search=${c}&page=1&limit=1`);
          const primeiro = (ops?.data||ops||[])[0];
          if (primeiro?.id) {
            const det = await apiFetch(`/fgts/proposal/${primeiro.id}`);
            clienteV8 = det;
            if (det.name || det.clientName) nomeCliente = det.name || det.clientName || nomeCliente;
          }
        } catch {}

        // Cruzamento com Nexp
        const nexp = (contacts||[]).find(nx => (nx.cpf||"").replace(/\D/g,"") === c) || {};
        if (!nomeCliente && nexp.name) nomeCliente = nexp.name;

        // Monta telefone — V8 guarda DDD em phoneRegionCode e número em phone
        const v8PhoneLote = clienteV8?.phone
          ? `${clienteV8.phoneRegionCode||""}${clienteV8.phone}`.replace(/\D/g,"")
          : "";
        const phoneFinalLote = v8PhoneLote || (nexp.phone||"").replace(/\D/g,"");

        return {
          ...item, cpf:fmtCPF(c), cpfRaw:c,
          nome: nomeCliente || fmtCPF(c),
          saldo:saldoVal, margem:melhorVal,
          status: saldoVal > 0 ? "ok" : "saldo_zero",
          sim:{ melhor:{ label:melhorLabel, sim:melhorSim, feeId:melhorFeeId }, balanceId:bal.id, allSims, anos:melhorAnos },
          balance: bal,
          clienteV8,
          nomeCliente,
          // Dados para auto-fill no modal de digitação
          email:        clienteV8?.email || nexp.email || "",
          phone:        phoneFinalLote,
          phoneDdd:     phoneFinalLote.slice(0,2),
          rg:           clienteV8?.documentIdentificationNumber || nexp.rg || "",
          nomeMae:      clienteV8?.motherName || nexp.nomeMae || "",
          nascimento:   clienteV8?.birthDate || nexp.dataNascimento || "",
          cep:          clienteV8?.postalCode || (nexp.cep||"").replace(/\D/g,""),
          rua:          clienteV8?.street || nexp.rua || "",
          numero:       clienteV8?.addressNumber || nexp.numero || "",
          complemento:  clienteV8?.complement || nexp.complemento || "",
          bairro:       clienteV8?.neighborhood || nexp.bairro || "",
          cidade:       clienteV8?.city || nexp.cidade || "",
          uf:           clienteV8?.state || nexp.ufEnd || "",
          estadoCivil:  clienteV8?.maritalStatus || "single",
          nacionalidade:clienteV8?.nationality || "Brasileiro(a)",
          isPEP:        clienteV8?.isPEP || false,
          ts, erro:null, erroTipo:null,
        };
      } catch(e) {
        const diag = diagnosticarErroV8(e.message, c);
        addLog(`❌ ${fmtCPF(c)}: ${diag.titulo}`, false);
        return { ...item, cpf:fmtCPF(c), status:"erro", erro:diag.titulo, erroTipo:diag.tipo, saldo:0, margem:0, ts:new Date().toLocaleString("pt-BR") };
      }
    };

    const simularLote = async () => {
      setRunning(true); setPaused(false); abortRef.current=false; pauseRef.current=false;
      const lista=[...items]; let done=0;
      for (let i=0; i<lista.length; i++) {
        while(pauseRef.current) await new Promise(r=>setTimeout(r,300));
        if(abortRef.current) break;
        if(lista[i].status==="ok") { done++; continue; }
        lista[i]={ ...lista[i], status:"simulando" }; setItems([...lista]);
        const updated = await simularUm(lista[i]);
        lista[i]=updated; done++;
        const prog=Math.round(done/lista.length*100);
        setProgress(prog); setItems([...lista]); saveState(lista,prog);
        await new Promise(r=>setTimeout(r,200));
      }
      setRunning(false); setPaused(false);
    };

    // Adiciona CPFs SEM limpar a caixa
    const adicionarCPFs = () => {
      const linhas=cpfBox.split(/[\n,;]+/).map(l=>l.trim()).filter(Boolean);
      const novos=linhas.map(cpf=>({ id:"manual_"+Date.now()+Math.random(), nome:"Manual", cpf:padCPF(cpf), saldo:null, margem:null, status:"pendente", erro:null, sim:null, ts:null }));
      setItems(p=>[...p,...novos]);
      // NÃO limpa cpfBox — só fecha o painel
      setShowCpfBox(false);
    };

    const exportar = () => {
      const rows=[["Nome","CPF","Status","Saldo disponível","Melhor Oferta","Tabela","Anos","Data simulação","Erro"]];
      filtered.forEach(it=>rows.push([it.nome,it.cpf,it.status,it.saldo??""  ,it.margem??"",it.sim?.melhor?.label||"",it.sim?.anos||"",it.ts||"",it.erro||""]));
      const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
      const a=document.createElement("a"); a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv); a.download="lote_fgts.csv"; a.click();
    };

    const filtered=items.filter(it=>{
      if(filterStatus!=="Todos"&&it.status!==filterStatus) return false;
      if(filterSaldo&&it.saldo!==null&&it.saldo<(parseFloat(filterSaldo)||0)) return false;
      if(filterMargem&&it.margem!==null&&it.margem<(parseFloat(filterMargem)||0)) return false;
      if(loteSearch){
        const q=loteSearch.toLowerCase();
        const match=(it.cpf||"").includes(loteSearch)||(it.nome||"").toLowerCase().includes(q)||(it.cpfRaw||"").includes(loteSearch);
        if(!match) return false;
      }
      return true;
    });
    const totalPages=Math.ceil(filtered.length/PAGE_SIZE);
    const pageItems=filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
    const countOk=items.filter(x=>x.status==="ok").length;
    const countErr=items.filter(x=>x.status==="erro").length;
    const countPend=items.filter(x=>x.status==="pendente").length;

    const STATUS_LABEL = { ok:"✅ OK", erro:"❌ Erro", pendente:"⏳ Pendente", simulando:"🔄 ...", saldo_zero:"⚠ Saldo Zero" };
    const STATUS_COL   = { ok:"#34D399", erro:"#F87171", pendente:"#FBBF24", simulando:"#60A5FA", saldo_zero:"#FBBF24" };
    const STATUS_BG    = { ok:"#091E12", erro:"#2D1515", pendente:"#2B2310", simulando:"#0D1C38", saldo_zero:"#2B2310" };

    return (
      <div>
        {/* Controles */}
        <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:16, padding:"18px 20px", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:10 }}>
            <div>
              <div style={{ color:C.ts, fontSize:14, fontWeight:700 }}>⚡ Simulação em Lote</div>
              <div style={{ display:"flex", gap:12, marginTop:5, flexWrap:"wrap" }}>
                <span style={{ color:C.tm, fontSize:11.5 }}>Total: <b style={{ color:C.tp }}>{items.length}</b></span>
                <span style={{ color:"#34D399", fontSize:11.5 }}>✅ {countOk}</span>
                <span style={{ color:"#FBBF24", fontSize:11.5 }}>⏳ {countPend}</span>
                <span style={{ color:"#F87171", fontSize:11.5 }}>❌ {countErr}</span>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {!running && <button onClick={simularLote} disabled={items.length===0} style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:10, padding:"9px 16px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:items.length===0?0.5:1 }}>▶ Simular Todos</button>}
              {running && <button onClick={()=>{pauseRef.current=!pauseRef.current;setPaused(p=>!p);}} style={{ background:paused?"#091E12":"#2B2310", color:paused?"#34D399":"#FBBF24", border:`1px solid ${paused?"#34D39933":"#FBBF2433"}`, borderRadius:10, padding:"9px 14px", fontSize:13, cursor:"pointer" }}>{paused?"▶ Retomar":"⏸ Pausar"}</button>}
              {running && <button onClick={()=>{abortRef.current=true;setRunning(false);setPaused(false);}} style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444433", borderRadius:10, padding:"9px 14px", fontSize:13, cursor:"pointer" }}>⏹ Parar</button>}
              {!running && items.some(i=>i.status==="erro"||i.status==="ok") && (
                <button onClick={()=>{abortRef.current=false;pauseRef.current=false;simularLote();}}
                  style={{ background:"rgba(96,165,250,0.12)", color:"#60A5FA", border:"1px solid #60A5FA33", borderRadius:10, padding:"9px 14px", fontSize:13, cursor:"pointer" }}>🔄 Reiniciar</button>
              )}
              <button onClick={()=>setShowCpfBox(p=>!p)} style={{ background:showCpfBox?C.acc:C.abg, color:"#fff", border:"none", borderRadius:10, padding:"9px 14px", fontSize:13, cursor:"pointer", fontWeight:600 }}>➕ CPFs</button>
              <button onClick={exportar} style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:10, padding:"9px 14px", fontSize:13, cursor:"pointer" }}>📥 CSV</button>
              <button onClick={()=>document.getElementById("lote_clear_modal").style.display="flex"}
                style={{ background:"rgba(239,68,68,0.08)", color:"#F87171", border:"1px solid #EF444422", borderRadius:10, padding:"9px 14px", fontSize:13, cursor:"pointer" }}>🗑 Limpar</button>
            </div>
            <div id="lote_clear_modal" style={{ display:"none", position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:2000, alignItems:"center", justifyContent:"center" }}>
              <div style={{ background:C.card, border:"1px solid #EF444433", borderRadius:20, padding:"32px 36px", maxWidth:400, width:"90%", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
                <div style={{ fontSize:44, marginBottom:12 }}>🗑</div>
                <div style={{ color:C.tp, fontSize:17, fontWeight:800, marginBottom:8 }}>Limpar lista do lote?</div>
                <div style={{ color:C.tm, fontSize:13, marginBottom:24, lineHeight:1.6 }}>Todos os <strong style={{ color:"#F87171" }}>{items.length} CPF{items.length!==1?"s":""}</strong> e resultados serão removidos permanentemente.</div>
                <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
                  <button onClick={()=>document.getElementById("lote_clear_modal").style.display="none"}
                    style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:10, padding:"10px 28px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Cancelar</button>
                  <button onClick={()=>{ setItems([]); setLogs([]); setProgress(0); localStorage.removeItem("nexp_v8_lote_state"); document.getElementById("lote_clear_modal").style.display="none"; }}
                    style={{ background:"linear-gradient(135deg,#DC2626,#B91C1C)", color:"#fff", border:"none", borderRadius:10, padding:"10px 28px", fontSize:13, fontWeight:700, cursor:"pointer" }}>✕ Confirmar limpeza</button>
                </div>
              </div>
            </div>
          </div>

          {/* Provider — persiste ao clicar Simular Todos */}
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            {["cartos","qi","bms"].map(p=>(
              <button key={p} onClick={()=>setProviderPersist(p)}
                style={{ background:provider===p?C.abg:C.deep, color:provider===p?C.atxt:C.tm, border:provider===p?`1px solid ${C.atxt}44`:`1px solid ${C.b2}`, borderRadius:8, padding:"5px 14px", fontSize:12, cursor:"pointer", fontWeight:provider===p?700:400, textTransform:"uppercase" }}>
                {p}
              </button>
            ))}
          </div>

          {/* Progresso */}
          {(running||progress>0) && (
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ color:C.tm, fontSize:11 }}>{running?(paused?"Pausado":"Simulando com polling..."):"Concluído"}</span>
                <span style={{ color:C.atxt, fontSize:11, fontWeight:700 }}>{progress}%</span>
              </div>
              <div style={{ background:C.deep, borderRadius:99, height:7, overflow:"hidden" }}>
                <div style={{ background:`linear-gradient(90deg,${C.acc},${C.lg2})`, height:"100%", width:`${progress}%`, borderRadius:99, transition:"width 0.4s" }}/>
              </div>
            </div>
          )}

          {/* Caixa CPFs — não apaga ao fechar */}
          {showCpfBox && (
            <div style={{ background:C.deep, borderRadius:12, padding:"14px", marginBottom:14, border:`1px solid ${C.b1}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <div style={{ color:C.ts, fontSize:12.5, fontWeight:700 }}>➕ Adicionar CPFs</div>
                <span style={{ color:C.td, fontSize:11 }}>Os CPFs digitados são mantidos até você limpar manualmente.</span>
              </div>
              <div style={{ color:C.td, fontSize:11, marginBottom:8 }}>Um por linha ou separados por vírgula. CPFs com menos de 11 dígitos serão completados com zeros.</div>
              <textarea value={cpfBox} onChange={e=>setCpfBoxPersist(e.target.value)}
                rows={6} placeholder={"12345678901\n98765432100"}
                style={{ ...S.input, resize:"vertical", fontFamily:"monospace", fontSize:12, width:"100%", marginBottom:8 }} />
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={adicionarCPFs} disabled={!cpfBox.trim()}
                  style={{ background:cpfBox.trim()?C.acc:C.deep, color:cpfBox.trim()?"#fff":C.td, border:"none", borderRadius:8, padding:"7px 16px", fontSize:12.5, fontWeight:600, cursor:cpfBox.trim()?"pointer":"not-allowed" }}>
                  ➕ Adicionar {cpfBox.trim().split(/[\n,;]+/).filter(Boolean).length} CPFs
                </button>
                <button onClick={()=>setCpfBoxPersist("")}
                  style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444422", borderRadius:8, padding:"7px 12px", fontSize:12.5, cursor:"pointer" }}>
                  🗑 Limpar caixa
                </button>
                <button onClick={()=>setShowCpfBox(false)}
                  style={{ background:"transparent", border:`1px solid ${C.b2}`, color:C.tm, borderRadius:8, padding:"7px 14px", fontSize:12.5, cursor:"pointer" }}>
                  Fechar
                </button>
              </div>
            </div>
          )}

          {/* Filtros */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div><label style={{ color:C.tm, fontSize:10.5, display:"block", marginBottom:3 }}>Saldo mín (R$)</label><input value={filterSaldo} onChange={e=>{setFilterSaldo(e.target.value);setPage(0);}} placeholder="Ex: 1000" style={{ ...S.input, width:100, fontSize:12, padding:"5px 9px" }}/></div>
            <div><label style={{ color:C.tm, fontSize:10.5, display:"block", marginBottom:3 }}>Oferta mín (R$)</label><input value={filterMargem} onChange={e=>{setFilterMargem(e.target.value);setPage(0);}} placeholder="Ex: 500" style={{ ...S.input, width:100, fontSize:12, padding:"5px 9px" }}/></div>
            <div><label style={{ color:C.tm, fontSize:10.5, display:"block", marginBottom:3 }}>Status</label>
              <select value={filterStatus} onChange={e=>{setFilterStatus(e.target.value);setPage(0);}} style={{ ...S.input, width:120, fontSize:12, padding:"5px 9px", cursor:"pointer" }}>
                {["Todos","pendente","ok","erro","simulando","saldo_zero"].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ paddingBottom:2, color:C.td, fontSize:11 }}>{filtered.length} resultado{filtered.length!==1?"s":""}</div>
          </div>
        </div>

        {/* Painel de detalhe ao clicar na linha */}
        {detalheItem && (
          <div style={{ background:"linear-gradient(135deg,#0f1f3d,#162a50)", border:"1px solid rgba(79,142,247,0.3)", borderRadius:16, padding:"20px 24px", marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div>
                <div style={{ color:"#fff", fontSize:13.5, fontWeight:700 }}>🔍 Detalhe — {detalheItem.cpf}</div>
                <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, marginTop:2 }}>
                  {detalheItem.ts||""} · {(detalheItem.balance?.provider||loteProvider)?.toUpperCase()}
                </div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button
                  onClick={async ()=>{
                    const ri=items.findIndex(x=>x.id===detalheItem.id);
                    if(ri<0) return;
                    const updated=await simularUm({...items[ri],status:"pendente"});
                    setItems(p=>{const n=[...p];n[ri]=updated;return n;});
                    setDetalheItem(updated);
                  }}
                  style={{ background:"rgba(79,142,247,0.2)", border:"1px solid rgba(79,142,247,0.35)", color:"#fff", borderRadius:8, padding:"5px 14px", cursor:"pointer", fontSize:12 }}>
                  🔄 Re-simular
                </button>
                <button onClick={()=>setDetalheItem(null)} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", borderRadius:7, padding:"5px 12px", cursor:"pointer", fontSize:12 }}>✕</button>
              </div>
            </div>

            {/* Info resumida */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8, marginBottom:18 }}>
              {[
                ["CPF", detalheItem.cpf],
                ["Saldo FGTS", fmtBRL(detalheItem.saldo||0)],
                ["Melhor Oferta", fmtBRL(detalheItem.margem||0)],
                ["Tabela", detalheItem.sim?.melhor?.label||"—"],
                ["Anos", detalheItem.sim?.anos||"—"],
                ["Status", detalheItem.status],
              ].map(([l,v])=>(
                <div key={l} style={{ background:"rgba(255,255,255,0.07)", borderRadius:9, padding:"8px 12px" }}>
                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>{l}</div>
                  <div style={{ color:"#fff", fontWeight:600, fontSize:13, marginTop:2 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Todas as tabelas simuladas — clicáveis para digitar */}
            {(detalheItem.sim?.allSims||[]).length > 0 ? (
              <div>
                <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:12 }}>
                  📊 {detalheItem.sim.allSims.length} tabelas simuladas — clique no balão para digitar
                </div>
                <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                  {[...detalheItem.sim.allSims]
                    .sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0))
                    .map((s,i)=>{
                      const isBest = s.label === detalheItem.sim?.melhor?.label;
                      const vlr    = parseFloat(s.sim?.availableBalance||0);
                      const emissao= parseFloat(s.sim?.emissionAmount||0);
                      const anos   = calcAnos(s.sim);
                      return (
                        <div key={i}
                          onClick={()=>{ if(!s.ok) return; const d={ tabela:{ label:s.label, sim:s.sim, feeId:s.sim?.id||"" }, balance:{ ...detalheItem.balance, id:detalheItem.sim?.balanceId }, cpf:detalheItem.cpf, provider:loteProvider, clientePreFill:detalheItem }; openDigModal(d); setLoteDigModal(d); }}
                          style={{
                            background: isBest?"rgba(52,211,153,0.15)":s.ok?"rgba(79,142,247,0.1)":"rgba(239,68,68,0.08)",
                            border:`2px solid ${isBest?"rgba(52,211,153,0.5)":s.ok?"rgba(79,142,247,0.3)":"rgba(239,68,68,0.2)"}`,
                            borderRadius:14, padding:"14px 18px", minWidth:150,
                            cursor:s.ok?"pointer":"default",
                            transition:"all 0.15s",
                            position:"relative",
                          }}
                          onMouseEnter={e=>{ if(s.ok){e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(0,0,0,0.4)";}}}
                          onMouseLeave={e=>{ e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none"; }}>
                          {isBest && (
                            <div style={{ position:"absolute", top:-11, left:"50%", transform:"translateX(-50%)", background:"linear-gradient(90deg,#34D399,#059669)", color:"#000", fontSize:9, fontWeight:800, padding:"2px 10px", borderRadius:99, whiteSpace:"nowrap", boxShadow:"0 2px 8px rgba(52,211,153,0.4)" }}>
                              🏆 MELHOR OFERTA
                            </div>
                          )}
                          <div style={{ color:"rgba(255,255,255,0.65)", fontSize:11.5, textTransform:"capitalize", marginBottom:6, marginTop:isBest?6:0, fontWeight:600 }}>
                            {s.label}
                          </div>
                          {s.ok ? (
                            <>
                              <div style={{ color:isBest?"#34D399":"#fff", fontWeight:900, fontSize:20, lineHeight:1, letterSpacing:"-0.5px" }}>{fmtBRL(vlr)}</div>
                              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:10.5, marginTop:3 }}>Valor liberado via PIX</div>
                              <div style={{ background:"rgba(255,255,255,0.1)", borderRadius:6, padding:"2px 8px", display:"inline-block", fontSize:10, color:"rgba(255,255,255,0.5)", marginTop:4 }}>emissão {fmtBRL(emissao)}</div>
                              <div style={{ color:"rgba(255,255,255,0.35)", fontSize:10, marginTop:3 }}>{anos}</div>
                              <div style={{ marginTop:10, background:"rgba(255,255,255,0.15)", borderRadius:8, padding:"5px 0", textAlign:"center", fontSize:11, fontWeight:800, color:"#fff", letterSpacing:"0.5px" }}>
                                📝 DIGITAR
                              </div>
                            </>
                          ) : (
                            <div style={{ color:"#F87171", fontSize:11, marginTop:4 }}>✘ {(s.err||"Erro").slice(0,35)}</div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div style={{ background:"rgba(251,191,36,0.1)", border:"1px solid rgba(251,191,36,0.2)", borderRadius:10, padding:"12px 16px" }}>
                <div style={{ color:"#FBBF24", fontSize:12.5, fontWeight:600 }}>⚠ Dados de tabelas não disponíveis para este item</div>
                <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11.5, marginTop:4 }}>Clique em 🔄 Re-simular para buscar todas as tabelas.</div>
              </div>
            )}

            {/* Erro */}
            {detalheItem.erro && (
              <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:9, padding:"10px 14px", marginTop:12 }}>
                <div style={{ color:"#F87171", fontWeight:600 }}>{detalheItem.erro}</div>
              </div>
            )}
          </div>
        )}

        {/* Barra de pesquisa + apagar cache */}
        <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
          <input value={loteSearch} onChange={e=>{setLoteSearch(e.target.value);setPage(0);}}
            placeholder="🔍 Pesquisar CPF ou nome..."
            style={{ ...S.input, flex:1, minWidth:200, fontSize:12.5, padding:"7px 12px" }}/>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <input id="lote_cache_cpf" placeholder="CPF para apagar cache"
              style={{ ...S.input, width:160, fontSize:12, padding:"6px 10px" }}
              onKeyDown={async e=>{
                if(e.key==="Enter"){
                  const cpfv = padCPF(e.target.value);
                  try { await apiFetch(`/fgts/balance/cache/${cpfv}`,"DELETE"); } catch {}
                  setItems(p=>p.map(x=>(x.cpfRaw===cpfv||x.cpf===fmtCPF(cpfv))?{...x,status:"pendente",saldo:null,margem:null,sim:null,erro:null}:x));
                  e.target.value="";
                }
              }}/>
            <button
              onClick={async ()=>{
                const inp = document.getElementById("lote_cache_cpf");
                if(!inp?.value.trim()) return;
                const cpfv = padCPF(inp.value);
                try { await apiFetch(`/fgts/balance/cache/${cpfv}`,"DELETE"); } catch {}
                setItems(p=>p.map(x=>(x.cpfRaw===cpfv||x.cpf===fmtCPF(cpfv))?{...x,status:"pendente",saldo:null,margem:null,sim:null,erro:null}:x));
                inp.value="";
              }}
              style={{ background:"#2D1515", color:"#F87171", border:"1px solid #EF444422", borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>
              🗑 Apagar cache
            </button>
          </div>
        </div>

        {/* Tabela */}
        <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, overflow:"hidden", marginBottom:12 }}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:C.deep }}>
                  {["#","Nome","CPF","Status","Saldo disponível","Melhor Oferta","Tabela","Qtd anos","Data simulação","Ação","DIGITAR"].map(h=>(
                    <th key={h} style={{ color:C.tm, fontWeight:700, padding:"9px 10px", textAlign:"left", borderBottom:`1px solid ${C.b1}`, whiteSpace:"nowrap", fontSize:10.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.map((it,idx)=>{
                  const ri = items.findIndex(x=>x.id===it.id);
                  const isSim = it.status==="simulando";
                  const stCol = STATUS_COL[it.status]||"#94A3B8";
                  const stBg  = STATUS_BG[it.status]||"#1a1a2e";
                  const isDetalhado = detalheItem?.id === it.id;
                  return (
                    <tr key={it.id}
                      onClick={()=>setDetalheItem(isDetalhado?null:it)}
                      style={{ background:isDetalhado?`${C.acc}15`:idx%2===0?C.card:C.deep, borderBottom:`1px solid ${C.b1}`, cursor:"pointer", opacity:isSim?0.85:1, transition:"background 0.1s" }}
                      onMouseEnter={e=>!isDetalhado&&(e.currentTarget.style.background=`${C.acc}08`)}
                      onMouseLeave={e=>e.currentTarget.style.background=isDetalhado?`${C.acc}15`:idx%2===0?C.card:C.deep}>
                      <td style={{ color:C.td, padding:"8px 10px", fontSize:11 }}>{page*PAGE_SIZE+idx+1}</td>
                      <td style={{ color:C.tp, fontWeight:600, padding:"8px 10px", maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.nome}</td>
                      <td style={{ color:C.tm, padding:"8px 10px", fontFamily:"monospace", fontSize:11 }}>{it.cpf||"—"}</td>
                      <td style={{ padding:"8px 10px" }}>
                        <span style={{ background:stBg, color:stCol, fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:600, whiteSpace:"nowrap" }}>
                          {STATUS_LABEL[it.status]||it.status}
                        </span>
                        {it.erro && <div style={{ color:"#F87171", fontSize:9.5, marginTop:2, maxWidth:120 }} title={it.erro}>{it.erro.slice(0,30)}</div>}
                      </td>
                      <td style={{ padding:"8px 10px", textAlign:"center" }}>
                        {it.saldo!=null && it.saldo>0
                          ? <span style={{ color:C.atxt, fontWeight:700, fontSize:12 }}>{fmtBRL(it.saldo)}</span>
                          : <span style={{ color:C.td }}>—</span>}
                      </td>
                      <td style={{ padding:"8px 10px", textAlign:"center" }}>
                        {it.margem!=null && it.margem>0
                          ? <span style={{ color:"#34D399", fontWeight:700, fontSize:12 }}>{fmtBRL(it.margem)}</span>
                          : <span style={{ color:C.td }}>—</span>}
                      </td>
                      <td style={{ color:C.td, padding:"8px 10px", fontSize:11, textTransform:"capitalize" }}>{it.sim?.melhor?.label||"—"}</td>
                      <td style={{ color:C.tm, padding:"8px 10px", fontSize:11 }}>{it.sim?.anos||"—"}</td>
                      <td style={{ color:C.td, padding:"8px 10px", fontSize:10.5 }}>{it.ts||"—"}</td>
                      <td style={{ padding:"8px 10px" }} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>{ const n=[...items]; simularUm(n[ri]).then(u=>{ n[ri]=u; setItems([...n]); }); }}
                          disabled={running||isSim}
                          style={{ background:"transparent", border:`1px solid ${C.b2}`, borderRadius:7, color:C.tm, cursor:"pointer", fontSize:11, padding:"3px 9px" }}>
                          {it.status==="ok"?"🔄":"▶"}
                        </button>
                      </td>
                      <td style={{ padding:"8px 10px" }} onClick={e=>e.stopPropagation()}>
                        {it.status==="ok" && it.sim?.melhor?.sim ? (
                          <button
                            onClick={()=>{ const d={ tabela:it.sim.melhor, balance:{ ...it.balance, id:it.sim.balanceId }, cpf:it.cpf, provider:loteProvider, clientePreFill:it }; openDigModal(d); setLoteDigModal(d); }}
                            style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:7, padding:"4px 11px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", letterSpacing:"0.3px" }}>
                            DIGITAR
                          </button>
                        ) : <span style={{ color:C.td, fontSize:10 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
                {pageItems.length===0 && (
                  <tr><td colSpan={11} style={{ color:C.td, textAlign:"center", padding:"32px", fontSize:13 }}>
                    {items.length===0 ? "Adicione CPFs usando o botão ➕ CPFs" : "Nenhum resultado para os filtros aplicados."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {totalPages>1 && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderTop:`1px solid ${C.b1}`, background:C.deep }}>
              <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
                style={{ background:page>0?C.abg:C.deep, color:page>0?C.atxt:C.td, border:`1px solid ${C.b2}`, borderRadius:8, padding:"6px 14px", fontSize:12, cursor:page>0?"pointer":"not-allowed" }}>
                ← Anteriores 50
              </button>
              <span style={{ color:C.tm, fontSize:12 }}>{page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,filtered.length)} de {filtered.length}</span>
              <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page===totalPages-1}
                style={{ background:page<totalPages-1?C.abg:C.deep, color:page<totalPages-1?C.atxt:C.td, border:`1px solid ${C.b2}`, borderRadius:8, padding:"6px 14px", fontSize:12, cursor:page<totalPages-1?"pointer":"not-allowed" }}>
                Próximos 50 →
              </button>
            </div>
          )}
        </div>

        {/* Log */}
        {logs.length>0 && (
          <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:12, padding:"12px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <div style={{ color:C.ts, fontSize:11.5, fontWeight:700 }}>📋 Log ({logs.length})</div>
              <button onClick={()=>setLogs([])} style={{ background:"none", border:"none", color:C.td, cursor:"pointer", fontSize:11 }}>Limpar</button>
            </div>
            <div style={{ maxHeight:180, overflowY:"auto", display:"flex", flexDirection:"column", gap:3 }}>
              {logs.map((l,i)=><div key={i} style={{ display:"flex", gap:8, fontSize:10.5 }}><span style={{ color:C.td, flexShrink:0 }}>{l.ts}</span><span style={{ color:l.ok?"#34D399":"#F87171" }}>{l.msg}</span></div>)}
            </div>
          </div>
        )}

        {loteDigModal && (
          <ModalDigitacaoRapida
            tabela={loteDigModal.tabela}
            balance={loteDigModal.balance}
            cpf={loteDigModal.cpf}
            provider={loteDigModal.provider}
            apiFetch={apiFetch}
            fmtBRL={fmtBRL}
            contacts={contacts}
            currentUser={currentUser}
            clientePreFill={loteDigModal.clientePreFill}
            step={modalStep} setStep={setModalStep}
            banks={modalBanks} setBanks={setModalBanks}
            payType={modalPayType} setPayType={setModalPayType}
            loading={modalLoading} setLoading={setModalLoading}
            result={modalResult} setResult={setModalResult}
            err={modalErr} setErr={setModalErr}
            cepLoading={modalCepLoading} setCepLoading={setModalCepLoading}
            bankSearch={modalBankSearch} setBankSearch={setModalBankSearch}
            initialForm={modalForm}
            setAcompData={setAcompData}
            onClose={()=>{ setLoteDigModal(null); }}
            onSuccess={(res)=>{ 
              setLoteDigModal(null); 
              setAcompData(null); 
              if (res) adicionarNaFila(res, {
                nome: loteDigModal?.clientePreFill?.name || loteDigModal?.clientePreFill?.nome || "",
                cpf: loteDigModal?.cpf || "",
                valorLiberado: loteDigModal?.tabela?.sim?.availableBalance || 0,
                provider: loteDigModal?.provider || "",
              });
              setAba("acompanhamento"); 
            }}
          />
        )}
      </div>
    );
  };


  // ════════════════════════════════════════════════════════════
  // RENDER PRINCIPAL
  // ════════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════════
  // ABA: ACOMPANHAMENTO DE PROPOSTAS V8
  // ════════════════════════════════════════════════════════════
  const AcompanhamentoTab = () => {
    const search   = acompSearch;   const setSearch   = setAcompSearch;
    const status   = acompStatus;   const setStatus   = setAcompStatus;
    const provider = acompProvider; const setProvider = setAcompProvider;
    // page/setPage mantidos para paginação futura
    const data     = acompData;     const setData     = setAcompData;
    const loading  = acompLoading;  const setLoading  = setAcompLoading;
    const err      = acompErr;      const setErr      = setAcompErr;
    const detalhe  = acompDetalhe;  const setDetalhe  = setAcompDetalhe;
    const copied   = acompCopied;   const setCopied   = setAcompCopied;
    const dateFrom = acompDateFrom; const setDateFrom = setAcompDateFrom;
    const dateTo   = acompDateTo;   const setDateTo   = setAcompDateTo;

    // ── Fila de formalização com acesso ao estado pai ──
    const fila = filaFormalizacao;

    // Cruza fila com dados da API — atualiza automaticamente
    const cruzarFilaComAPI = (apiRows) => {
      if (!apiRows || apiRows.length === 0) return;
      const filaAtual = filaFormalizacao;
      let houveMudanca = false;
      const filaAtualizada = filaAtual.map(item => {
        if (item.status !== "formalization") return item; // já resolvido
        const cpfItem = (item.cpf||"").replace(/\D/g,"");
        const valorItem = parseFloat(item.valor||0);
        // Busca match por CPF na API
        const match = apiRows.find(r => {
          const cpfApi = (r.documentNumber||r.individualDocumentNumber||"").replace(/\D/g,"");
          const valorApi = parseFloat(r.disbursedIssueAmount||0);
          const cpfBate = cpfItem && cpfApi && cpfItem === cpfApi;
          // Match por CPF + (valor aproximado OU mesmo ID de proposta)
          const valorBate = Math.abs(valorItem - valorApi) < 5; // tolerância de R$5
          const idBate = item.v8ProposalId && r.id === item.v8ProposalId;
          return cpfBate && (valorBate || idBate);
        });
        if (!match) return item;
        if (match.status === "paid" && item.status !== "paid") {
          houveMudanca = true;
          return { ...item, status:"paid", contractNumber: match.contractNumber||item.contractNumber, resolvidoEm: Date.now() };
        }
        if ((match.status === "canceled" || match.status === "cancelled") && item.status !== "canceled") {
          houveMudanca = true;
          return { ...item, status:"canceled", resolvidoEm: Date.now() };
        }
        return item;
      });
      if (houveMudanca) salvarFilaLocal(filaAtualizada);
    };

    // Cancelar proposta da fila
    const [cancelandoId, setCancelandoId] = useState(null);
    const [showCancelModal, setShowCancelModal] = useState(null);
    const [cancelReason, setCancelReason] = useState("invalid_data:other");
    const [cancelDesc, setCancelDesc] = useState("");

    const cancelarDaFila = async (item) => {
      setCancelandoId(item.id);
      try {
        // Usa v8ProposalId (UUID da V8). Se for igual ao id local (timestamp), busca na API
        let proposalId = item.v8ProposalId || item.id;

        // Verifica se é um UUID válido (formato da V8) — se não for, busca pela API
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proposalId);
        if (!isUUID && item.cpf) {
          // Busca pelo CPF para encontrar o ID correto da proposta na V8
          const cpfLimpo = item.cpf.replace(/\D/g,"").padStart(11,"0");
          const res = await apiFetch(`/fgts/proposal?search=${cpfLimpo}&page=1&limit=5`);
          const rows = res?.data || res || [];
          // Pega a proposta em formalização mais recente
          const found = rows.find(r => r.status==="formalization") || rows[0];
          if (found?.id) proposalId = found.id;
          else throw new Error("Proposta não encontrada na API. Verifique o CPF.");
        }

        await apiFetch(`/fgts/proposal/${proposalId}/cancel`, "PATCH", {
          reason: cancelReason,
          description: cancelDesc || "Cancelamento solicitado pelo operador.",
        });
        const atualizada = fila.map(f => f.id === item.id
          ? { ...f, status:"canceled", v8ProposalId: proposalId, resolvidoEm: Date.now() }
          : f
        );
        salvarFilaLocal(atualizada);
        setShowCancelModal(null);
        setCancelDesc("");
      } catch(e) {
        alert("Erro ao cancelar: " + e.message);
      }
      setCancelandoId(null);
    };

    const removerDaFila = (id) => {
      const atualizada = fila.filter(f => f.id !== id);
      salvarFilaLocal(atualizada);
    };

    const STATUS_LABEL = { formalization:"Formalização", analysis:"Em Análise", manual_analysis:"Análise Manual", pending:"Pendente", processing:"Processando", paid:"Pago", canceled:"Cancelado", refounded:"Devolvido" };
    const STATUS_COLOR = { paid:"#34D399", canceled:"#F87171", pending:"#FBBF24", processing:"#60A5FA", formalization:"#C084FC", analysis:"#60A5FA", manual_analysis:"#FB923C", refounded:"#94A3B8" };

    const STATUS_VARIANTS = {
      formalization:  ["formalization","aguardando_form","awaiting_formalization","pending_formalization","in_formalization","formalizacao"],
      analysis:       ["analysis","in_analysis","under_analysis"],
      manual_analysis:["manual_analysis","manual_review"],
      pending:        ["pending"],
      processing:     ["processing","in_progress"],
      paid:           ["paid"],
      canceled:       ["canceled","cancelled"],
      refounded:      ["refounded","refunded"],
    };

    const matchStatus = (rowStatus, filterStatus) => {
      if (!filterStatus) return true;
      const rv = (rowStatus||"").toLowerCase().trim();
      if (rv === filterStatus) return true;
      const variants = STATUS_VARIANTS[filterStatus] || [];
      return variants.includes(rv);
    };

    const getStatusLabel = (s) => {
      if (!s) return "—";
      const sl = s.toLowerCase().trim();
      for (const [key, variants] of Object.entries(STATUS_VARIANTS)) {
        if (sl === key || variants.includes(sl)) return STATUS_LABEL[key] || key;
      }
      return s.charAt(0).toUpperCase() + s.slice(1);
    };

    const getStatusColor = (s) => {
      if (!s) return "#94A3B8";
      const sl = s.toLowerCase().trim();
      for (const [key, variants] of Object.entries(STATUS_VARIANTS)) {
        if (sl === key || variants.includes(sl)) return STATUS_COLOR[key] || "#94A3B8";
      }
      return "#94A3B8";
    };

    // Helpers de data
    const toISO = (d) => d.toISOString().split("T")[0];
    const hoje  = toISO(new Date());
    const h3dias = toISO(new Date(Date.now() - 3*24*60*60*1000));

    const buscar = async (pg=1, statusOverride, fromOverride, toOverride) => {
      setLoading(true); setErr("");
      const s  = statusOverride !== undefined ? statusOverride : status;
      const df = fromOverride  !== undefined ? fromOverride  : dateFrom;
      const dt = toOverride    !== undefined ? toOverride    : dateTo;
      const statusSuportadoAPI = ["paid","canceled","processing","pending","analysis","manual_analysis","refounded"];
      const apiStatus = s && statusSuportadoAPI.includes(s) ? s : "";
      try {
        let allRows = [];
        const q = search.trim();
        const maxPages = (df||dt) ? 20 : 60; // com data: 20 pgs; sem: tudo
        let curPage = 1;
        while (curPage <= maxPages) {
          const params = new URLSearchParams({ page:curPage, limit:50 });
          if (q) { const d=q.replace(/\D/g,""); params.append("search",d.length>=6?d:q); }
          if (provider) params.append("provider", provider);
          if (apiStatus) params.append("status", apiStatus);
          if (df) { params.append("startDate", df); params.append("createdAtFrom", df); }
          if (dt) { params.append("endDate", dt+"T23:59:59"); params.append("createdAtTo", dt+"T23:59:59"); }
          const res = await apiFetch(`/fgts/proposal?${params}`);
          const rows = res?.data || [];
          allRows = [...allRows, ...rows];
          if (rows.length < 50) break;
          curPage++;
        }
        // Remove duplicatas e ordena decrescente
        const seen = new Set();
        allRows = allRows.filter(r=>{ if(seen.has(r.id)) return false; seen.add(r.id); return true; });
        const getTs = v => typeof v==='number'?v:(v?new Date(v).getTime():0);
        allRows.sort((a,b)=>getTs(b.createdAt||b.created_at)-getTs(a.createdAt||a.created_at));
        const PS=50, totalPages=Math.max(1,Math.ceil(allRows.length/PS));
        const pageRows=allRows.slice((pg-1)*PS,pg*PS);
        setData({data:pageRows,_all:allRows,pages:{current:pg,hasNext:pg<totalPages,hasPrev:pg>1,total:allRows.length,totalPages}});
        cruzarFilaComAPI(allRows);
        // Enrich CPFs — persiste em data e _all
        const semCpf = pageRows.filter(r=>!(r.documentNumber||r.individualDocumentNumber));
        if (semCpf.length>0) {
          (async()=>{
            const eP=[...pageRows], eA=[...allRows];
            for (const op of semCpf.slice(0,20)) {
              try {
                const det=await apiFetch(`/fgts/proposal/${op.id}`);
                const merged={...op,...det};
                const ip=eP.findIndex(r=>r.id===op.id); if(ip>=0) eP[ip]=merged;
                const ia=eA.findIndex(r=>r.id===op.id); if(ia>=0) eA[ia]=merged;
              } catch {}
            }
            setData(prev=>prev?{...prev,data:eP,_all:eA}:prev);
          })();
        }
      } catch(e) { setErr(e.message); }
      setLoading(false);
    };

    // Auto-carrega ao entrar na aba
    useEffect(() => {
      if (!acompData && !acompLoading) buscar(1, undefined, "", "");
    }, []); // eslint-disable-line

    const gerarNovoLink = async (id) => {
      setAcompLinkLoading(true);
      try {
        // Passa body vazio {} — API exige Content-Type application/json com body válido
        const res = await apiFetch(`/fgts/proposal/${id}/formalization-link`, "POST", {});
        const link = res?.formalizationLink || res?.link || res?.url || res?.data?.formalizationLink || "";
        if (!link) throw new Error("Link não retornado pela API. Tente novamente.");
        setAcompLinkModal({ id, link });
        // Atualiza o item na lista
        setData(p => p ? { ...p, data: (p.data||[]).map(op => op.id===id ? { ...op, formalizationLink: link } : op) } : p);
        // Atualiza também na fila de formalização
        const filaAtual = filaFormalizacao;
        const filaAtualizada = filaAtual.map(f => f.v8ProposalId === id ? { ...f, formalizationLink: link } : f);
        salvarFilaLocal(filaAtualizada);
      } catch(e) { setErr("⚠ Erro ao gerar link: " + e.message); }
      setAcompLinkLoading(false);
    };

    const copiarLink = (id, link) => {
      if (!link) return;
      navigator.clipboard.writeText(link).then(()=>{ setCopied(id); setTimeout(()=>setCopied(null),2500); }).catch(()=>{
        const el = document.createElement("textarea"); el.value = link; document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
        setCopied(id); setTimeout(()=>setCopied(null),2500);
      });
    };

    // Proposta paga ou cancelada não pode gerar/atualizar link
    const canGenerateLink = (op) => !matchStatus(op?.status,"paid") && !matchStatus(op?.status,"canceled");

    return (
      <div>
        {/* Header */}
        <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"18px 20px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12, flexWrap:"wrap", gap:10 }}>
            <div>
              <div style={{ color:C.ts, fontSize:14, fontWeight:700 }}>📡 Acompanhamento de Propostas V8</div>
              <div style={{ color:C.tm, fontSize:12, marginTop:3 }}>
                Propostas digitadas, status em tempo real, links de formalização.
                {data?.pages && <span style={{ color:C.td, marginLeft:8 }}>· {data.pages.total||0} resultado{data.pages.total!==1?"s":""}</span>}
              </div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>{
                // Export to CSV with all available data
                const rows = [...fila.map(f=>({
                  Nome: f.clientName||"", CPF: f.cpf||"", Contrato: f.contractNumber||"",
                  Status:"Formalização", Valor: f.valor||0, Provider: f.provider||"",
                  Link: f.formalizationLink||"", Adicionado: f.criadoEmStr||""
                })), ...(data?.data||[]).map(op=>({
                  Nome: op.clientName||op.name||"", CPF:(op.documentNumber||op.individualDocumentNumber||"").replace(/\D/g,"").padStart(11,"0"),
                  Contrato: op.contractNumber||"", Status: op.status||"", Valor: op.disbursedIssueAmount||0,
                  Provider: op.provider||"", Link: op.formalizationLink||"",
                  Email: op.email||"", Telefone: op.phone?(op.phoneRegionCode||"")+op.phone:"",
                  Parceiro: op.partnerId||"", Criado: op.createdAt?new Date(op.createdAt).toLocaleString("pt-BR"):""
                }))];
                const header = Object.keys(rows[0]||{}).join(";");
                const body = rows.map(r=>Object.values(r).map(v=>`"${String(v).replace(/"/g,'""')}"`).join(";")).join("\n");
                const blob = new Blob(["\uFEFF"+header+"\n"+body], {type:"text/csv;charset=utf-8"});
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href=url; a.download=`propostas_${new Date().toLocaleDateString("pt-BR").replace(/\//g,"-")}.csv`; a.click();
                URL.revokeObjectURL(url);
              }}
                style={{ background:"rgba(52,211,153,0.1)", color:"#34D399", border:"1px solid #34D39933", borderRadius:9, padding:"9px 16px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                📥 Exportar CSV
              </button>
              <button onClick={()=>buscar(1)} disabled={loading}
                style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"9px 20px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:loading?0.6:1 }}>
                {loading?"⏳":"🔄"} {loading?"Buscando...":"Atualizar"}
              </button>
            </div>
          </div>

          {/* Filtros rápidos — apenas os 3 status relevantes */}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
            {[
              { label:"Todos",                      value:"",         color:C.atxt,    bg:C.abg },
              { label:"⏳ Aguardando Formalização",  value:"formalization", color:"#C084FC", bg:"rgba(192,132,252,0.12)" },
              { label:"✅ Pago",                     value:"paid",     color:"#34D399", bg:"rgba(52,211,153,0.12)" },
              { label:"❌ Cancelado",                value:"canceled", color:"#F87171", bg:"rgba(239,68,68,0.12)" },
            ].map(f=>(
              <button key={f.value} onClick={()=>{ setStatus(f.value); buscar(1, f.value); }}
                style={{ background:status===f.value?f.bg:"transparent", color:status===f.value?f.color:C.td, border:`1px solid ${status===f.value?f.color+"55":C.b2}`, borderRadius:20, padding:"5px 18px", fontSize:12, fontWeight:status===f.value?700:400, cursor:"pointer", whiteSpace:"nowrap" }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Aviso formalização removido conforme solicitado */}

          {/* Busca + Filtros + Data */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ flex:1, minWidth:180 }}>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Buscar (nome, CPF ou contrato)</label>
              <input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&buscar(1)}
                placeholder="Nome, CPF (com ou sem pontos) ou nº contrato" autoComplete="off" style={{ ...S.input }} />
            </div>
            <div>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Provider</label>
              <select value={provider} onChange={e=>setProvider(e.target.value)} style={{ ...S.input, cursor:"pointer" }}>
                <option value="">Todos</option>
                {["qi","cartos","bms"].map(p=><option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>De</label>
              <input type="date" value={dateFrom}
                onChange={e=>{ setDateFrom(e.target.value); }}
                onBlur={e=>{ if(e.target.value) buscar(1, undefined, e.target.value, dateTo); }}
                style={{ ...S.input, cursor:"pointer", width:150, colorScheme:"dark" }} />
            </div>
            <div>
              <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Até</label>
              <input type="date" value={dateTo}
                onChange={e=>{ setDateTo(e.target.value); }}
                onBlur={e=>{ if(e.target.value) buscar(1, undefined, dateFrom, e.target.value); }}
                style={{ ...S.input, cursor:"pointer", width:150, colorScheme:"dark" }} />
            </div>
            {/* Atalhos de data */}
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ color:C.tm, fontSize:11 }}>Atalho</label>
              <div style={{ display:"flex", gap:5 }}>
                {[
                  { l:"Hoje",    f:hoje,    t:hoje },
                  { l:"7 dias",  f:toISO(new Date(Date.now()-7*24*60*60*1000)), t:hoje },
                  { l:"30 dias", f:toISO(new Date(Date.now()-30*24*60*60*1000)), t:hoje },
                  { l:"Nov/25",  f:"2025-11-01", t:"2025-11-30" },
                  { l:"Dez/25",  f:"2025-12-01", t:"2025-12-31" },
                  { l:"Jan/26",  f:"2026-01-01", t:"2026-01-31" },
                  { l:"Fev/26",  f:"2026-02-01", t:"2026-02-28" },
                  { l:"Mar/26",  f:"2026-03-01", t:hoje },
                ].map(a=>(
                  <button key={a.l} onClick={()=>{ setDateFrom(a.f); setDateTo(a.t); buscar(1, undefined, a.f, a.t); }}
                    style={{ background:(dateFrom===a.f&&dateTo===a.t)?C.abg:C.deep, color:(dateFrom===a.f&&dateTo===a.t)?C.atxt:C.td, border:`1px solid ${(dateFrom===a.f&&dateTo===a.t)?C.atxt+"44":C.b2}`, borderRadius:7, padding:"4px 10px", fontSize:11, cursor:"pointer", whiteSpace:"nowrap" }}>
                    {a.l}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={()=>buscar(1)} disabled={loading}
              style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"9px 20px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:loading?0.6:1, alignSelf:"flex-end" }}>
              🔍 Buscar
            </button>
            {(search||status||provider) && (
              <button onClick={()=>{ setSearch(""); setStatus(""); setProvider(""); setDateFrom(h3dias); setDateTo(hoje); buscar(1,"",h3dias,hoje); }}
                style={{ background:C.deep, color:C.td, border:`1px solid ${C.b2}`, borderRadius:9, padding:"9px 14px", fontSize:12, cursor:"pointer", alignSelf:"flex-end" }}>
                ✕ Limpar
              </button>
            )}
          </div>
          <div style={{ color:C.td, fontSize:10.5, marginTop:8 }}>
            📅 {(dateFrom||dateTo) ? `Filtrando de ${dateFrom||"início"} até ${dateTo||"hoje"}` : "Exibindo todas as propostas — use os filtros de data para restringir o período."}
          </div>
          {err && <div style={{ color:"#F87171", marginTop:8, fontSize:12 }}>⚠ {err}</div>}
        </div>

        {/* Modal de link */}
        {acompLinkModal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:18, padding:"24px", width:"100%", maxWidth:520 }}>
              <div style={{ color:C.ts, fontSize:14, fontWeight:700, marginBottom:16 }}>🔗 Link de Formalização</div>
              {acompLinkModal.link ? (
                <div>
                  <div style={{ background:C.deep, borderRadius:10, padding:"12px 14px", marginBottom:14, wordBreak:"break-all" }}>
                    <div style={{ color:C.td, fontSize:10, marginBottom:4 }}>URL de Formalização:</div>
                    <a href={acompLinkModal.link} target="_blank" rel="noreferrer"
                      style={{ color:C.atxt, fontSize:12, fontFamily:"monospace" }}>{acompLinkModal.link}</a>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>copiarLink(acompLinkModal.id, acompLinkModal.link)}
                      style={{ flex:1, background:C.abg, color:C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:9, padding:"11px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                      {copied===acompLinkModal.id?"✅ Copiado!":"📋 Copiar Link"}
                    </button>
                    <button onClick={()=>window.open(acompLinkModal.link,"_blank")}
                      style={{ flex:1, background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"11px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                      🔗 Abrir Link
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ color:C.tm, fontSize:12.5 }}>Nenhum link disponível para esta proposta.</div>
              )}
              <button onClick={()=>setAcompLinkModal(null)}
                style={{ width:"100%", background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:9, padding:"10px", marginTop:12, fontSize:13, cursor:"pointer" }}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* Detalhe REMOVIDO do topo — agora é inline na tabela abaixo de cada linha */}

        {/* Modal de Simulação */}
        {acompSimModal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div style={{ background:"linear-gradient(135deg,#0f1f3d,#162a50)", border:"1px solid rgba(79,142,247,0.3)", borderRadius:18, padding:"24px", width:"100%", maxWidth:660, maxHeight:"90vh", overflowY:"auto" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ color:"#fff", fontSize:14, fontWeight:700 }}>⚡ Nova Simulação — {acompSimModal.nome||acompSimModal.cpf}</div>
                  <div style={{ color:"rgba(255,255,255,0.5)", fontSize:12, marginTop:2 }}>CPF: {(acompSimModal.cpf||"").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4")}</div>
                </div>
                <button onClick={()=>setAcompSimModal(null)} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>✕</button>
              </div>
              {acompSimModal.loading ? (
                <div style={{ textAlign:"center", padding:"40px 0" }}>
                  <div style={{ color:"#60A5FA", fontSize:32, marginBottom:12 }}>⏳</div>
                  <div style={{ color:"rgba(255,255,255,0.7)", fontSize:13 }}>Consultando saldo FGTS e simulando tabelas...</div>
                </div>
              ) : acompSimModal.err ? (
                <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:10, padding:"14px", color:"#F87171" }}>❌ {acompSimModal.err}</div>
              ) : acompSimModal.sims ? (
                <div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                    <div style={{ background:"rgba(255,255,255,0.07)", borderRadius:10, padding:"12px 16px" }}>
                      <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11 }}>Saldo FGTS disponível</div>
                      <div style={{ color:"#fff", fontSize:22, fontWeight:900 }}>{fmtBRL(acompSimModal.saldo||0)}</div>
                    </div>
                    {acompSimModal.best && (
                      <div style={{ background:"rgba(52,211,153,0.1)", border:"1px solid rgba(52,211,153,0.3)", borderRadius:10, padding:"12px 16px" }}>
                        <div style={{ color:"#34D399", fontSize:11, fontWeight:700 }}>✅ MELHOR — {acompSimModal.best.label}</div>
                        <div style={{ color:"#34D399", fontSize:22, fontWeight:900 }}>{fmtBRL(acompSimModal.best.sim?.availableBalance||0)}</div>
                        <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10.5, marginTop:2 }}>via PIX · {calcAnos(acompSimModal.best.sim)}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:10 }}>Clique para digitar</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {[...(acompSimModal.sims||[])].sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0)).map((s,i)=>{
                      const isBest = s.label===acompSimModal.best?.label;
                      return (
                        <div key={i}
                          onClick={()=>{
                            if(!s.ok)return;
                            const d={tabela:{label:s.label,sim:s.sim,feeId:""},balance:{...acompSimModal.bal,id:acompSimModal.bal?.id},cpf:acompSimModal.cpf,provider:acompSimModal.contrato?.provider||loteProvider,clientePreFill:{cpf:acompSimModal.cpf,nome:acompSimModal.nome,clienteV8:acompSimModal.contrato}};
                            openDigModal(d); setIndDigModal(d); setAcompSimModal(null);
                          }}
                          style={{ background:isBest?"rgba(52,211,153,0.12)":"rgba(79,142,247,0.08)", border:`2px solid ${isBest?"rgba(52,211,153,0.4)":"rgba(79,142,247,0.2)"}`, borderRadius:12, padding:"10px 14px", minWidth:130, cursor:s.ok?"pointer":"default", position:"relative", transition:"all 0.12s" }}
                          onMouseEnter={e=>{if(s.ok){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 6px 20px rgba(0,0,0,0.3)";}}}
                          onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
                          {isBest&&<div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",background:"#34D399",color:"#000",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,whiteSpace:"nowrap"}}>🏆 MELHOR</div>}
                          {s.ok?<>
                            <div style={{color:isBest?"#34D399":"rgba(255,255,255,0.9)",fontWeight:900,fontSize:20,lineHeight:1,marginTop:isBest?8:0}}>{fmtBRL(s.sim?.availableBalance||0)}</div>
                            <div style={{color:"rgba(255,255,255,0.45)",fontSize:10,marginTop:3}}>Valor liberado via PIX</div>
                            <div style={{color:"rgba(255,255,255,0.65)",fontSize:10.5,marginTop:4,fontWeight:700}}>{calcAnos(s.sim)} de antecipação</div>
                            <div style={{color:"rgba(255,255,255,0.5)",fontSize:10,marginTop:2,textTransform:"capitalize"}}>Tabela {s.label}</div>
                            <div style={{marginTop:8,background:"rgba(255,255,255,0.15)",borderRadius:6,padding:"4px 0",textAlign:"center",fontSize:10.5,fontWeight:800,color:"#fff"}}>📝 DIGITAR</div>
                          </>:<>
                            <div style={{color:"rgba(255,255,255,0.5)",fontSize:10.5,textTransform:"capitalize",marginBottom:4}}>{s.label}</div>
                            <div style={{color:"#F87171",fontSize:11}}>✘</div>
                          </>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}


        {/* Modal de cancelamento da fila */}
        {showCancelModal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div style={{ background:C.card, border:`1px solid #EF444433`, borderRadius:16, padding:"24px", width:"100%", maxWidth:440 }}>
              <div style={{ color:"#F87171", fontSize:15, fontWeight:700, marginBottom:8 }}>❌ Cancelar Proposta</div>
              <div style={{ color:C.tm, fontSize:12.5, marginBottom:16 }}>
                Cliente: <strong style={{ color:C.tp }}>{showCancelModal.clientName||"—"}</strong><br/>
                CPF: <span style={{ fontFamily:"monospace" }}>{(showCancelModal.cpf||"").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4")}</span>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:5 }}>Motivo *</label>
                <select value={cancelReason} onChange={e=>setCancelReason(e.target.value)} style={{ ...S.input }}>
                  <option value="invalid_data:other">Outros</option>
                  <option value="invalid_data:invalid_address">Endereço incorreto</option>
                  <option value="invalid_data:incomplete_name">Nome incompleto</option>
                  <option value="invalid_data:invalid_name">Nome incorreto</option>
                </select>
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:5 }}>Descrição (opcional)</label>
                <input value={cancelDesc} onChange={e=>setCancelDesc(e.target.value)}
                  placeholder="Descreva o motivo do cancelamento..."
                  style={{ ...S.input }} />
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>cancelarDaFila(showCancelModal)} disabled={!!cancelandoId}
                  style={{ flex:1, background:"linear-gradient(135deg,#DC2626,#B91C1C)", color:"#fff", border:"none", borderRadius:9, padding:"11px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:cancelandoId?0.6:1 }}>
                  {cancelandoId?"⏳ Cancelando...":"✕ Confirmar Cancelamento"}
                </button>
                <button onClick={()=>{setShowCancelModal(null);setCancelDesc("");}}
                  style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:9, padding:"11px 16px", fontSize:13, cursor:"pointer" }}>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Tabela — sempre visível, mostra loading ou dados */}
        <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, overflow:"hidden" }}>
          {loading && (
            <div style={{ textAlign:"center", padding:"32px", color:C.tm, fontSize:13 }}>
              ⏳ Carregando propostas...
            </div>
          )}
          {err && !loading && (
            <div style={{ padding:"16px 20px", color:"#F87171", fontSize:12.5 }}>⚠ {err}</div>
          )}
          {!loading && (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:C.deep }}>
                    {["Cliente","CPF","Contrato","Status","Valor","Provider","Link Formalização","Ações"].map(h=>(
                      <th key={h} style={{ color:C.tm, fontWeight:700, padding:"9px 12px", textAlign:"left", borderBottom:`1px solid ${C.b1}`, whiteSpace:"nowrap", fontSize:10.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* ── Fila de Formalização ── */}
                  {(!status || status === "formalization") && [...fila].sort((a,b)=>b.criadoEm-a.criadoEm).map((item) => {
                    const stCol = item.status==="paid"?"#34D399":item.status==="canceled"?"#F87171":"#C084FC";
                    const stLabel = item.status==="paid"?"✅ Pago":item.status==="canceled"?"❌ Cancelado":"⏳ Formalização";
                    const isSel = detalhe?.id===item.id && detalhe?._filaItem;
                    const cpfFmt = (item.cpf||"").replace(/\D/g,"").padStart(11,"0").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4");
                    return (
                      <React.Fragment key={`fila_${item.id}`}>
                        <tr
                          onClick={()=>setDetalhe(isSel?null:{...item,_filaItem:true})}
                          style={{ background:isSel?"rgba(192,132,252,0.15)":"rgba(192,132,252,0.04)", borderBottom:`1px solid ${C.b1}`, cursor:"pointer", borderLeft:"3px solid #C084FC66" }}>
                          <td style={{ color:C.tp, fontWeight:600, padding:"10px 12px", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.clientName||"—"}</td>
                          <td style={{ color:C.tm, padding:"10px 12px", fontFamily:"monospace", fontSize:11 }}>{cpfFmt}</td>
                          <td style={{ color:C.td, padding:"10px 12px", fontFamily:"monospace", fontSize:11 }}>{item.contractNumber||"—"}</td>
                          <td style={{ padding:"10px 12px" }}>
                            <span style={{ background:stCol+"22", color:stCol, fontSize:10, padding:"3px 10px", borderRadius:20, fontWeight:700 }}>{stLabel}</span>
                          </td>
                          <td style={{ color:C.atxt, fontWeight:700, padding:"10px 12px" }}>{fmtBRL(item.valor||0)}</td>
                          <td style={{ color:C.td, padding:"10px 12px", fontSize:11, textTransform:"uppercase" }}>{item.provider||"—"}</td>
                          <td style={{ padding:"10px 12px" }} onClick={e=>e.stopPropagation()}>
                            {item.formalizationLink
                              ? <button onClick={()=>{navigator.clipboard.writeText(item.formalizationLink);setCopied(item.id);setTimeout(()=>setCopied(null),2000);}}
                                  style={{ background:C.abg, color:copied===item.id?"#34D399":C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:7, padding:"3px 10px", fontSize:10.5, fontWeight:700, cursor:"pointer" }}>
                                  {copied===item.id?"✅ Copiado":"📋 Copiar"}
                                </button>
                              : <span style={{ color:C.td, fontSize:11 }}>—</span>
                            }
                          </td>
                          <td style={{ padding:"10px 12px" }} onClick={e=>e.stopPropagation()}>
                            <button onClick={()=>document.getElementById("fila_del_"+item.id).style.display="flex"}
                              style={{ background:"rgba(239,68,68,0.08)", color:"#F87171", border:"1px solid #EF444422", borderRadius:7, padding:"4px 10px", fontSize:10.5, cursor:"pointer" }}>
                              🗑 Remover
                            </button>
                          </td>
                        </tr>
                        {/* Modal confirmação remover da fila */}
                        <div id={"fila_del_"+item.id} style={{ display:"none", position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:2000, alignItems:"center", justifyContent:"center" }}>
                          <div style={{ background:C.card, border:`1px solid #EF444433`, borderRadius:20, padding:"28px 32px", maxWidth:380, width:"90%", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
                            <div style={{ fontSize:36, marginBottom:10 }}>🗑</div>
                            <div style={{ color:C.tp, fontSize:16, fontWeight:800, marginBottom:6 }}>Remover proposta?</div>
                            <div style={{ color:C.tm, fontSize:12.5, marginBottom:20, lineHeight:1.6 }}>
                              <strong style={{ color:C.tp }}>{item.clientName||item.cpf}</strong> será removido da fila permanentemente.
                            </div>
                            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                              <button onClick={()=>document.getElementById("fila_del_"+item.id).style.display="none"}
                                style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:9, padding:"9px 22px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Cancelar</button>
                              <button onClick={()=>{ removerDaFila(item.id); document.getElementById("fila_del_"+item.id).style.display="none"; }}
                                style={{ background:"linear-gradient(135deg,#DC2626,#B91C1C)", color:"#fff", border:"none", borderRadius:9, padding:"9px 22px", fontSize:13, fontWeight:700, cursor:"pointer" }}>✕ Remover</button>
                            </div>
                          </div>
                        </div>
                        {/* Detalhe inline da fila */}
                        {isSel && (
                          <tr>
                            <td colSpan={8} style={{ padding:0, background:"rgba(192,132,252,0.08)", borderBottom:`2px solid #C084FC44` }}>
                              <div style={{ padding:"16px 20px" }}>
                                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8, marginBottom:12 }}>
                                  {[
                                    ["Cliente", item.clientName||"—"],
                                    ["CPF", cpfFmt],
                                    ["Contrato", item.contractNumber||"—"],
                                    ["Status", stLabel],
                                    ["Valor", fmtBRL(item.valor||0)],
                                    ["Provider", (item.provider||"—").toUpperCase()],
                                    ["Adicionado em", item.criadoEm ? new Date(item.criadoEm).toLocaleString("pt-BR",{"day":"2-digit","month":"2-digit","year":"numeric","hour":"2-digit","minute":"2-digit"}) : (item.criadoEmStr||"—")],
                                  ].map(([l,v])=>(
                                    <div key={l} style={{ background:C.card, borderRadius:8, padding:"8px 12px" }}>
                                      <div style={{ color:C.td, fontSize:10 }}>{l}</div>
                                      <div style={{ color:C.tp, fontWeight:600, fontSize:12.5, marginTop:2 }}>{v}</div>
                                    </div>
                                  ))}
                                </div>
                                {item.formalizationLink && (
                                  <div style={{ background:C.card, borderRadius:8, padding:"10px 14px" }}>
                                    <div style={{ color:C.td, fontSize:10, marginBottom:6, textTransform:"uppercase" }}>Link de Formalização</div>
                                    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                                      <a href={item.formalizationLink} target="_blank" rel="noreferrer"
                                        style={{ color:C.atxt, fontSize:11, fontFamily:"monospace", wordBreak:"break-all", flex:1 }}>{item.formalizationLink}</a>
                                      <button onClick={()=>copiarLink(item.id,item.formalizationLink)}
                                        style={{ background:C.abg, color:C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:7, padding:"5px 12px", fontSize:11, cursor:"pointer", whiteSpace:"nowrap" }}>
                                        {copied===item.id?"✅ Copiado":"📋 Copiar"}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* ── Propostas da API ── */}
                  {status !== "formalization" && (data?.data||[]).map((op) => {
                    const stCol = getStatusColor(op.status);
                    const isSel = detalhe?.id===op.id && !detalhe?._filaItem;
                    const hasLink = !!op.formalizationLink;
                    // CPF da listagem pode vir vazio — só mostra se tiver dados reais
                    const cpfRaw = (op.documentNumber||op.individualDocumentNumber||"").replace(/\D/g,"");
                    const cpfFmt = cpfRaw.length >= 3
                      ? cpfRaw.padStart(11,"0").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4")
                      : "—";
                    return (
                      <React.Fragment key={op.id}>
                        <tr
                          onClick={async ()=>{
                            if (isSel) { setDetalhe(null); return; }
                            setDetalhe({...op, _loading:true});
                            try {
                              const det = await apiFetch(`/fgts/proposal/${op.id}`);
                              const merged = {...op,...det};
                              setDetalhe(merged);
                              setData(prev => prev ? {
                                ...prev,
                                data: (prev.data||[]).map(r=>r.id===op.id?merged:r),
                                _all: (prev._all||[]).map(r=>r.id===op.id?merged:r),
                              } : prev);
                            } catch { setDetalhe(op); }
                          }}
                          style={{ background:isSel?`${C.acc}15`:C.card, borderBottom:`1px solid ${C.b1}`, cursor:"pointer", transition:"background 0.1s" }}
                          onMouseEnter={e=>!isSel&&(e.currentTarget.style.background=C.deep)}
                          onMouseLeave={e=>(e.currentTarget.style.background=isSel?`${C.acc}15`:C.card)}>
                          <td style={{ color:C.tp, fontWeight:600, padding:"10px 12px", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{op.clientName||"—"}</td>
                          <td style={{ color:C.tm, padding:"10px 12px", fontFamily:"monospace", fontSize:11 }}>{cpfFmt}</td>
                          <td style={{ color:C.td, padding:"10px 12px", fontFamily:"monospace", fontSize:11 }}>{op.contractNumber||"—"}</td>
                          <td style={{ padding:"10px 12px" }}>
                            <span style={{ background:stCol+"22", color:stCol, fontSize:10, padding:"3px 10px", borderRadius:20, fontWeight:700 }}>
                              {STATUS_LABEL[op.status]||op.status}
                            </span>
                          </td>
                          <td style={{ color:C.atxt, fontWeight:700, padding:"10px 12px" }}>{fmtBRL(op.disbursedIssueAmount)}</td>
                          <td style={{ color:C.td, padding:"10px 12px", fontSize:11, textTransform:"uppercase" }}>{op.provider||"—"}</td>
                          <td style={{ padding:"10px 12px" }} onClick={e=>e.stopPropagation()}>
                            {hasLink && matchStatus(op.status,"formalization")
                              ? <button onClick={()=>copiarLink(op.id,op.formalizationLink)}
                                  style={{ background:C.abg, color:copied===op.id?"#34D399":C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:7, padding:"3px 10px", fontSize:10.5, fontWeight:700, cursor:"pointer" }}>
                                  {copied===op.id?"✅ Copiado":"📋 Copiar"}
                                </button>
                              : <span style={{ color:C.td, fontSize:11 }}>—</span>
                            }
                          </td>
                          <td style={{ padding:"10px 12px" }} onClick={e=>e.stopPropagation()}>
                            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                            <button onClick={async()=>{
                              const providerNorm = (op.provider||loteProvider||"cartos").toLowerCase().trim();
                              const providerValido = ["qi","cartos","bms"].includes(providerNorm) ? providerNorm : "cartos";
                              const cpfParaBusca = cpfRaw.padStart(11,"0");
                              setAcompSimModal({loading:true,cpf:cpfParaBusca,nome:op.clientName||"",contrato:op});
                              try{
                                await apiFetch("/fgts/balance","POST",{documentNumber:cpfParaBusca,provider:providerValido});
                                let bal=null;
                                for(let ii=0;ii<18;ii++){
                                  await new Promise(r=>setTimeout(r,2500));
                                  const res=await apiFetch(`/fgts/balance?search=${cpfParaBusca}`);
                                  const regs=res?.data||(Array.isArray(res)?res:[res]).filter(Boolean);
                                  const ok=regs.find(r=>r&&(r.status==="success"||r.amount!=null));
                                  if(ok){bal=ok;break;}
                                  const fail=regs.find(r=>r&&r.status==="fail");
                                  if(fail){setAcompSimModal(p=>({...p,loading:false,err:fail.statusInfo||"Falha na consulta"}));return;}
                                }
                                if(!bal){setAcompSimModal(p=>({...p,loading:false,err:"Timeout — tente novamente"}));return;}
                                const feesR=await apiFetch("/fgts/simulations/fees");
                                const fees=Array.isArray(feesR)?feesR.filter(f=>f.active):[];
                                const saldoVal=parseFloat(bal.amount||0);
                                const installments=(bal.periods||bal.installments||[]).length
                                  ?(bal.periods||bal.installments).map(p=>({totalAmount:parseFloat(p.amount||p.totalAmount||saldoVal),dueDate:p.dueDate||p.date}))
                                  :[{totalAmount:saldoVal||100,dueDate:new Date(new Date().getFullYear()+1,1,1).toISOString().split("T")[0]},{totalAmount:saldoVal||100,dueDate:new Date(new Date().getFullYear()+2,1,1).toISOString().split("T")[0]}];
                                const sims=await Promise.all(fees.map(async fee=>{
                                  try{const sim=await apiFetch("/fgts/simulations","POST",{simulationFeesId:fee.simulation_fees?.id_simulation_fees,balanceId:bal.id,targetAmount:0,documentNumber:cpfParaBusca,desiredInstallments:installments,provider:providerValido});return{label:fee.simulation_fees?.label||"",sim,ok:true};}
                                  catch(e){return{label:fee.simulation_fees?.label||"",err:e.message,ok:false};}
                                }));
                                const best=[...sims].filter(t=>t.ok).sort((a,b)=>(b.sim?.availableBalance||0)-(a.sim?.availableBalance||0))[0];
                                setAcompSimModal(p=>({...p,loading:false,bal,saldo:saldoVal,sims,best}));
                              }catch(e){setAcompSimModal(p=>({...p,loading:false,err:e.message}));}
                            }}
                              style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:7, padding:"5px 12px", fontSize:10.5, fontWeight:700, cursor:"pointer" }}>
                              ⚡ Simular
                            </button>
                            <button onClick={e=>{e.stopPropagation(); document.getElementById("del_prop_"+op.id).style.display="flex";}}
                              style={{ background:"rgba(239,68,68,0.08)", color:"#F87171", border:"1px solid #EF444422", borderRadius:7, padding:"5px 8px", fontSize:10.5, cursor:"pointer" }}>
                              🗑
                            </button>
                            </div>
                            <div id={"del_prop_"+op.id} style={{ display:"none", position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:2000, alignItems:"center", justifyContent:"center" }}>
                              <div style={{ background:C.card, border:"1px solid #EF444433", borderRadius:20, padding:"28px 32px", maxWidth:380, width:"90%", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
                                <div style={{ fontSize:36, marginBottom:10 }}>⚠️</div>
                                <div style={{ color:C.tp, fontSize:16, fontWeight:800, marginBottom:6 }}>Excluir proposta?</div>
                                <div style={{ color:C.tm, fontSize:12.5, marginBottom:6 }}><strong>{op.clientName||cpfFmt}</strong></div>
                                <div style={{ color:"#F87171", fontSize:11.5, marginBottom:20 }}>Esta ação cancela o contrato permanentemente.</div>
                                <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                                  <button onClick={e=>{e.stopPropagation(); document.getElementById("del_prop_"+op.id).style.display="none";}}
                                    style={{ background:C.deep, color:C.tm, border:`1px solid ${C.b2}`, borderRadius:9, padding:"9px 22px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Cancelar</button>
                                  <button onClick={async e=>{
                                    e.stopPropagation();
                                    try { await apiFetch(`/fgts/proposal/${op.id}/cancel`,"PATCH",{reason:"invalid_data:other",description:"Excluído pelo operador."}); } catch {}
                                    document.getElementById("del_prop_"+op.id).style.display="none";
                                    setDetalhe(null);
                                    setData(prev=>prev?{...prev,data:(prev.data||[]).filter(r=>r.id!==op.id),_all:(prev._all||[]).filter(r=>r.id!==op.id)}:prev);
                                  }}
                                    style={{ background:"linear-gradient(135deg,#DC2626,#B91C1C)", color:"#fff", border:"none", borderRadius:9, padding:"9px 22px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                                    🗑 Excluir
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {/* Detalhe inline — abre abaixo da linha com dados completos do contrato */}
                        {isSel && (
                          <tr>
                            <td colSpan={8} style={{ padding:0, background:"linear-gradient(135deg,rgba(15,31,61,0.98),rgba(22,42,80,0.98))", borderBottom:`2px solid rgba(79,142,247,0.4)` }}>
                              {detalhe?._loading ? (
                                <div style={{ padding:"24px", textAlign:"center", color:"rgba(255,255,255,0.6)", fontSize:13 }}>⏳ Carregando dados do contrato...</div>
                              ) : (
                              <div style={{ padding:"18px 22px" }}>
                                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                                  <div style={{ color:"#fff", fontSize:13.5, fontWeight:700 }}>
                                    {detalhe?.clientName||detalhe?.name||"Proposta"} <span style={{ color:"rgba(255,255,255,0.4)", fontSize:11, fontWeight:400 }}>· {detalhe?.contractNumber||detalhe?.id}</span>
                                  </div>
                                  <button onClick={e=>{e.stopPropagation();setDetalhe(null);}} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff", borderRadius:6, padding:"4px 12px", fontSize:11, cursor:"pointer" }}>✕ Fechar</button>
                                </div>
                                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8, marginBottom:14 }}>
                                  {[
                                    ["Cliente",   detalhe?.clientName||detalhe?.name||"—"],
                                    ["CPF",       (()=>{ const r=(detalhe?.individualDocumentNumber||detalhe?.documentNumber||"").replace(/\D/g,""); return r.length>=3?r.padStart(11,"0").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"):"—"; })()],
                                    ["E-mail",    detalhe?.email||"—"],
                                    ["Telefone",  detalhe?.phone?(detalhe?.phoneRegionCode||"")+detalhe.phone:"—"],
                                    ["Contrato",  detalhe?.contractNumber||"—"],
                                    ["Status",    getStatusLabel(detalhe?.status)],
                                    ["Valor",     fmtBRL(detalhe?.disbursedIssueAmount)],
                                    ["Provider",  (detalhe?.provider||"—").toUpperCase()],
                                    ["Parceiro",  detalhe?.partnerId||"—"],
                                    ["Criado em", detalhe?.createdAt?new Date(detalhe.createdAt).toLocaleString("pt-BR"):"—"],
                                  ].map(([l,v])=>(
                                    <div key={l} style={{ background:"rgba(255,255,255,0.07)", borderRadius:8, padding:"8px 12px" }}>
                                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>{l}</div>
                                      <div style={{ color:"#fff", fontWeight:600, fontSize:12.5, marginTop:2, wordBreak:"break-word" }}>{v}</div>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:9, padding:"12px 16px" }}>
                                  <div style={{ color:"rgba(255,255,255,0.45)", fontSize:10, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.5px" }}>Link de Formalização</div>
                                  {detalhe?.formalizationLink ? (
                                    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                                      <a href={detalhe.formalizationLink} target="_blank" rel="noreferrer"
                                        style={{ color:C.atxt, fontSize:11, fontFamily:"monospace", wordBreak:"break-all", flex:1 }}>{detalhe.formalizationLink}</a>
                                      <button onClick={()=>copiarLink(detalhe.id,detalhe.formalizationLink)}
                                        style={{ background:C.abg, color:copied===detalhe.id?"#34D399":C.atxt, border:`1px solid ${C.atxt}33`, borderRadius:7, padding:"5px 12px", fontSize:11, cursor:"pointer" }}>
                                        {copied===detalhe.id?"✅ Copiado":"📋 Copiar"}
                                      </button>
                                      <button onClick={()=>window.open(detalhe.formalizationLink,"_blank")}
                                        style={{ background:"rgba(255,255,255,0.1)", color:"#fff", border:"none", borderRadius:7, padding:"5px 12px", fontSize:11, cursor:"pointer" }}>🔗 Abrir</button>
                                      {canGenerateLink(detalhe) && (
                                        <button onClick={()=>gerarNovoLink(detalhe.id)} disabled={acompLinkLoading}
                                          style={{ background:"rgba(251,191,36,0.15)", color:"#FBBF24", border:"1px solid rgba(251,191,36,0.3)", borderRadius:7, padding:"5px 12px", fontSize:11, cursor:"pointer" }}>
                                          {acompLinkLoading?"⏳":"🔄"} Atualizar Link
                                        </button>
                                      )}
                                    </div>
                                  ) : canGenerateLink(detalhe) ? (
                                    <button onClick={()=>gerarNovoLink(detalhe.id)} disabled={acompLinkLoading}
                                      style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:7, padding:"7px 16px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
                                      {acompLinkLoading?"⏳ Gerando...":"✨ Gerar Link de Formalização"}
                                    </button>
                                  ) : (
                                    <span style={{ color:"rgba(255,255,255,0.35)", fontSize:11 }}>
                                      🔒 {detalhe?.status==="paid"?"Proposta paga":"Proposta cancelada"} — não é possível gerar link
                                    </span>
                                  )}
                                </div>
                              </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Paginação */}
            {data?.pages && (data.pages.hasNext || data.pages.hasPrev) && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderTop:`1px solid ${C.b1}`, background:C.deep }}>
                <button onClick={()=>buscar((data.pages.current||1)-1)} disabled={!data.pages.hasPrev||loading}
                  style={{ background:data.pages.hasPrev?C.abg:C.deep, color:data.pages.hasPrev?C.atxt:C.td, border:`1px solid ${C.b2}`, borderRadius:8, padding:"6px 16px", fontSize:12, cursor:data.pages.hasPrev?"pointer":"not-allowed" }}>
                  ← Anterior
                </button>
                <span style={{ color:C.tm, fontSize:12 }}>Página {data.pages.current||1}/{data.pages.totalPages||1} · {data.pages.total||0} resultados</span>
                <button onClick={()=>buscar((data.pages.current||1)+1)} disabled={!data.pages.hasNext||loading}
                  style={{ background:data.pages.hasNext?C.abg:C.deep, color:data.pages.hasNext?C.atxt:C.td, border:`1px solid ${C.b2}`, borderRadius:8, padding:"6px 16px", fontSize:12, cursor:data.pages.hasNext?"pointer":"not-allowed" }}>
                  Próxima →
                </button>
              </div>
            )}
        </div>
      </div>
    );
  };

  const TABS = [
    { id:"individual",      label:"🔍 Individual" },
    { id:"lote",            label:"⚡ Lote" },
    { id:"acompanhamento",  label:"📡 Acompanhamento de Propostas" },
  ];

  return (
    <div style={{ padding:"4px 0" }}>
      {isTokenValid && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, padding:"8px 14px", background:"rgba(52,211,153,0.08)", border:"1px solid rgba(52,211,153,0.2)", borderRadius:9 }}>
          <span style={{ color:"#34D399" }}>🟢</span>
          <span style={{ color:"#34D399", fontSize:12, fontWeight:600 }}>V8 Digital — {savedUser}</span>
          <span style={{ color:C.td, fontSize:10.5, marginLeft:4 }}>· Expira {new Date(tokenExp).toLocaleTimeString("pt-BR")}</span>
          <button onClick={clearSession} style={{ marginLeft:"auto", background:"transparent", border:"none", color:"#F87171", cursor:"pointer", fontSize:11 }}>Desconectar</button>
        </div>
      )}

      {isTokenValid && (
        <div style={{ display:"flex", gap:2, borderBottom:`1px solid ${C.b1}`, marginBottom:20 }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setAba(t.id)}
              style={{ background:"transparent", border:"none", cursor:"pointer", padding:"9px 16px", fontSize:13,
                fontWeight:aba===t.id?700:400, color:aba===t.id?C.atxt:C.tm,
                borderBottom:aba===t.id?`2px solid ${C.atxt}`:"2px solid transparent", marginBottom:"-1px" }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!isTokenValid && (
        <div style={{ background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"22px 24px" }}>
          <div style={{ color:C.tp, fontSize:14, fontWeight:700, marginBottom:4 }}>🔑 Acesso V8 Digital</div>
          <div style={{ color:C.tm, fontSize:12, marginBottom:18 }}>Use seu <b style={{ color:C.atxt }}>e-mail e senha</b> da plataforma V8. Sessão salva no navegador.</div>
          <div style={{ background:C.deep, border:`1px solid ${C.b1}`, borderRadius:9, padding:"10px 14px", marginBottom:16, fontSize:11 }}>
            <div style={{ color:C.td }}>Auth: <span style={{ color:C.tm }}>https://auth.v8sistema.com/oauth/token</span></div>
            <div style={{ color:C.td }}>BFF: <span style={{ color:C.tm }}>https://bff.v8sistema.com</span></div>
            <div style={{ color:C.td }}>Client ID: <span style={{ color:C.tm }}>DHWogdaYmEI8n5bwwxPDzulMlSK7dwIn</span></div>
          </div>
          {authErr && <div style={{ color:"#F87171", background:"rgba(239,68,68,0.1)", border:"1px solid #EF444433", borderRadius:8, padding:"9px 13px", marginBottom:14, fontSize:12.5 }}>⚠ {authErr}</div>}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
            <div><label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>E-mail *</label><input value={credForm.username} onChange={e=>setCredForm(p=>({...p,username:e.target.value}))} placeholder="seu@email.com" style={{ ...S.input }} /></div>
            <div><label style={{ color:C.tm, fontSize:11, display:"block", marginBottom:4 }}>Senha *</label><input value={credForm.password} onChange={e=>setCredForm(p=>({...p,password:e.target.value}))} type="password" placeholder="••••••••" style={{ ...S.input }} onKeyDown={e=>e.key==="Enter"&&autenticar()} /></div>
          </div>
          <button onClick={autenticar} disabled={authLoading}
            style={{ background:`linear-gradient(135deg,${C.lg1},${C.lg2})`, color:"#fff", border:"none", borderRadius:9, padding:"11px 28px", fontSize:14, fontWeight:700, cursor:"pointer", opacity:authLoading?0.7:1 }}>
            {authLoading?"⏳ Autenticando...":"🔐 Entrar na V8 Digital →"}
          </button>
          <div style={{ color:C.td, fontSize:10.5, marginTop:12 }}>Sessão salva. Não precisará fazer login ao recarregar.</div>
        </div>
      )}

      {isTokenValid && aba === "individual"      && <IndividualTab />}
      {isTokenValid && aba === "lote"             && <LoteTab />}
      {isTokenValid && aba === "operacoes"        && <OperacoesTab />}
      {isTokenValid && aba === "acompanhamento"   && <AcompanhamentoTab />}
    </div>
  );
}



// ── APIs Bancos ────────────────────────────────────────────────
function BancoC6Tab() {
  return (
    <div style={{ padding:"32px 0", textAlign:"center" }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🏦</div>
      <div style={{ color:C.tp, fontSize:16, fontWeight:700, marginBottom:8 }}>Banco C6</div>
      <div style={{ color:C.tm, fontSize:13, maxWidth:400, margin:"0 auto" }}>
        Integração com o Banco C6 em breve.<br/>
        Configure as credenciais em <b>Configurações → Configurar API</b>.
      </div>
    </div>
  );
}

function CreditoTrabalhadorTab() {
  return (
    <div style={{ padding:"32px 0", textAlign:"center" }}>
      <div style={{ fontSize:48, marginBottom:16 }}>💼</div>
      <div style={{ color:C.tp, fontSize:16, fontWeight:700, marginBottom:8 }}>Crédito do Trabalhador</div>
      <div style={{ color:C.tm, fontSize:13, maxWidth:400, margin:"0 auto" }}>
        Módulo de Crédito do Trabalhador em breve.<br/>
        Esta modalidade usará a API V8 Digital para operações de crédito.
      </div>
    </div>
  );
}

function ApisBancosPage({ currentUser, contacts }) {
  const [abaBanco, setAbaBanco] = useState("v8");
  const [abaV8,    setAbaV8]    = useState("fgts");

  const tabBtn = (ativa, label, onClick, accent=false) => (
    <button onClick={onClick}
      style={{ background:"transparent", border:"none", cursor:"pointer", padding:"10px 22px", fontSize:13.5,
        fontWeight:ativa?700:400, color:ativa?(accent?"#34D399":C.atxt):C.tm,
        borderBottom:ativa?`2px solid ${accent?"#34D399":C.atxt}`:"2px solid transparent",
        marginBottom:"-1px", transition:"all 0.12s", whiteSpace:"nowrap" }}>
      {label}
    </button>
  );

  return (
    <div style={{ padding:"0", maxWidth:"100%" }}>
      {/* Nível 1 — Banco */}
      <div style={{ padding:"20px 30px 0", borderBottom:`1px solid ${C.b1}`, background:C.card }}>
        <h1 style={{ color:C.tp, fontSize:18, fontWeight:700, margin:"0 0 14px" }}>🏦 Bancos</h1>
        <div style={{ display:"flex", gap:0 }}>
          {tabBtn(abaBanco==="v8",    "⚡ V8 Digital",  ()=>setAbaBanco("v8"))}
          {tabBtn(abaBanco==="c6",    "🏦 Banco C6",    ()=>setAbaBanco("c6"))}
        </div>
      </div>

      {/* Nível 2 — Sub-abas da V8 */}
      {abaBanco==="v8" && (
        <div style={{ background:C.deep, borderBottom:`1px solid ${C.b1}`, padding:"0 30px", display:"flex", gap:0 }}>
          {tabBtn(abaV8==="fgts",    "📋 FGTS",                  ()=>setAbaV8("fgts"),    true)}
          {tabBtn(abaV8==="credito", "💼 Crédito do Trabalhador", ()=>setAbaV8("credito"), true)}
        </div>
      )}

      {/* Conteúdo */}
      <div style={{ padding:"0 30px" }}>
        {abaBanco==="v8" && abaV8==="fgts"    && <V8DigitalTab currentUser={currentUser} contacts={contacts} />}
        {abaBanco==="v8" && abaV8==="credito" && <CreditoTrabalhadorTab />}
        {abaBanco==="c6"                      && <BancoC6Tab />}
      </div>
    </div>
  );
}

// ── UFs do Brasil ──────────────────────────────────────────────
const UF_BRASIL = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

// ── Formatadores ───────────────────────────────────────────────
const fmtCPFd  = v => { const d=v.replace(/\D/g,"").slice(0,11); if(d.length<=3)return d; if(d.length<=6)return d.replace(/(\d{3})(\d+)/,"$1.$2"); if(d.length<=9)return d.replace(/(\d{3})(\d{3})(\d+)/,"$1.$2.$3"); return d.replace(/(\d{3})(\d{3})(\d{3})(\d+)/,"$1.$2.$3-$4"); };
const fmtFoned = v => { const d=v.replace(/\D/g,"").slice(0,11); if(!d) return ""; if(d.length<=2)return `+55 (${d}`; if(d.length<=6)return `+55 (${d.slice(0,2)}) ${d.slice(2)}`; if(d.length<=10)return `+55 (${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`; return `+55 (${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`; };
const fmtMoedad = v => { const d=v.replace(/\D/g,""); if(!d)return ""; const n=parseInt(d,10)/100; return "R$ "+n.toLocaleString("pt-BR",{minimumFractionDigits:2}); };
const fmtCEPd  = v => { const d=v.replace(/\D/g,"").slice(0,8); return d.length>5?d.replace(/(\d{5})(\d+)/,"$1-$2"):d; };

// ── Sub-componentes de Digitação fora do pai (evita perda de foco) ──
function DField({ label, req, val, onChange, type="text", ph="", mask="" }) {
  const handle = e => {
    let v = e.target.value;
    if(mask==="cpf")   v=fmtCPFd(v);
    if(mask==="fone")  v=fmtFoned(v);
    if(mask==="moeda") v=fmtMoedad(v);
    if(mask==="cep")   v=fmtCEPd(v);
    onChange(v);
  };
  return (
    <div>
      <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:3}}>
        {label}{req&&<span style={{color:"#EF4444"}}> *</span>}
      </label>
      <input value={val} onChange={handle} type={type} placeholder={ph}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        style={{...S.input,fontSize:12,padding:"7px 10px",borderColor:req&&!val?"#EF444455":undefined}}/>
    </div>
  );
}
function DSelect({ label, req, val, onChange, opts }) {
  return (
    <div>
      <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:3}}>
        {label}{req&&<span style={{color:"#EF4444"}}> *</span>}
      </label>
      <select value={val} onChange={e=>onChange(e.target.value)} style={{...S.input,fontSize:12,padding:"7px 10px",cursor:"pointer"}}>
        <option value="">Selecione...</option>
        {opts.map(o=>typeof o==="string"?<option key={o} value={o}>{o}</option>:<option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}
function DUF({ val, onChange, label="UF" }) {
  return (
    <div>
      <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:3}}>{label}</label>
      <select value={val||""} onChange={e=>onChange(e.target.value)} style={{...S.input,fontSize:12,padding:"7px 10px",cursor:"pointer"}}>
        <option value="">UF</option>
        {UF_BRASIL.map(uf=><option key={uf} value={uf}>{uf}</option>)}
      </select>
    </div>
  );
}
function DSimNao({ label, val, onChange }) {
  return (
    <div>
      <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:4}}>{label}</label>
      <div style={{display:"flex",gap:6}}>
        {["SIM","NAO"].map(v=>(
          <button key={v} onClick={()=>onChange(v)}
            style={{flex:1,background:val===v?(v==="SIM"?"#0D2B1A":"#2D1515"):C.deep,
              color:val===v?(v==="SIM"?"#34D399":"#F87171"):C.tm,
              border:`1px solid ${val===v?(v==="SIM"?"#34D39944":"#EF444444"):C.b2}`,
              borderRadius:8,padding:"6px 0",fontSize:12,fontWeight:val===v?700:400,cursor:"pointer"}}>
            {v==="SIM"?"✓ Sim":"✗ Não"}
          </button>
        ))}
      </div>
    </div>
  );
}
function DSecTitle({ icon, title, color }) {
  return (
    <div style={{color:color||C.ts,fontSize:12,fontWeight:700,marginBottom:12,paddingBottom:8,
      borderBottom:`1px solid ${color?color+"33":C.b1}`,display:"flex",alignItems:"center",gap:7}}>
      {icon} {title}
    </div>
  );
}
function DGrid({ cols=3, children, gap=10 }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap,marginBottom:12}}>{children}</div>
  );
}
function DDat({ form, setF, label, k, min, max }) {
  return (
    <div>
      <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:3}}>{label}</label>
      <input type="date" value={form[k]||""} onChange={e=>setF(k,e.target.value)}
        min={min} max={max}
        style={{...S.input,fontSize:12,padding:"7px 10px"}}/>
    </div>
  );
}
function DInp({ form, setF, label, k, type="text", ph="", req=false, mask="" }) {
  return <DField label={label} req={req} val={form[k]||""} onChange={v=>setF(k,v)} type={type} ph={ph} mask={mask} />;
}
function DSel({ form, setF, label, k, opts, req=false }) {
  return <DSelect label={label} req={req} val={form[k]||""} onChange={v=>setF(k,v)} opts={opts} />;
}
function DSN({ form, setF, label, k }) {
  return <DSimNao label={label} val={form[k]} onChange={v=>setF(k,v)} />;
}
function DCep({ form, setF }) {
  const [buscando, setBuscando] = useState(false);
  const handle = async e => {
    const v = fmtCEPd(e.target.value);
    setF("cep", v);
    const clean = v.replace(/\D/g,"");
    if(clean.length===8) {
      setBuscando(true);
      try {
        const r = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
        const d = await r.json();
        if(!d.erro){ setF("rua",d.logradouro||""); setF("bairro",d.bairro||""); setF("cidade",d.localidade||""); setF("ufEnd",d.uf||""); }
      } catch{}
      setBuscando(false);
    }
  };
  return (
    <div>
      <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:3}}>CEP</label>
      <div style={{position:"relative"}}>
        <input value={form.cep||""} onChange={handle} placeholder="00000-000" maxLength={9}
          style={{...S.input,fontSize:12,padding:"7px 10px"}}/>
        {buscando&&<span style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",color:C.atxt,fontSize:10}}>🔍 buscando...</span>}
      </div>
    </div>
  );
}

// ── Relatório Mensal e Anual de Digitação ──────────────────────
function RelatorioDigitacao({ myId }) {
  const [propostas, setPropostas] = useState([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  useEffect(() => {
    const unsub = onSnapshot(collection(db,"propostas"), snap => {
      const all = snap.docs.map(d=>({...d.data(),id:d.id}))
        .filter(p => p.criadoPor === myId);
      setPropostas(all);
      setLoading(false);
    });
    return ()=>unsub();
  }, []); // eslint-disable-line

  const fmtBRL = v => "R$ " + (v||0).toLocaleString("pt-BR",{minimumFractionDigits:2});
  const parseVal = v => { const n=parseFloat((v||"0").replace(/\./g,"").replace(",",".")); return isNaN(n)?0:n; };

  // Filtrar pelo mês/ano atual
  const mesAtual = now.getMonth();
  const anoAtual = now.getFullYear();

  const doMes = propostas.filter(p => {
    const d = new Date(p.createdAt||0);
    return d.getMonth()===mesAtual && d.getFullYear()===anoAtual;
  });
  const doAno = propostas.filter(p => new Date(p.createdAt||0).getFullYear()===anoAtual);

  const calcMetrics = (list) => ({
    total: list.length,
    concluidas: list.filter(p=>p.status==="Proposta Concluída").length,
    pendentes: list.filter(p=>["Pendente","Pago Aguardando Confirmação","Aguardando Formalização"].includes(p.status)).length,
    canceladas: list.filter(p=>p.status==="Cancelada").length,
    valorTotal: list.filter(p=>p.status==="Proposta Concluída").reduce((a,p)=>a+parseVal(p.valorSolicitado),0),
  });

  const metricsMes = calcMetrics(doMes);
  const metricsAno = calcMetrics(doAno);

  // Breakdown por mês do ano atual
  const porMes = Array.from({length:12},(_,m) => {
    const list = propostas.filter(p => {
      const d = new Date(p.createdAt||0);
      return d.getMonth()===m && d.getFullYear()===anoAtual;
    });
    return { mes:MESES[m], ...calcMetrics(list) };
  });

  const MetricCard = ({label,val,color,icon,isMoney=false}) => (
    <div style={{...S.card,padding:"18px 20px",textAlign:"center",border:`1px solid ${color}33`}}>
      <div style={{fontSize:26,marginBottom:6}}>{icon}</div>
      <div style={{color,fontSize:isMoney?15:26,fontWeight:800,letterSpacing:isMoney?"-0.5px":"-1px",marginBottom:4,wordBreak:"break-all"}}>{val}</div>
      <div style={{color:C.td,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</div>
    </div>
  );

  if (loading) return <div style={{color:C.tm,textAlign:"center",padding:"40px 0"}}>Carregando...</div>;

  return (
    <div>
      {/* ── Relatório Mensal ── */}
      <div style={{marginBottom:28}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{color:C.tp,fontSize:16,fontWeight:700}}>📅 {MESES[mesAtual]} {anoAtual}</div>
          <span style={{background:C.abg,color:C.atxt,fontSize:10,padding:"2px 10px",borderRadius:20,fontWeight:700}}>Mês atual</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
          <MetricCard label="Enviadas" val={metricsMes.total} color={C.atxt} icon="📤"/>
          <MetricCard label="Concluídas" val={metricsMes.concluidas} color="#34D399" icon="✅"/>
          <MetricCard label="Pendentes" val={metricsMes.pendentes} color="#FBBF24" icon="⏳"/>
          <MetricCard label="Canceladas" val={metricsMes.canceladas} color="#EF4444" icon="❌"/>
        </div>
        <div style={{...S.card,padding:"16px 20px",border:"1px solid #34D39933",display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:32}}>💰</div>
          <div>
            <div style={{color:C.td,fontSize:11,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.5px"}}>Total liberado em {MESES[mesAtual]}</div>
            <div style={{color:"#34D399",fontSize:22,fontWeight:800}}>{fmtBRL(metricsMes.valorTotal)}</div>
          </div>
        </div>
      </div>

      {/* ── Relatório Anual ── */}
      <div>
        <div style={{color:C.tp,fontSize:16,fontWeight:700,marginBottom:16}}>📆 Relatório Anual — {anoAtual}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
          <MetricCard label="Enviadas" val={metricsAno.total} color={C.atxt} icon="📤"/>
          <MetricCard label="Concluídas" val={metricsAno.concluidas} color="#34D399" icon="✅"/>
          <MetricCard label="Pendentes" val={metricsAno.pendentes} color="#FBBF24" icon="⏳"/>
          <MetricCard label="Canceladas" val={metricsAno.canceladas} color="#EF4444" icon="❌"/>
        </div>
        <div style={{...S.card,padding:"16px 20px",border:"1px solid #34D39933",marginBottom:20,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:32}}>🏆</div>
          <div>
            <div style={{color:C.td,fontSize:11,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.5px"}}>Total liberado em {anoAtual}</div>
            <div style={{color:"#34D399",fontSize:22,fontWeight:800}}>{fmtBRL(metricsAno.valorTotal)}</div>
          </div>
        </div>

        {/* Tabela mês a mês */}
        <div style={{...S.card,overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.b1}`,color:C.ts,fontSize:13,fontWeight:700}}>Desempenho por mês</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:C.deep}}>
                  {["Mês","Enviadas","Concluídas","Pendentes","Canceladas","Valor Liberado"].map(h=>(
                    <th key={h} style={{color:C.td,fontSize:10.5,fontWeight:700,padding:"10px 14px",textAlign:"left",textTransform:"uppercase",letterSpacing:"0.3px",borderBottom:`1px solid ${C.b1}`,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {porMes.map((m,i)=>{
                  const isAtual = i===mesAtual;
                  return (
                    <tr key={m.mes} style={{background:isAtual?C.abg:"transparent",borderBottom:`1px solid ${C.b1}`}}>
                      <td style={{padding:"10px 14px",color:isAtual?C.atxt:C.ts,fontWeight:isAtual?700:400}}>{m.mes}{isAtual&&" ←"}</td>
                      <td style={{padding:"10px 14px",color:C.ts}}>{m.total||"—"}</td>
                      <td style={{padding:"10px 14px",color:m.concluidas>0?"#34D399":C.td,fontWeight:m.concluidas>0?700:400}}>{m.concluidas||"—"}</td>
                      <td style={{padding:"10px 14px",color:m.pendentes>0?"#FBBF24":C.td}}>{m.pendentes||"—"}</td>
                      <td style={{padding:"10px 14px",color:m.canceladas>0?"#EF4444":C.td}}>{m.canceladas||"—"}</td>
                      <td style={{padding:"10px 14px",color:m.valorTotal>0?"#34D399":C.td,fontWeight:m.valorTotal>0?600:400}}>{m.valorTotal>0?fmtBRL(m.valorTotal):"—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Minhas Digitações — aba do digitador ───────────────────────
function MinhasDigitacoes({ minhasPropostas, myId, contacts }) {
  const [modalDev, setModalDev] = useState(null);
  const [modalVer, setModalVer] = useState(null);    // visualizar proposta
  const [modalEdit, setModalEdit] = useState(null);  // editar proposta
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editMsg, setEditMsg] = useState("");
  const [buscaMD, setBuscaMD] = useState("");         // busca em minhas digitações

  // Devolução
  const [devBanco, setDevBanco] = useState("");
  const [devAg,    setDevAg]    = useState("");
  const [devConta, setDevConta] = useState("");
  const [devTipo,  setDevTipo]  = useState("corrente");
  const [devPix1,  setDevPix1]  = useState("");
  const [devPix2,  setDevPix2]  = useState("");
  const [devObs,   setDevObs]   = useState("");

  const abrirDev = (p) => {
    setModalDev(p);
    setDevBanco(p.bancoPendente||""); setDevAg(p.agenciaPendente||"");
    setDevConta(p.contaPendente||""); setDevTipo(p.tipoContaPendente||"corrente");
    setDevPix1(p.pix1Pendente||""); setDevPix2(p.pix2Pendente||"");
    setDevObs(p.obsPendente||"");
  };

  const abrirEdit = (p) => {
    setEditForm({...p});
    setEditMsg("");
    setModalEdit(p);
  };

  const salvarEdicao = async () => {
    if (!editForm.nome||!editForm.cpf) { setEditMsg("❌ Nome e CPF são obrigatórios."); return; }
    setSaving(true);
    try {
      await setDoc(doc(db,"propostas",editForm.id), {
        ...editForm,
        docFiles: editForm.docFiles?.map(f=>({name:f.name,type:f.type,url:f.url||"",source:f.source||"",path:f.path||""})),
        editadoAt: Date.now(),
        status: "Análise Manual → Dados Editados",
        editPermitido: false, // remove permissão após salvar
        hasNewInteraction: true,
        viewedBy: [], // força mestre/master a ver como não lido (badge na aba)
        viewedByDigitador: [myId],
      }, {merge:true});
      // Notificação visível na aba Propostas (badge) e no sino
      await setDoc(doc(db,"notifications","edit_"+editForm.id+"_"+Date.now()), {
        toRole: ["mestre","master"],
        type: "proposta_editada",
        text: `✏️ Dados editados pelo digitador — ${editForm.nome} (${editForm.cpf})`,
        propostaId: editForm.id,
        createdAt: Date.now(),
        broadcast: false,
        viewedBy: [],
      });
      setEditMsg("✅ Proposta atualizada!");
      setTimeout(()=>setModalEdit(null), 1200);
    } catch(e) { setEditMsg("❌ Erro: "+e.message); }
    setSaving(false);
  };

  const enviarDevolucao = async () => {
    if (!devBanco||!devAg||!devConta) { alert("Preencha banco, agência e conta."); return; }
    setSaving(true);
    await setDoc(doc(db,"propostas",modalDev.id),{
      status:"Análise Manual",
      bancoPendente:devBanco, agenciaPendente:devAg, contaPendente:devConta,
      tipoContaPendente:devTipo, pix1Pendente:devPix1, pix2Pendente:devPix2, obsPendente:devObs,
      hasNewInteraction:true, viewedBy:[], viewedByDigitador:[myId],
      respostaDevAt:Date.now(),
    },{merge:true});
    setSaving(false);
    setModalDev(null);
  };

  const confirmarFormalizacao = async (propId) => {
    await setDoc(doc(db,"propostas",propId),{
      status:"Aguardando Checagem de Formalização",
      hasNewInteraction:true, viewedBy:[], viewedByDigitador:[myId],
      formalizadoAt:Date.now(),
    },{merge:true});
  };

  const marcarVisto = async (p) => {
    if (p.hasNewInteraction && !(p.viewedByDigitador||[]).includes(myId)) {
      await setDoc(doc(db,"propostas",p.id),{viewedByDigitador:[...(p.viewedByDigitador||[]),myId]},{merge:true});
    }
  };

  const ef = (k,v) => setEditForm(f=>({...f,[k]:v}));

  const inp = (label,val,set,ph="") => (
    <div style={{marginBottom:8}}>
      <label style={{color:C.tm,fontSize:11,display:"block",marginBottom:3}}>{label}</label>
      <input value={val} onChange={e=>set(e.target.value)} placeholder={ph} style={{...S.input,fontSize:12}}/>
    </div>
  );

  const RowVer = ({label,val}) => val?(
    <div style={{display:"flex",gap:8,marginBottom:4}}>
      <span style={{color:C.td,fontSize:11,minWidth:130,flexShrink:0}}>{label}:</span>
      <span style={{color:C.ts,fontSize:11.5,wordBreak:"break-all"}}>{val}</span>
    </div>
  ):null;

  return (
    <div>
      {/* Modal Visualizar */}
      {modalVer && (
        <div style={{position:"fixed",inset:0,zIndex:9900,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={()=>setModalVer(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:18,padding:"22px 26px",maxWidth:600,width:"94%",maxHeight:"88vh",overflowY:"auto",border:`1px solid ${C.b1}`,boxShadow:"0 12px 48px rgba(0,0,0,0.8)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{color:C.tp,fontSize:15,fontWeight:800}}>👁 Visualizar Proposta — {modalVer.nome}</div>
              <button onClick={()=>setModalVer(null)} style={{background:"none",border:"none",color:C.tm,cursor:"pointer",fontSize:18}}>✕</button>
            </div>
            {[
              ["👤 Cliente",""],["Nome",modalVer.nome],["CPF",modalVer.cpf],["RG",modalVer.rg],["Data Nasc.",modalVer.dataNasc],
              ["Nome da Mãe",modalVer.nomeMae],["Nome do Pai",modalVer.nomePai],
              ["📞 Contato",""],["Tel 1",modalVer.contato1],["Tel 2",modalVer.contato2],["Email",modalVer.email1],
              ["📍 Endereço",""],["CEP",modalVer.cep],["Rua",modalVer.rua],["Número",modalVer.numero],["Bairro",modalVer.bairro],["Cidade",modalVer.cidade],["UF",modalVer.ufEnd],
              ["🏦 Bancário",""],["Banco",modalVer.bancoPagto],["Agência",modalVer.agencia],["Conta",modalVer.contaDigito],["Tipo",modalVer.tipoConta],["PIX 1",modalVer.pix1],["PIX 2",modalVer.pix2],
              ["💰 Proposta",""],["Tipo",modalVer.tipo],["Banco Prop.",modalVer.bancoProposta],["Valor Liberado",modalVer.valorLiberado],["Valor Prometido",modalVer.valorPrometido],
            ].map(([l,v],i)=> !v ? (
              <div key={i} style={{color:C.atxt,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginTop:12,marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${C.b1}`}}>{l}</div>
            ) : <RowVer key={i} label={l} val={v}/>)}
            {/* Documentos */}
            {(modalVer.docFiles||[]).length>0&&(
              <div style={{marginTop:14,paddingTop:10,borderTop:`1px solid ${C.b1}`}}>
                <div style={{color:C.atxt,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>📎 Documentos</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {modalVer.docFiles.map((f,i)=>(
                    f.url ? (
                      <div key={i} style={{display:"flex",gap:0}}>
                        <a href={f.url} target="_blank" rel="noopener noreferrer"
                          style={{background:C.abg,color:C.atxt,fontSize:11,padding:"6px 12px",borderRadius:"8px 0 0 8px",border:`1px solid ${C.atxt}33`,borderRight:"none",textDecoration:"none",display:"flex",alignItems:"center",gap:6,fontWeight:600}}>
                          {f.type?.startsWith("image/")?"🖼":"📄"} {f.name} ↗
                        </a>
                        <a href={f.url} download={f.name}
                          title="Baixar arquivo"
                          style={{background:C.atxt+"33",color:C.atxt,fontSize:13,padding:"6px 10px",borderRadius:"0 8px 8px 0",border:`1px solid ${C.atxt}33`,textDecoration:"none",display:"flex",alignItems:"center",cursor:"pointer",fontWeight:800}}>
                          ⬇
                        </a>
                      </div>
                    ) : (
                      <span key={i} style={{background:C.deep,color:C.td,fontSize:11,padding:"5px 10px",borderRadius:7,border:`1px solid ${C.b1}`}}>
                        📄 {f.name}
                      </span>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Editar */}
      {modalEdit && (
        <div style={{position:"fixed",inset:0,zIndex:9900,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={()=>setModalEdit(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:18,padding:"22px 26px",maxWidth:580,width:"94%",maxHeight:"90vh",overflowY:"auto",border:`1px solid #FBBF24`,boxShadow:"0 12px 48px rgba(0,0,0,0.8)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{color:"#FBBF24",fontSize:15,fontWeight:800}}>✏️ Editar Proposta — {modalEdit.nome}</div>
              <button onClick={()=>setModalEdit(null)} style={{background:"none",border:"none",color:C.tm,cursor:"pointer",fontSize:18}}>✕</button>
            </div>
            {editMsg&&<div style={{color:editMsg.startsWith("✅")?"#34D399":"#F87171",fontSize:12,marginBottom:10,fontWeight:600}}>{editMsg}</div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
              {[["Nome",    "nome"],["CPF",     "cpf"],["RG",      "rg"],
                ["Tel 1",  "contato1"],["Tel 2","contato2"],["Email","email1"],
                ["CEP",    "cep"],["Rua",    "rua"],["Número", "numero"],
                ["Bairro", "bairro"],["Cidade","cidade"],
                ["Banco",  "bancoPagto"],["Agência","agencia"],["Conta c/ Dígito","contaDigito"],
                ["PIX 1",  "pix1"],["PIX 2", "pix2"],
                ["Banco Prop.","bancoProposta"],["Valor Liberado","valorLiberado"],["Valor Prometido","valorPrometido"],
              ].map(([label,key])=>(
                <div key={key}>
                  <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:3}}>{label}</label>
                  <input value={editForm[key]||""} onChange={e=>ef(key,e.target.value)}
                    style={{...S.input,fontSize:12,padding:"6px 9px"}}/>
                </div>
              ))}
            </div>
            <div style={{marginBottom:10}}>
              <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:3}}>Observação</label>
              <textarea value={editForm.observacao||""} onChange={e=>ef("observacao",e.target.value)}
                rows={2} style={{...S.input,resize:"vertical",fontSize:12}}/>
            </div>
            <button onClick={salvarEdicao} disabled={saving}
              style={{background:"linear-gradient(135deg,#FBBF24,#F59E0B)",color:"#000",border:"none",borderRadius:10,padding:"11px 0",fontSize:13,fontWeight:800,cursor:saving?"not-allowed":"pointer",width:"100%",opacity:saving?0.7:1}}>
              {saving?"⏳ Salvando...":"💾 Salvar Alterações"}
            </button>
          </div>
        </div>
      )}

      {/* Modal Devolução */}
      {modalDev && (
        <div style={{position:"fixed",inset:0,zIndex:9900,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={()=>setModalDev(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:18,padding:"22px 26px",maxWidth:460,width:"92%",maxHeight:"88vh",overflowY:"auto",border:`1px solid #F87171`,boxShadow:"0 12px 48px rgba(0,0,0,0.8)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{color:"#F87171",fontSize:14,fontWeight:800}}>🔴 Responder Devolução — {modalDev.nome}</div>
              <button onClick={()=>setModalDev(null)} style={{background:"none",border:"none",color:C.tm,cursor:"pointer",fontSize:18}}>✕</button>
            </div>
            <div style={{color:C.td,fontSize:11.5,marginBottom:14,lineHeight:1.7}}>Preencha os dados bancários corretos para reapresentação da proposta.</div>
            {inp("Banco",devBanco,setDevBanco,"Ex: Banco do Brasil")}
            {inp("Agência",devAg,setDevAg,"Ex: 0001")}
            {inp("Conta com dígito",devConta,setDevConta,"Ex: 12345-6")}
            <div style={{marginBottom:8}}>
              <label style={{color:C.tm,fontSize:11,display:"block",marginBottom:3}}>Tipo de Conta</label>
              <select value={devTipo} onChange={e=>setDevTipo(e.target.value)} style={{...S.input,fontSize:12,cursor:"pointer"}}>
                <option value="corrente">Corrente</option>
                <option value="poupanca">Poupança</option>
              </select>
            </div>
            {inp("1ª Chave PIX",devPix1,setDevPix1,"CPF, email, telefone...")}
            {inp("2ª Chave PIX",devPix2,setDevPix2,"Opcional")}
            {inp("Observação",devObs,setDevObs,"Informações adicionais")}
            <button onClick={enviarDevolucao} disabled={saving}
              style={{background:"linear-gradient(135deg,#F87171,#EF4444)",color:"#fff",border:"none",borderRadius:9,padding:"11px 0",fontSize:13,fontWeight:700,cursor:saving?"not-allowed":"pointer",width:"100%",marginTop:8,opacity:saving?0.7:1}}>
              {saving?"⏳ Enviando...":"✅ Confirmar Dados Bancários"}
            </button>
          </div>
        </div>
      )}

      <p style={{color:C.tm,fontSize:12,marginBottom:10}}>Acompanhe suas propostas. Novidades são destacadas automaticamente.</p>

      {/* Campo de busca */}
      <input value={buscaMD} onChange={e=>setBuscaMD(e.target.value)}
        placeholder="🔍 Buscar por nome ou CPF..."
        style={{...S.input,fontSize:12,padding:"7px 12px",marginBottom:10,width:"100%"}}/>

      {minhasPropostas.length===0&&(
        <div style={{textAlign:"center",padding:"40px 0",color:C.tm}}>
          <div style={{fontSize:32,opacity:0.3,marginBottom:8}}>📝</div>
          <div style={{fontSize:13,fontWeight:600}}>Nenhuma digitação enviada ainda</div>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {minhasPropostas.filter(p=>{
          if(!buscaMD.trim()) return true;
          const q=buscaMD.toLowerCase();
          return (p.nome||"").toLowerCase().includes(q)||(p.cpf||"").includes(q);
        }).map(p=>{
          const st = p.status||"Aguardando Digitação";
          const col = STATUS_PROPOSTA_COLORS[st]||C.td;
          const temNova = p.hasNewInteraction && !(p.viewedByDigitador||[]).includes(myId);
          const isPendente = st==="Pendente";
          const isAguardForm = st==="Aguardando Formalização";
          const editLiberado = !!p.editPermitido;

          return (
            <div key={p.id} onClick={()=>marcarVisto(p)}
              style={{...S.card,padding:"10px 14px",border:`1px solid ${editLiberado?"#FBBF2466":temNova?"#34D39966":col+"33"}`,boxShadow:temNova?`0 0 10px #34D39915`:"none",transition:"border 0.2s"}}>

              {/* Cabeçalho compacto */}
              <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginBottom:4}}>
                {temNova&&<span style={{width:7,height:7,borderRadius:"50%",background:"#34D399",animation:"pulse 1.5s infinite",flexShrink:0}}/>}
                {editLiberado&&<span style={{width:7,height:7,borderRadius:"50%",background:"#FBBF24",animation:"pulse 1.5s infinite",flexShrink:0}}/>}
                <span style={{color:C.tp,fontSize:13,fontWeight:700,flex:1}}>{p.nome||"—"}</span>
                <span style={{background:col+"22",color:col,fontSize:9.5,padding:"2px 7px",borderRadius:20,fontWeight:700,border:`1px solid ${col}44`}}>{st}</span>
                {temNova&&<span style={{background:"#34D39922",color:"#34D399",fontSize:9,padding:"1px 5px",borderRadius:20,fontWeight:700}}>🔔</span>}
                {editLiberado&&<span style={{background:"#FBBF2422",color:"#FBBF24",fontSize:9,padding:"1px 5px",borderRadius:20,fontWeight:700}}>🔓</span>}
                {p.pendenteDocumentacao&&<span style={{background:"#818CF822",color:"#818CF8",fontSize:9,padding:"1px 5px",borderRadius:20,fontWeight:700}}>📎</span>}
              </div>

              <div style={{color:C.tm,fontSize:10.5,marginBottom:6}}>CPF: {p.cpf||"—"} · {p.tipo||"—"} · {p.createdAt?new Date(p.createdAt).toLocaleString("pt-BR"):"—"}</div>

              {/* Botões de ação */}
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                <button onClick={e=>{e.stopPropagation();setModalVer(p);}}
                  style={{background:C.deep,color:C.ts,border:`1px solid ${C.b2}`,borderRadius:8,padding:"6px 14px",fontSize:11.5,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                  👁 Visualizar
                </button>
                {p.editavel && (
                  <button onClick={e=>{e.stopPropagation();abrirEdit(p);}}
                    style={{background:"#1A1400",color:"#FBBF24",border:"1px solid #FBBF2444",borderRadius:8,padding:"6px 14px",fontSize:11.5,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                    ✏️ Editar Proposta
                  </button>
                )}
                {isPendente&&(
                  <button onClick={e=>{e.stopPropagation();abrirDev(p);}}
                    style={{background:"#1A0000",color:"#F87171",border:"1px solid #F8717144",borderRadius:8,padding:"6px 14px",fontSize:11.5,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                    🔴 Responder Devolução
                  </button>
                )}
                {isAguardForm&&p.linkFormalizacao&&(
                  <button onClick={e=>{e.stopPropagation();confirmarFormalizacao(p.id);}}
                    style={{background:"linear-gradient(135deg,#34D399,#059669)",color:"#fff",border:"none",borderRadius:8,padding:"6px 14px",fontSize:11.5,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                    ✅ Cliente Formalizado
                  </button>
                )}
              </div>

              {/* Mensagem de status */}
              <MensagemProposta proposta={p}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DigitacaoPage({ contacts, currentUser, unreadExterno=0 }) {
  const EMAILJS_SVC = "nexp_service";
  const EMAILJS_KEY = "GaZRJdTXt0UMdEY3H";
  const DEST_EMAIL  = "vendas.nexpcred@gmail.com";

  const [abaDigitacao, setAbaDigitacao] = useState("nova"); // "nova" | "minhas"
  const [tipoProposta, setTipoProposta] = useState("FGTS");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [clienteEncontrado, setClienteEncontrado] = useState(false);
  const [minhasPropostas, setMinhasPropostas] = useState([]);
  const [unreadMinhas, setUnreadMinhas] = useState(0);
  const fileRef = useRef();
  const myId = currentUser.uid||currentUser.id;

  // Ouvir minhas propostas em tempo real
  useEffect(() => {
    const unsub = onSnapshot(collection(db,"propostas"), snap => {
      const all = snap.docs.map(d=>({...d.data(),id:d.id}))
        .filter(p=>p.criadoPor===myId)
        .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      setMinhasPropostas(all);
      const comInteracao = all.filter(p=>p.hasNewInteraction && !p.viewedByDigitador?.includes(myId)).length;
      setUnreadMinhas(comInteracao);
    });
    return ()=>unsub();
  }, []); // eslint-disable-line

  const marcarVistaDigitador = async (propId, viewedList) => {
    if (!(viewedList||[]).includes(myId)) {
      await setDoc(doc(db,"propostas",propId),{viewedByDigitador:[...(viewedList||[]),myId]},{merge:true});
    }
  };

  // ── Campos comuns a todos os tipos ──
  const blankComum = () => ({
    cpf:"", nome:"", rg:"", dataNasc:"", dataExpedicao:"", orgaoEmissor:"",
    nomeMae:"", nomePai:"", ufDoc:"", naturalidade:"",
    contato1:"", contato2:"", email1:"", email2:"",
    ufEnd:"", cep:"", rua:"", numero:"", bairro:"", cidade:"", complemento:"",
    bancoPagto:"", agencia:"", contaDigito:"", tipoConta:"corrente", pix1:"", pix2:"",
    observacao:"",
    docTipo:"CNH", docCategoria:"Documentação", docFiles:[],
  });

  const blankFGTS = () => ({ ...blankComum(),
    bancoProposta:"", comSeguro:"NAO", tabela:"", anosAntecipacao:"",
    valorLiberado:"", valorPrometido:"", valorDesconto:"",
  });

  const blankCLT = () => ({ ...blankComum(),
    bancoProposta:"", averbador:"", protocolo:"",
    comSeguro:"NAO", tabela:"",
    valorLiberado:"", valorPrometido:"", parcelas:"", prazo:"",
    matricula:"", empresa:"", cnpj:"",
  });

  const blankINSS = () => ({ ...blankComum(),
    bancoProposta:"", comRepresentante:"NAO", analfabeto:"NAO",
    comSeguro:"NAO", numBeneficio:"", numMatricula:"", tabela:"", margem:"",
    valorLiberado:"", valorPrometido:"", prazo:"", extratoAnexado:"NAO",
  });

  const blankCartao = () => ({ ...blankComum(),
    comSeguro:"NAO", extratoAnexado:"NAO",
    numBeneficio:"", numMatricula:"", tabela:"",
    parcela:"", valorLimite:"", valorSaqueComp:"",
    valorPrometido:"", prazo:"",
    nomeRep:"", cpfRep:"", rgRep:"", dataNascRep:"", dataExpRep:"",
    orgaoRep:"", nomeMaeRep:"", nomePaiRep:"", ufDocRep:"", naturalidadeRep:"",
    contato1Rep:"", contato2Rep:"", email1Rep:"", email2Rep:"",
  });

  const [form, setForm] = useState(blankFGTS());
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  // Troca de tipo reseta o form
  const changeTipo = (t) => {
    setTipoProposta(t);
    setClienteEncontrado(false);
    setMsg("");
    if (t==="FGTS") setForm(blankFGTS());
    else if (t==="CLT") setForm(blankCLT());
    else if (t==="INSS") setForm(blankINSS());
    else setForm(blankCartao());
  };

  // Pré-preencher quando vindo de Ver Clientes via sessionStorage
  useEffect(() => {
    const raw = sessionStorage.getItem("nexp_digitar_cliente");
    const tipo = sessionStorage.getItem("nexp_digitar_tipo");
    if (!raw) return;
    sessionStorage.removeItem("nexp_digitar_cliente");
    sessionStorage.removeItem("nexp_digitar_tipo");
    try {
      const c = JSON.parse(raw);
      if (tipo && ["FGTS","CLT","INSS","CARTÃO"].includes(tipo)) setTipoProposta(tipo);
      setAbaDigitacao("nova");
      setClienteEncontrado(true);
      setForm(f=>({...f,
        cpf:c.cpf||"", nome:c.name||"", contato1:c.phone||"", contato2:c.phone2||"",
        email1:c.email||"", cep:c.cep||"", rua:c.rua||"", numero:c.numero||"",
        bairro:c.bairro||"", cidade:c.cidade||"", complemento:c.complemento||"",
        ufEnd:c.ufEnd||c.uf||"", matricula:c.matricula||"",
        nomeMae:c.nomeMae||"", nomePai:c.nomePai||"",
        rg:c.rg||"", dataNasc:c.dataNasc||"",
        bancoPagto:c.bancoPagto||"", agencia:c.agencia||"",
        contaDigito:c.contaDigito||"", tipoConta:c.tipoConta||"corrente",
        pix1:c.pix1||"", pix2:c.pix2||"",
      }));
    } catch {}
  }, []); // eslint-disable-line

  // Busca automática por CPF
  const buscarCPF = (cpf) => {
    setF("cpf", cpf);
    const clean = cpf.replace(/\D/g,"");
    if (clean.length !== 11) { setClienteEncontrado(false); return; }
    const c = contacts.find(x => (x.cpf||"").replace(/\D/g,"") === clean);
    if (c) {
      setClienteEncontrado(true);
      setForm(f=>({...f,
        cpf, nome:c.name||"", contato1:c.phone||"", contato2:c.phone2||"",
        email1:c.email||"", cep:c.cep||"", rua:c.rua||"", numero:c.numero||"",
        bairro:c.bairro||"", cidade:c.cidade||"", complemento:c.complemento||"",
        ufEnd:c.uf||"", matricula:c.matricula||"",
      }));
    } else { setClienteEncontrado(false); }
  };

  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    const readers = files.map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = async () => {
        let data = r.result;
        // Comprimir imagens já na seleção para preview mais leve
        if (f.type?.startsWith("image/")) {
          data = await comprimirImagem(r.result, 1200, 0.82);
        }
        res({ name: f.name, type: f.type, data, originalType: f.type });
      };
      r.readAsDataURL(f);
    }));
    Promise.all(readers).then(arr => setF("docFiles", [...form.docFiles, ...arr]));
  };
  const removeFile = (i) => setF("docFiles", form.docFiles.filter((_,idx)=>idx!==i));

  const enviar = async () => {
    // Validações
    const erros = [];
    if (!form.cpf) erros.push("CPF é obrigatório");
    if (!form.nome) erros.push("Nome é obrigatório");
    if (form.email1 && !form.email1.includes("@")) erros.push("Email 1 inválido — falta o @");
    if (form.email2 && !form.email2.includes("@")) erros.push("Email 2 inválido — falta o @");
    if (form.docFiles.length===0) erros.push("Documentação obrigatória — anexe ao menos um arquivo");
    if (!form.bancoPagto||!form.agencia||!form.contaDigito) erros.push("Dados bancários são obrigatórios");
    if (erros.length>0) { setMsg("❌ " + erros.join(" · ")); return; }

    setSending(true); setMsg("");
    try {
      const propId = "prop_" + Date.now();

      // ── Upload otimizado: comprime imagens + Cloudinary + fallback Firebase ──
      setMsg("⏳ Comprimindo e enviando arquivos...");
      const docFilesUpload = [];
      for (const f of form.docFiles) {
        const result = await uploadArquivoOtimizado(f.data, f.name, f.type, propId);
        docFilesUpload.push({
          name: f.name,
          type: f.type,
          url: result.url,
          source: result.source,
          path: result.path || "",
        });
      }
      const sourceInfo = docFilesUpload.map(f=>f.source).join(", ");
      setMsg(`⏳ Arquivos enviados (${sourceInfo}) — salvando proposta...`);
      const linhas = [
        `━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📝 NOVA PROPOSTA — ${tipoProposta}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `👤 DADOS DO CLIENTE`,
        `Nome: ${form.nome||"—"}`,
        `CPF: ${form.cpf||"—"}`,
        `RG: ${form.rg||"—"}`,
        `Data Nasc.: ${form.dataNasc||"—"}`,
        `Data Expedição: ${form.dataExpedicao||"—"}`,
        `Órgão Emissor: ${form.orgaoEmissor||"—"}`,
        `UF Doc.: ${form.ufDoc||"—"}`,
        `Nome da Mãe: ${form.nomeMae||"—"}`,
        `Nome do Pai: ${form.nomePai||"—"}`,
        `Naturalidade: ${form.naturalidade||"—"}`,
        ``,
        `📞 CONTATO`,
        `Telefone 1: ${form.contato1||"—"}`,
        `Telefone 2: ${form.contato2||"—"}`,
        `Email 1: ${form.email1||"—"}`,
        `Email 2: ${form.email2||"—"}`,
        ``,
        `📍 ENDEREÇO`,
        `CEP: ${form.cep||"—"}`,
        `Rua: ${form.rua||"—"}, Nº ${form.numero||"—"}`,
        `Bairro: ${form.bairro||"—"}`,
        `Cidade: ${form.cidade||"—"} / UF: ${form.ufEnd||"—"}`,
        `Complemento: ${form.complemento||"—"}`,
        ``,
        `💰 DADOS DA PROPOSTA`,
        tipoProposta==="FGTS"?[
          `Banco Proposta: ${form.bancoProposta||"—"}`,
          `Tabela: ${form.tabela||"—"}`,
          `Anos Antecipação: ${form.anosAntecipacao||"—"}`,
          `Com Seguro: ${form.comSeguro||"—"}`,
          `Valor Liberado: ${form.valorLiberado||"—"}`,
          `Valor Prometido: ${form.valorPrometido||"—"}`,
          `Valor Desconto: ${form.valorDesconto||"—"}`,
        ].join("\n"):"",
        tipoProposta==="CLT"?[
          `Banco Proposta: ${form.bancoProposta||"—"}`,
          `Averbador: ${form.averbador||"—"}`,
          `Protocolo: ${form.protocolo||"—"}`,
          `Tabela: ${form.tabela||"—"}`,
          `Com Seguro: ${form.comSeguro||"—"}`,
          `Valor Liberado: ${form.valorLiberado||"—"}`,
          `Valor Prometido: ${form.valorPrometido||"—"}`,
          `Parcelas: ${form.parcelas||"—"}`,
          `Prazo: ${form.prazo||"—"}`,
          `Matrícula: ${form.matricula||"—"}`,
          `Empresa: ${form.empresa||"—"}`,
          `CNPJ: ${form.cnpj||"—"}`,
        ].join("\n"):"",
        tipoProposta==="INSS"?[
          `Banco Proposta: ${form.bancoProposta||"—"}`,
          `Nº Benefício: ${form.numBeneficio||"—"}`,
          `Nº Matrícula: ${form.numMatricula||"—"}`,
          `Tabela: ${form.tabela||"—"}`,
          `Margem: ${form.margem||"—"}`,
          `Com Seguro: ${form.comSeguro||"—"}`,
          `Com Representante: ${form.comRepresentante||"—"}`,
          `Analfabeto: ${form.analfabeto||"—"}`,
          `Valor Liberado: ${form.valorLiberado||"—"}`,
          `Valor Prometido: ${form.valorPrometido||"—"}`,
          `Prazo: ${form.prazo||"—"}`,
        ].join("\n"):"",
        tipoProposta==="CARTAO"?[
          `Nº Benefício: ${form.numBeneficio||"—"}`,
          `Nº Matrícula: ${form.numMatricula||"—"}`,
          `Tabela: ${form.tabela||"—"}`,
          `Com Seguro: ${form.comSeguro||"—"}`,
          `Parcela: ${form.parcela||"—"}`,
          `Valor Limite: ${form.valorLimite||"—"}`,
          `Valor Saque Comp.: ${form.valorSaqueComp||"—"}`,
          `Valor Prometido: ${form.valorPrometido||"—"}`,
          `Prazo: ${form.prazo||"—"}`,
        ].join("\n"):"",
        ``,
        `🏦 DADOS BANCÁRIOS`,
        `Banco: ${form.bancoPagto||"—"}`,
        `Agência: ${form.agencia||"—"}`,
        `Conta c/ Dígito: ${form.contaDigito||"—"}`,
        `Tipo de Conta: ${form.tipoConta||"—"}`,
        `PIX 1: ${form.pix1||"—"}`,
        `PIX 2: ${form.pix2||"—"}`,
        ``,
        `📎 DOCUMENTOS`,
        `Tipo: ${form.docTipo||"—"}`,
        `Categoria: ${form.docCategoria||"—"}`,
        `Arquivos: ${form.docFiles.map(f=>f.name).join(", ")||"Nenhum"}`,
        form.observacao?`\n📝 OBSERVAÇÃO\n${form.observacao}`:"",
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Digitador: ${currentUser.name||currentUser.email}`,
        `ID: ${propId}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ].filter(Boolean).join("\n");

      await setDoc(doc(db,"propostas",propId), {
        id:propId, tipo:tipoProposta, ...form,
        docFiles: docFilesUpload.map(f=>({name:f.name, type:f.type, url:f.url, path:f.path})),
        criadoPor: currentUser.uid||currentUser.id,
        criadoPorNome: currentUser.name||currentUser.email,
        status:"Aguardando Digitação", createdAt:Date.now(),
      });

      await fetch("https://api.emailjs.com/api/v1.0/email/send",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ service_id:EMAILJS_SVC, template_id:"template_digitacao", user_id:EMAILJS_KEY,
          template_params:{
            to_email: DEST_EMAIL,
            subject: `Nova Proposta ${tipoProposta} — ${form.nome} (${form.cpf})`,
            message: linhas,
            nome: form.nome,
            cpf: form.cpf,
            tipo: tipoProposta,
            digitador: currentUser.name||currentUser.email,
            proposta_id: propId,
          }
        }),
      });
      setMsg("✅ Proposta enviada com sucesso! Email enviado para " + DEST_EMAIL);
      changeTipo(tipoProposta);
    } catch(e) { setMsg("❌ Erro: " + e.message); }
    setSending(false);
  };

  // Subcomponentes passam form e setF como props para evitar re-render com perda de foco
  return (
    <div style={{padding:"24px 32px",maxWidth:960}}>
      {/* Abas: Nova Digitação | Minhas Propostas | Relatório Mensal */}
      <div style={{display:"flex",gap:2,borderBottom:`1px solid ${C.b1}`,marginBottom:20}}>
        {[
          {id:"nova",   label:"📝 Nova Digitação"},
          {id:"minhas", label:"📋 Minhas Propostas", badge: unreadExterno||unreadMinhas},
          {id:"relatorio", label:"📊 Relatório Mensal"},
        ].map(t=>(
          <button key={t.id}
            onClick={()=>{ setAbaDigitacao(t.id); if(t.id==="minhas") minhasPropostas.forEach(p=>marcarVistaDigitador(p.id,p.viewedByDigitador)); }}
            style={{background:"transparent",border:"none",cursor:"pointer",padding:"9px 18px",fontSize:13,
              fontWeight:abaDigitacao===t.id?700:400,color:abaDigitacao===t.id?C.atxt:C.tm,
              borderBottom:abaDigitacao===t.id?`2px solid ${C.atxt}`:"2px solid transparent",
              marginBottom:"-1px",display:"flex",alignItems:"center",gap:7}}>
            {t.label}
            {t.badge>0&&<span style={{background:"#EF4444",color:"#fff",fontSize:9,padding:"2px 6px",borderRadius:9,fontWeight:800,animation:"pulse 1.5s infinite"}}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── Aba Relatório Mensal ── */}
      {abaDigitacao==="relatorio" && (
        <RelatorioDigitacao myId={myId} />
      )}

      {/* Aba Minhas Propostas */}
      {abaDigitacao==="minhas" && (
        <MinhasDigitacoes minhasPropostas={minhasPropostas} myId={myId} />
      )}

      {/* Aba Nova Digitação */}
      {abaDigitacao==="nova" && <>
      {/* Header */}
      <div style={{marginBottom:16}}>
        <h1 style={{color:C.tp,fontSize:21,fontWeight:700,margin:0}}>📝 Digitação de Proposta</h1>
        <p style={{color:C.tm,fontSize:12.5,margin:"4px 0 0"}}>Preencha os dados conforme o tipo de produto</p>
      </div>

      {/* Seletor de tipo */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {[
          {id:"FGTS",label:"🏦 FGTS",color:"#4F8EF7"},
          {id:"CLT",label:"💼 CLT",color:"#34D399"},
          {id:"INSS",label:"🏥 INSS",color:"#C084FC"},
          {id:"CARTAO",label:"💳 Cartão Consignado",color:"#FB923C"},
        ].map(t=>(
          <button key={t.id} onClick={()=>changeTipo(t.id)}
            style={{background:tipoProposta===t.id?t.color+"22":C.deep,
              color:tipoProposta===t.id?t.color:C.tm,
              border:`2px solid ${tipoProposta===t.id?t.color+"66":C.b2}`,
              borderRadius:10,padding:"9px 20px",fontSize:13,fontWeight:tipoProposta===t.id?700:400,
              cursor:"pointer",transition:"all 0.15s",
              boxShadow:tipoProposta===t.id?`0 2px 12px ${t.color}33`:"none"}}>
            {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div style={{background:msg.startsWith("✅")?"#091E12":"#2D1515",
          border:`1px solid ${msg.startsWith("✅")?"#34D39933":"#EF444433"}`,
          borderRadius:9,padding:"11px 16px",marginBottom:16,
          color:msg.startsWith("✅")?"#34D399":"#F87171",fontSize:13}}>
          {msg}
        </div>
      )}

      {/* ═══ FGTS ═══ */}
      {tipoProposta==="FGTS" && (<>
        <div style={{...S.card,padding:"20px 22px",marginBottom:12}}>
          <DSecTitle icon="🏦" title="Informações da Proposta — FGTS" color="#4F8EF7"/>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Banco da Proposta" k="bancoProposta" req/>
            <DInp form={form} setF={setF} label="Tabela" k="tabela" ph="Ex: COMETA"/>
            <DInp form={form} setF={setF} label="Anos de Antecipação" k="anosAntecipacao" ph="Ex: 3"/>
          </DGrid>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Valor Liberado (R$)" k="valorLiberado" ph="R$ 0,00" req mask="moeda"/>
            <DInp form={form} setF={setF} label="Valor Prometido ao Cliente (R$)" k="valorPrometido" ph="R$ 0,00" mask="moeda"/>
            <DInp form={form} setF={setF} label="Valor de Desconto (R$)" k="valorDesconto" ph="R$ 0,00" mask="moeda"/>
          </DGrid>
          <DGrid cols={2}>
            <DSN form={form} setF={setF} label="Com Seguro?" k="comSeguro"/>
          </DGrid>
        </div>
      </>)}

      {/* ═══ CLT ═══ */}
      {tipoProposta==="CLT" && (<>
        <div style={{...S.card,padding:"20px 22px",marginBottom:12}}>
          <DSecTitle icon="💼" title="Informações da Proposta — CLT" color="#34D399"/>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Banco da Proposta" k="bancoProposta" ph="Ex: V8 DIGITAL" req/>
            <DInp form={form} setF={setF} label="Averbador" k="averbador" ph="Ex: CELCOIN"/>
            <DInp form={form} setF={setF} label="Protocolo" k="protocolo"/>
          </DGrid>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Tabela" k="tabela" ph="Ex: CLT ACELERA"/>
            <DInp form={form} setF={setF} label="Valor Liberado (R$)" k="valorLiberado" ph="R$ 0,00" req mask="moeda"/>
            <DInp form={form} setF={setF} label="Valor Prometido ao Cliente (R$)" k="valorPrometido" ph="R$ 0,00" mask="moeda"/>
          </DGrid>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Parcelas (R$)" k="parcelas" ph="R$ 0,00"/>
            <DInp form={form} setF={setF} label="Prazo" k="prazo" ph="Ex: 12x"/>
            <DSN form={form} setF={setF} label="Com Seguro?" k="comSeguro"/>
          </DGrid>
          <DSecTitle icon="🏢" title="Dados da Empresa"/>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Empresa" k="empresa"/>
            <DInp form={form} setF={setF} label="CNPJ" k="cnpj"/>
            <DInp form={form} setF={setF} label="Matrícula" k="matricula"/>
          </DGrid>
        </div>
      </>)}

      {/* ═══ INSS ═══ */}
      {tipoProposta==="INSS" && (<>
        <div style={{...S.card,padding:"20px 22px",marginBottom:12}}>
          <DSecTitle icon="🏥" title="Informações da Proposta — INSS" color="#C084FC"/>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Banco da Proposta" k="bancoProposta" req/>
            <DInp form={form} setF={setF} label="Nº do Benefício" k="numBeneficio"/>
            <DInp form={form} setF={setF} label="Nº da Matrícula" k="numMatricula"/>
          </DGrid>
          <DGrid cols={4}>
            <DInp form={form} setF={setF} label="Tabela" k="tabela"/>
            <DInp form={form} setF={setF} label="Margem (R$)" k="margem" ph="Ex: 424,00" mask="moeda"/>
            <DInp form={form} setF={setF} label="Valor Liberado (R$)" k="valorLiberado" ph="R$ 0,00" req mask="moeda"/>
            <DInp form={form} setF={setF} label="Valor Prometido (R$)" k="valorPrometido" ph="R$ 0,00" mask="moeda"/>
          </DGrid>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Prazo das Parcelas" k="prazo" ph="Ex: 84x"/>
            <DSN form={form} setF={setF} label="Com Seguro?" k="comSeguro"/>
            <DSN form={form} setF={setF} label="Extrato Anexado?" k="extratoAnexado"/>
          </DGrid>
          <DGrid cols={2}>
            <DSN form={form} setF={setF} label="Com Representante Legal?" k="comRepresentante"/>
            <DSN form={form} setF={setF} label="Analfabeto?" k="analfabeto"/>
          </DGrid>
        </div>
      </>)}

      {/* ═══ CARTÃO CONSIGNADO ═══ */}
      {tipoProposta==="CARTAO" && (<>
        <div style={{...S.card,padding:"20px 22px",marginBottom:12}}>
          <DSecTitle icon="💳" title="Informações da Proposta — Cartão Consignado" color="#FB923C"/>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Nº do Benefício" k="numBeneficio"/>
            <DInp form={form} setF={setF} label="Nº da Matrícula" k="numMatricula"/>
            <DInp form={form} setF={setF} label="Tabela" k="tabela" ph="Ex: NORMAL"/>
          </DGrid>
          <DGrid cols={4}>
            <DInp form={form} setF={setF} label="Parcela (R$)" k="parcela" ph="R$ 0,00" mask="moeda"/>
            <DInp form={form} setF={setF} label="Valor do Limite (R$)" k="valorLimite" ph="R$ 0,00" mask="moeda"/>
            <DInp form={form} setF={setF} label="Valor Saque Complementar (R$)" k="valorSaqueComp" ph="R$ 0,00" mask="moeda"/>
            <DInp form={form} setF={setF} label="Valor Prometido ao Cliente (R$)" k="valorPrometido" ph="R$ 0,00" req mask="moeda"/>
          </DGrid>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Prazo das Parcelas" k="prazo" ph="Ex: 96x"/>
            <DSN form={form} setF={setF} label="Com Seguro?" k="comSeguro"/>
            <DSN form={form} setF={setF} label="Extrato Anexado?" k="extratoAnexado"/>
          </DGrid>
        </div>
      </>)}

      {/* ═══ DOCUMENTO DO CLIENTE (todos) ═══ */}
      <div style={{...S.card,padding:"20px 22px",marginBottom:12}}>
        <DSecTitle icon="🪪" title={tipoProposta==="CARTAO"?"Informações do Documento — Cliente":"Informações do Documento"}/>
        <div style={{background:clienteEncontrado?"#091E12":C.deep,borderRadius:9,padding:"7px 12px",marginBottom:12,border:`1px solid ${clienteEncontrado?"#34D39933":C.b1}`,fontSize:11.5,color:clienteEncontrado?"#34D399":C.tm,display:"flex",alignItems:"center",gap:7}}>
          {clienteEncontrado?"✓ Cliente encontrado no sistema — dados preenchidos automaticamente":"Digite o CPF para buscar dados automaticamente"}
        </div>
        <DGrid cols={3}>
          <div>
            <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:3}}>CPF <span style={{color:"#EF4444"}}>*</span></label>
            <input value={form.cpf||""} onChange={e=>buscarCPF(e.target.value)} placeholder="000.000.000-00"
              style={{...S.input,fontSize:12,padding:"7px 10px",borderColor:clienteEncontrado?"#34D39944":undefined}}/>
          </div>
          <DInp form={form} setF={setF} label="Nome do Cliente" k="nome" req/>
          <DInp form={form} setF={setF} label="RG" k="rg"/>
        </DGrid>
        <DGrid cols={4}>
          <DDat form={form} setF={setF} label="Data de Nascimento" k="dataNasc" min="1950-01-01" max="2026-12-31"/>
          <DDat form={form} setF={setF} label="Data de Expedição" k="dataExpedicao" min="2001-01-01" max="2026-12-31"/>
          <DInp form={form} setF={setF} label="Órgão Emissor" k="orgaoEmissor" ph="Ex: DETRAN"/>
          <DUF val={form.ufDoc||""} onChange={v=>setF("ufDoc",v)} label="UF do Documento"/>
        </DGrid>
        <DGrid cols={3}>
          <DInp form={form} setF={setF} label="Nome da Mãe" k="nomeMae"/>
          <DInp form={form} setF={setF} label="Nome do Pai" k="nomePai"/>
          <DInp form={form} setF={setF} label="Naturalidade" k="naturalidade" ph="Ex: ITABORAI - RJ"/>
        </DGrid>
        {tipoProposta==="CLT" && (
          <DGrid cols={2}>
            <DInp form={form} setF={setF} label="Matrícula" k="matricula"/>
            <DInp form={form} setF={setF} label="Empresa" k="empresa"/>
          </DGrid>
        )}
      </div>

      {/* ═══ REPRESENTANTE (só Cartão Consignado) ═══ */}
      {tipoProposta==="CARTAO" && (
        <div style={{...S.card,padding:"20px 22px",marginBottom:12,border:`1px solid #FB923C33`}}>
          <DSecTitle icon="👤" title="Informações do Documento — Representante" color="#FB923C"/>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Nome do Representante" k="nomeRep" req/>
            <DInp form={form} setF={setF} label="CPF do Representante" k="cpfRep" mask="cpf"/>
            <DInp form={form} setF={setF} label="RG do Representante" k="rgRep"/>
          </DGrid>
          <DGrid cols={4}>
            <DDat form={form} setF={setF} label="Data de Nascimento" k="dataNascRep" min="1950-01-01" max="2026-12-31"/>
            <DDat form={form} setF={setF} label="Data de Expedição" k="dataExpRep" min="2001-01-01" max="2026-12-31"/>
            <DInp form={form} setF={setF} label="Órgão Emissor" k="orgaoRep" ph="Ex: DETRAN"/>
            <DInp form={form} setF={setF} label="UF do Documento" k="ufDocRep" ph="Ex: RJ"/>
          </DGrid>
          <DGrid cols={3}>
            <DInp form={form} setF={setF} label="Nome da Mãe" k="nomeMaeRep"/>
            <DInp form={form} setF={setF} label="Nome do Pai" k="nomePaiRep"/>
            <DInp form={form} setF={setF} label="Naturalidade" k="naturalidadeRep"/>
          </DGrid>
          <DSecTitle icon="📞" title="Contato do Representante"/>
          <DGrid cols={4}>
            <DInp form={form} setF={setF} label="Contato 1" k="contato1Rep" type="tel" ph="(00) 00000-0000" mask="fone"/>
            <DInp form={form} setF={setF} label="Contato 2" k="contato2Rep" type="tel" mask="fone"/>
            <DInp form={form} setF={setF} label="Email 1" k="email1Rep" type="email"/>
            <DInp form={form} setF={setF} label="Email 2" k="email2Rep" type="email"/>
          </DGrid>
        </div>
      )}

      {/* ═══ CONTATO ═══ */}
      <div style={{...S.card,padding:"20px 22px",marginBottom:12}}>
        <DSecTitle icon="📞" title={tipoProposta==="CARTAO"?"Informações de Contato — Cliente":"Informações de Contato"}/>
        <DGrid cols={4}>
          <DInp form={form} setF={setF} label="Contato 1" k="contato1" type="tel" ph="(00) 00000-0000" req mask="fone"/>
          <DInp form={form} setF={setF} label="Contato 2" k="contato2" type="tel" mask="fone"/>
          <DInp form={form} setF={setF} label="Email 1" k="email1" type="email"/>
          <DInp form={form} setF={setF} label="Email 2" k="email2" type="email"/>
        </DGrid>
      </div>

      {/* ═══ ENDEREÇO ═══ */}
      <div style={{...S.card,padding:"20px 22px",marginBottom:12}}>
        <DSecTitle icon="📍" title="Informações de Endereço"/>
        <DGrid cols={4}>
          <DUF val={form.ufEnd||""} onChange={v=>setF("ufEnd",v)} label="UF do Endereço"/>
          <DCep form={form} setF={setF}/>
          <DInp form={form} setF={setF} label="Rua" k="rua" req/>
          <DInp form={form} setF={setF} label="Número" k="numero"/>
        </DGrid>
        <DGrid cols={3}>
          <DInp form={form} setF={setF} label="Bairro" k="bairro"/>
          <DInp form={form} setF={setF} label="Cidade" k="cidade"/>
          <DInp form={form} setF={setF} label="Complemento" k="complemento"/>
        </DGrid>
      </div>

      {/* ═══ PAGAMENTO ═══ */}
      <div style={{...S.card,padding:"20px 22px",marginBottom:12,border:`1px solid #FBBF2422`}}>
        <DSecTitle icon="🏦" title="Informações de Pagamento ao Cliente" color="#FBBF24"/>
        <div style={{background:"#2B1D0322",borderRadius:8,padding:"7px 12px",marginBottom:10,fontSize:11,color:"#FBBF24"}}>
          ⚠ Preenchimento manual obrigatório — não é preenchido automaticamente
        </div>
        <DGrid cols={4}>
          <DInp form={form} setF={setF} label="Banco" k="bancoPagto" ph="Ex: BRADESCO" req/>
          <DInp form={form} setF={setF} label="Agência" k="agencia" ph="Ex: 6856" req/>
          <DInp form={form} setF={setF} label="Conta com Dígito" k="contaDigito" ph="Ex: 19136-1" req/>
          <DSel form={form} setF={setF} label="Tipo de Conta" k="tipoConta" opts={[{v:"corrente",l:"Corrente"},{v:"poupanca",l:"Poupança"}]}/>
        </DGrid>
        <DGrid cols={2}>
          <DInp form={form} setF={setF} label="1ª Chave PIX" k="pix1" ph="CPF, email, telefone ou aleatória"/>
          <DInp form={form} setF={setF} label="2ª Chave PIX" k="pix2" ph="Opcional"/>
        </DGrid>
      </div>

      {/* ═══ DOCUMENTAÇÃO ═══ */}
      <div style={{...S.card,padding:"20px 22px",marginBottom:12,border:`1px solid ${form.docFiles.length>0?"#34D39933":"#EF444433"}`}}>
        <DSecTitle icon="📎" title={`Documentação Obrigatória ${form.docFiles.length>0?"✓":"— Nenhum arquivo"}`} color={form.docFiles.length>0?"#34D399":"#F87171"}/>
        <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
          <div style={{flex:1}}>
            <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:5}}>Tipo de Documento</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {["CNH","RG","Carteira de Trabalho","RNE","Outro"].map(t=>(
                <button key={t} onClick={()=>setF("docTipo",t)}
                  style={{background:form.docTipo===t?C.abg:C.deep,color:form.docTipo===t?C.atxt:C.tm,
                    border:`1px solid ${form.docTipo===t?C.atxt+"44":C.b2}`,
                    borderRadius:20,padding:"4px 13px",fontSize:11.5,cursor:"pointer",fontWeight:form.docTipo===t?700:400}}>
                  {form.docTipo===t?"✓ ":""}{t}
                </button>
              ))}
            </div>
          </div>
          <div style={{flex:1}}>
            <label style={{color:C.tm,fontSize:10.5,display:"block",marginBottom:5}}>Categoria</label>
            <div style={{display:"flex",gap:6}}>
              {["Documentação","Evidências","Outros"].map(cat=>(
                <button key={cat} onClick={()=>setF("docCategoria",cat)}
                  style={{background:form.docCategoria===cat?C.abg:C.deep,color:form.docCategoria===cat?C.atxt:C.tm,
                    border:`1px solid ${form.docCategoria===cat?C.atxt+"44":C.b2}`,
                    borderRadius:20,padding:"4px 13px",fontSize:11.5,cursor:"pointer",fontWeight:form.docCategoria===cat?700:400}}>
                  {form.docCategoria===cat?"✓ ":""}{cat}
                </button>
              ))}
            </div>
          </div>
        </div>
        <input ref={fileRef} type="file" multiple accept="image/*,.pdf" onChange={handleFiles} style={{display:"none"}}/>
        <button onClick={()=>fileRef.current.click()}
          style={{background:C.abg,color:C.atxt,border:`1px solid ${C.atxt}33`,borderRadius:9,padding:"8px 18px",fontSize:12.5,fontWeight:600,cursor:"pointer",marginBottom:8}}>
          📎 Adicionar arquivos
        </button>
        {form.docFiles.length>0&&(
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {form.docFiles.map((f,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:C.deep,borderRadius:8,padding:"6px 12px",border:`1px solid ${C.b1}`}}>
                {f.type?.startsWith("image/") && f.data ? (
                  <img src={f.data} alt="" style={{width:32,height:32,objectFit:"cover",borderRadius:5,flexShrink:0}}/>
                ) : (
                  <span style={{fontSize:18,flexShrink:0}}>📄</span>
                )}
                <span style={{flex:1,color:C.ts,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                <span style={{color:C.td,fontSize:10,flexShrink:0}}>{(f.data?.length/1.37/1024).toFixed(0)} KB</span>
                <button onClick={()=>removeFile(i)} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer",fontSize:13,flexShrink:0}}>✕</button>
              </div>
            ))}
          </div>
        )}
        {form.docFiles.length===0&&<div style={{color:"#F87171",fontSize:11.5,marginTop:4}}>⚠ Nenhum arquivo. Documentação é obrigatória.</div>}
      </div>

      {/* ═══ OBSERVAÇÕES ═══ */}
      <div style={{...S.card,padding:"20px 22px",marginBottom:20}}>
        <DSecTitle icon="💬" title="Observações da Proposta"/>
        <textarea value={form.observacao||""} onChange={e=>setF("observacao",e.target.value)} rows={3}
          placeholder="Informações adicionais sobre o cliente ou proposta..."
          style={{...S.input,resize:"vertical",fontSize:12}}/>
      </div>

      <button onClick={enviar} disabled={sending}
        style={{background:`linear-gradient(135deg,${C.lg1},${C.lg2})`,color:"#fff",border:"none",
          borderRadius:11,padding:"13px 36px",fontSize:15,fontWeight:800,
          cursor:sending?"not-allowed":"pointer",opacity:sending?0.7:1,
          boxShadow:`0 4px 20px ${C.acc}44`,display:"flex",alignItems:"center",gap:10}}>
        {sending?"⏳ Enviando...":"📤 Enviar Proposta"}
      </button>
      </>}
    </div>
  );
}

// ── Status e cores de proposta ─────────────────────────────────
const STATUS_PROPOSTA = [
  "Aguardando Digitação",
  "Proposta Digitada",
  "Aguardando Formalização",
  "Cliente Formalizado",
  "Aguardando Checagem de Formalização",
  "Pendente",
  "Análise Manual",
  "Análise Manual → Dados Editados",
  "Pago Aguardando Confirmação",
  "Proposta Concluída",
  "Cancelada",
];
const STATUS_PROPOSTA_COLORS = {
  "Aguardando Digitação":              "#94A3B8",
  "Proposta Digitada":                 "#60A5FA",
  "Aguardando Formalização":           "#FBBF24",
  "Cliente Formalizado":               "#34D399",
  "Aguardando Checagem de Formalização":"#A78BFA",
  "Pendente":                          "#F87171",
  "Análise Manual":                    "#FB923C",
  "Análise Manual → Dados Editados":   "#F97316",
  "Pago Aguardando Confirmação":       "#C084FC",
  "Proposta Concluída":                "#34D399",
  "Cancelada":                         "#EF4444",
};
// Status visíveis apenas para propostas (mestre/master/digitador)
// ── Mensagem que o digitador vê em Minhas Propostas ─────────────
function MensagemProposta({ proposta }) {
  const st = proposta.status || "Proposta Digitada";

  if (st === "Proposta Digitada") return (
    <div style={{background:"#0D2037",borderRadius:10,padding:"12px 16px",border:"1px solid #60A5FA33",marginTop:10}}>
      <div style={{color:"#60A5FA",fontWeight:700,fontSize:12,marginBottom:4}}>📤 Equipe de Digitação</div>
      <div style={{color:C.ts,fontSize:12.5,lineHeight:1.7}}>
        Aguardando link de formalização — Digitador está enviando ao banco.
      </div>
    </div>
  );

  if (st === "Aguardando Formalização") return (
    <div style={{background:"#1A1400",borderRadius:10,padding:"12px 16px",border:"1px solid #FBBF2444",marginTop:10}}>
      <div style={{color:"#FBBF24",fontWeight:700,fontSize:12,marginBottom:6}}>📋 Equipe de Digitação — AGUARDANDO FORMALIZAÇÃO DIGITAL</div>
      {proposta.linkFormalizacao && (
        <div style={{marginBottom:8}}>
          <span style={{color:C.ts,fontSize:12}}>SEGUE LINK → </span>
          <a href={proposta.linkFormalizacao} target="_blank" rel="noopener noreferrer"
            style={{color:"#60A5FA",fontSize:12,fontWeight:600,wordBreak:"break-all"}}>{proposta.linkFormalizacao}</a>
        </div>
      )}
      <div style={{background:"#2B1D00",borderRadius:8,padding:"10px 12px",borderLeft:"3px solid #FBBF24",fontSize:11.5,color:C.ts,lineHeight:1.8}}>
        <span style={{color:"#FBBF24",fontWeight:700}}>⚠️ Observação:</span><br/>
        Caso o Cliente não consiga acessar o link, solicite que o mesmo feche todas as abas do celular e tente novamente, caso o erro persista, solicite que tente por outro navegador ou outro celular!
      </div>
    </div>
  );

  if (st === "Cancelada") return (
    <div style={{background:"#1A0000",borderRadius:10,padding:"12px 16px",border:"1px solid #EF444444",marginTop:10}}>
      <div style={{color:"#EF4444",fontWeight:800,fontSize:13,marginBottom:8}}>❌ Equipe de Digitação — PROPOSTA CANCELADA</div>
      <div style={{color:C.ts,fontSize:12,lineHeight:1.8}}>
        <b style={{color:C.tm}}>Motivo do cancelamento:</b> {proposta.motivoCancelamento||"—"}<br/>
        <b style={{color:C.tm}}>Solução:</b> {proposta.solucaoCancelamento||"—"}<br/>
        <b style={{color:C.tm}}>Observação:</b> {proposta.obsCancelamento||"—"}
      </div>
      <div style={{color:"#F87171",fontSize:11,marginTop:8,fontStyle:"italic"}}>
        Em casos excepcionais pode haver uma demora de 7 dias para que a proposta apareça como cancelada no banco, nesses casos é só aguardar!<br/>
        <b>@nexpcred / #teamnexpcred / com você somos mais 🏆</b>
      </div>
    </div>
  );

  if (st === "Pendente") return (
    <div style={{background:"#1A0000",borderRadius:10,padding:"12px 16px",border:"1px solid #F8717144",marginTop:10}}>
      <div style={{color:"#F87171",fontWeight:800,fontSize:13,marginBottom:8}}>🔴 PROPOSTA PENDENTE DE DADOS BANCÁRIOS</div>
      <div style={{color:C.ts,fontSize:12,lineHeight:2.0}}>
        <b style={{color:C.tm}}>( INFORMAÇÕES para REAPRESENTAÇÃO )</b><br/>
        BANCO: {proposta.bancoPendente||"_______________"}<br/>
        AGÊNCIA: {proposta.agenciaPendente||"_______________"}<br/>
        CONTA COM DÍGITO: {proposta.contaPendente||"_______________"}<br/>
        TIPO DE CONTA: {proposta.tipoContaPendente||"_______________"}<br/>
        INFORME A 1ª CHAVE PIX: {proposta.pix1Pendente||"_______________"}<br/>
        INFORME A 2ª CHAVE PIX: {proposta.pix2Pendente||"_______________"}<br/>
        <b style={{color:C.tm}}>( OBSERVAÇÃO )</b><br/>
        {proposta.obsPendente||"—"}<br/>
        ANEXAR EXTRATO OU PRINT DA CONTA: {(proposta.extratoAnexado||[]).length>0?"✅ Anexado":"❌ Pendente"}
      </div>
    </div>
  );

  if (st === "Pago Aguardando Confirmação") return (
    <PagoBlock proposta={proposta}/>
  );

  if (st === "Proposta Concluída") return (
    <div style={{background:"#071A0A",borderRadius:10,padding:"16px",border:"1px solid #34D39944",marginTop:10,textAlign:"center"}}>
      <div style={{fontSize:36,marginBottom:6}}>🏆</div>
      <div style={{color:"#34D399",fontWeight:800,fontSize:15}}>PROPOSTA CONCLUÍDA COM SUCESSO ✅</div>
      <div style={{color:"#4ADE80",fontSize:13,marginTop:4}}>Parabéns pela venda!</div>
    </div>
  );

  return null;
}

// ── Bloco de pagamento com upload de evidência ──────────────────
function PagoBlock({ proposta }) {
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const evFileRef = useRef();

  const handleEvidencia = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true); setMsg("");
    try {
      const uploads = [];
      for (const f of files) {
        const data = await new Promise(res => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(f);
        });
        const result = await uploadArquivoOtimizado(data, f.name, f.type, proposta.id);
        uploads.push({ name: f.name, type: f.type, url: result.url, source: result.source });
      }
      const prev = proposta.evidenciaConfirmacao || [];
      await setDoc(doc(db,"propostas",proposta.id), {
        evidenciaConfirmacao: [...prev, ...uploads],
        hasNewInteraction: true,
        viewedByDigitador: [],
      }, {merge:true});
      setMsg("✅ Evidências enviadas com sucesso!");
    } catch (err) {
      setMsg("❌ Erro ao enviar: " + err.message);
    }
    setUploading(false);
  };

  const evidencias = proposta.evidenciaConfirmacao || [];

  return (
    <div style={{background:"#0D0A1A",borderRadius:10,padding:"12px 16px",border:"1px solid #C084FC44",marginTop:10}}>
      <div style={{color:"#C084FC",fontWeight:800,fontSize:14,marginBottom:6}}>✅ PROPOSTA PAGA COM SUCESSO</div>
      <div style={{color:"#34D399",fontWeight:700,fontSize:13,marginBottom:8}}>🏆 PARABÉNS PELA VENDA!</div>
      <div style={{color:C.ts,fontSize:12,lineHeight:1.8,marginBottom:10}}>
        Confirme com seu cliente se o mesmo recebeu o valor.<br/>
        Tire um print de evidência e anexe para que possamos finalizar sua proposta!
      </div>

      {/* Evidências já enviadas */}
      {evidencias.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
          {evidencias.map((ev,i) => (
            <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer"
              style={{background:"#0D2037",color:"#34D399",fontSize:11,padding:"5px 12px",borderRadius:8,border:"1px solid #34D39933",textDecoration:"none",display:"flex",alignItems:"center",gap:6,fontWeight:600}}>
              {ev.type?.startsWith("image/")?"🖼":"📄"} {ev.name} ↗
            </a>
          ))}
        </div>
      )}

      {msg && <div style={{color:msg.startsWith("✅")?"#34D399":"#F87171",fontSize:11.5,marginBottom:8,fontWeight:600}}>{msg}</div>}

      {evidencias.length === 0 && (
        <div style={{background:"#1A1000",borderRadius:8,padding:"8px 12px",marginBottom:10,color:"#FBBF24",fontSize:11.5,fontWeight:600}}>
          ⏳ PENDENTE DE EVIDÊNCIA DE PAGAMENTO — Anexe o print de confirmação abaixo
        </div>
      )}

      <input ref={evFileRef} type="file" multiple accept="image/*,.pdf" onChange={handleEvidencia} style={{display:"none"}}/>
      <button onClick={()=>evFileRef.current?.click()} disabled={uploading}
        style={{background:uploading?"#333":"linear-gradient(135deg,#C084FC,#7C3AED)",color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontSize:12,fontWeight:700,cursor:uploading?"not-allowed":"pointer",opacity:uploading?0.7:1}}>
        {uploading?"⏳ Enviando...":"📎 Anexar Print de Confirmação"}
      </button>
    </div>
  );
}

// ── Modal de ação do digitador ─────────────────────────────────
function ModalAcaoProposta({ proposta, onClose, onSave }) {
  const [novoStatus, setNovoStatus] = useState(proposta.status||"Proposta Digitada");
  const [link, setLink] = useState(proposta.linkFormalizacao||"");
  const [motivo, setMotivo] = useState(proposta.motivoCancelamento||"");
  const [solucao, setSolucao] = useState(proposta.solucaoCancelamento||"");
  const [obs, setObs] = useState(proposta.obsCancelamento||"");
  const [banco, setBanco] = useState(proposta.bancoPendente||"");
  const [agencia, setAgencia] = useState(proposta.agenciaPendente||"");
  const [conta, setConta] = useState(proposta.contaPendente||"");
  const [tipoConta, setTipoConta] = useState(proposta.tipoContaPendente||"corrente");
  const [pix1, setPix1] = useState(proposta.pix1Pendente||"");
  const [pix2, setPix2] = useState(proposta.pix2Pendente||"");
  const [obsPend, setObsPend] = useState(proposta.obsPendente||"");
  const [saving, setSaving] = useState(false);

  const inp = (label, val, set, ph="") => (
    <div style={{marginBottom:10}}>
      <label style={{color:C.tm,fontSize:11,display:"block",marginBottom:3}}>{label}</label>
      <input value={val} onChange={e=>set(e.target.value)} placeholder={ph} style={{...S.input}}/>
    </div>
  );
  const ta = (label, val, set, ph="") => (
    <div style={{marginBottom:10}}>
      <label style={{color:C.tm,fontSize:11,display:"block",marginBottom:3}}>{label}</label>
      <textarea value={val} onChange={e=>set(e.target.value)} placeholder={ph} rows={2} style={{...S.input,resize:"vertical"}}/>
    </div>
  );

  const handleSave = async () => {
    setSaving(true);
    const data = { status: novoStatus, hasNewInteraction:true, viewedByDigitador:[] };
    if (novoStatus==="Aguardando Formalização") data.linkFormalizacao = link;
    if (novoStatus==="Cancelada") { data.motivoCancelamento=motivo; data.solucaoCancelamento=solucao; data.obsCancelamento=obs; }
    if (novoStatus==="Pendente") {
      // Devolução de pagamento — preencher campos para o digitador responder
      data.bancoPendente=banco; data.agenciaPendente=agencia; data.contaPendente=conta;
      data.tipoContaPendente=tipoConta; data.pix1Pendente=pix1; data.pix2Pendente=pix2; data.obsPendente=obsPend;
    }
    if (novoStatus==="Pago Aguardando Confirmação") data.pagoAt = Date.now();
    await onSave(proposta.id, data);
    setSaving(false);
    onClose();
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn 0.2s ease"}}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.b1}`,borderRadius:18,padding:"24px 28px",maxWidth:500,width:"92%",maxHeight:"88vh",overflowY:"auto",boxShadow:"0 12px 48px rgba(0,0,0,0.8)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
          <div style={{color:C.tp,fontSize:15,fontWeight:700}}>Atualizar Proposta — {proposta.nome}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.tm,cursor:"pointer",fontSize:18}}>✕</button>
        </div>

        {/* Seletor de status */}
        <div style={{marginBottom:16}}>
          <label style={{color:C.tm,fontSize:11,display:"block",marginBottom:8}}>Novo status</label>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {STATUS_PROPOSTA.map(s=>{
              const col = STATUS_PROPOSTA_COLORS[s]||C.atxt;
              return (
                <button key={s} onClick={()=>setNovoStatus(s)}
                  style={{background:novoStatus===s?col+"22":C.deep,color:novoStatus===s?col:C.tm,
                    border:`1px solid ${novoStatus===s?col+"55":C.b2}`,borderRadius:9,padding:"8px 14px",
                    fontSize:12.5,cursor:"pointer",fontWeight:novoStatus===s?700:400,textAlign:"left"}}>
                  {novoStatus===s?"● ":""}{s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Campos extras por status */}
        {novoStatus==="Aguardando Formalização" && (
          <div style={{background:C.deep,borderRadius:10,padding:"14px",marginBottom:12}}>
            <div style={{color:"#FBBF24",fontSize:12,fontWeight:700,marginBottom:10}}>🔗 Link de Formalização</div>
            {inp("Cole o link de formalização aqui",link,setLink,"https://...")}
          </div>
        )}

        {novoStatus==="Cancelada" && (
          <div style={{background:C.deep,borderRadius:10,padding:"14px",marginBottom:12}}>
            <div style={{color:"#EF4444",fontSize:12,fontWeight:700,marginBottom:10}}>❌ Detalhes do Cancelamento</div>
            {ta("Motivo do cancelamento",motivo,setMotivo,"Ex: Margem insuficiente")}
            {ta("Solução",solucao,setSolucao,"Ex: Aguardar liberação de margem")}
            {ta("Observação",obs,setObs,"Informações adicionais")}
          </div>
        )}

        {novoStatus==="Pendente" && (
          <div style={{background:C.deep,borderRadius:10,padding:"14px",marginBottom:12}}>
            <div style={{color:"#F87171",fontSize:12,fontWeight:700,marginBottom:10}}>🔴 Dados para Reapresentação</div>
            {inp("Banco",banco,setBanco,"Ex: Banco do Brasil")}
            {inp("Agência",agencia,setAgencia,"Ex: 0001")}
            {inp("Conta com dígito",conta,setConta,"Ex: 12345-6")}
            <div style={{marginBottom:10}}>
              <label style={{color:C.tm,fontSize:11,display:"block",marginBottom:3}}>Tipo de conta</label>
              <select value={tipoConta} onChange={e=>setTipoConta(e.target.value)} style={{...S.input,cursor:"pointer"}}>
                <option value="corrente">Corrente</option>
                <option value="poupanca">Poupança</option>
              </select>
            </div>
            {inp("1ª Chave PIX",pix1,setPix1,"CPF, email ou telefone")}
            {inp("2ª Chave PIX",pix2,setPix2,"Opcional")}
            {ta("Observação",obsPend,setObsPend)}
          </div>
        )}

        <button onClick={handleSave} disabled={saving}
          style={{background:`linear-gradient(135deg,${C.lg1},${C.lg2})`,color:"#fff",border:"none",borderRadius:10,
            padding:"11px 28px",fontSize:13,fontWeight:700,cursor:saving?"not-allowed":"pointer",opacity:saving?0.7:1,width:"100%"}}>
          {saving?"⏳ Salvando...":"✅ Confirmar"}
        </button>

        {/* Botão Permitir Edição — libera o digitador a editar a proposta */}
        <button onClick={async()=>{
          setSaving(true);
          await setDoc(doc(db,"propostas",proposta.id),{
            editPermitido:true,
            hasNewInteraction:true,
            viewedByDigitador:[],
          },{merge:true});
          // Notificar digitador
          await setDoc(doc(db,"notifications","editperm_"+proposta.id+"_"+Date.now()),{
            toId: proposta.criadoPor,
            type: "edicao_liberada",
            text: `🔓 Edição liberada — você pode editar a proposta de ${proposta.nome} (${proposta.cpf})`,
            propostaId: proposta.id,
            createdAt: Date.now(),
            readAt: null,
          });
          setSaving(false);
          onClose();
        }} disabled={saving}
          style={{background:"#1A1400",color:"#FBBF24",border:"2px solid #FBBF2444",borderRadius:10,
            padding:"10px 28px",fontSize:13,fontWeight:700,cursor:saving?"not-allowed":"pointer",width:"100%",marginTop:8,opacity:saving?0.7:1}}>
          🔓 Permitir Edição de Proposta
        </button>
      </div>
    </div>
  );
}

// ── PropostasPage ───────────────────────────────────────────────

// ── Relatório Mensal + Anual de Propostas ──────────────────────
function RelatorioProposta({ propostas, canSeeAll, myId }) {
  const now = new Date();
  const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const fmtBRL = v => "R$ "+(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2});
  const parseVal = v => { const d=(v||"0").replace(/[R$\s.]/g,"").replace(",","."); const n=parseFloat(d); return isNaN(n)?0:n; };

  const mine = canSeeAll ? propostas : propostas.filter(p=>p.criadoPor===myId);
  const mesAtual = now.getMonth();
  const anoAtual = now.getFullYear();

  const calcMet = list => ({
    total: list.length,
    concluidas: list.filter(p=>p.status==="Proposta Concluída").length,
    pendentes: list.filter(p=>["Pendente","Pago Aguardando Confirmação","Aguardando Formalização","Proposta Digitada"].includes(p.status)).length,
    canceladas: list.filter(p=>p.status==="Cancelada").length,
    valor: list.filter(p=>p.status==="Proposta Concluída").reduce((a,p)=>a+parseVal(p.valorLiberado||p.valorSolicitado||p.valorPrometido),0),
  });

  const doMes = mine.filter(p=>{ const d=new Date(p.createdAt||0); return d.getMonth()===mesAtual&&d.getFullYear()===anoAtual; });
  const doAno = mine.filter(p=>new Date(p.createdAt||0).getFullYear()===anoAtual);
  const mMes = calcMet(doMes);
  const mAno = calcMet(doAno);

  const porMes = Array.from({length:12},(_,m)=>{
    const l = mine.filter(p=>{ const d=new Date(p.createdAt||0); return d.getMonth()===m&&d.getFullYear()===anoAtual; });
    return {mes:MESES[m],...calcMet(l)};
  });

  const Card = ({icon,label,val,color,money=false}) => (
    <div style={{...S.card,padding:"16px",textAlign:"center",border:`1px solid ${color}33`}}>
      <div style={{fontSize:24,marginBottom:6}}>{icon}</div>
      <div style={{color,fontSize:money?14:24,fontWeight:800,marginBottom:4,wordBreak:"break-all"}}>{val}</div>
      <div style={{color:C.td,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.4px"}}>{label}</div>
    </div>
  );

  return (
    <div>
      {/* ── Mensal ── */}
      <div style={{marginBottom:28}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <span style={{color:C.tp,fontSize:16,fontWeight:700}}>📅 {MESES[mesAtual]} {anoAtual}</span>
          <span style={{background:C.abg,color:C.atxt,fontSize:10,padding:"2px 10px",borderRadius:20,fontWeight:700}}>Mês atual</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14}}>
          <Card icon="📤" label="Enviadas" val={mMes.total} color={C.atxt}/>
          <Card icon="✅" label="Concluídas" val={mMes.concluidas} color="#34D399"/>
          <Card icon="⏳" label="Pendentes" val={mMes.pendentes} color="#FBBF24"/>
          <Card icon="❌" label="Canceladas" val={mMes.canceladas} color="#EF4444"/>
        </div>
        <div style={{...S.card,padding:"14px 18px",border:"1px solid #34D39933",display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:28}}>💰</span>
          <div>
            <div style={{color:C.td,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.4px",marginBottom:3}}>Total liberado em {MESES[mesAtual]}</div>
            <div style={{color:"#34D399",fontSize:20,fontWeight:800}}>{fmtBRL(mMes.valor)}</div>
          </div>
        </div>
      </div>

      {/* ── Anual ── */}
      <div>
        <div style={{color:C.tp,fontSize:16,fontWeight:700,marginBottom:14}}>📆 Relatório Anual — {anoAtual}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14}}>
          <Card icon="📤" label="Enviadas" val={mAno.total} color={C.atxt}/>
          <Card icon="✅" label="Concluídas" val={mAno.concluidas} color="#34D399"/>
          <Card icon="⏳" label="Pendentes" val={mAno.pendentes} color="#FBBF24"/>
          <Card icon="❌" label="Canceladas" val={mAno.canceladas} color="#EF4444"/>
        </div>
        <div style={{...S.card,padding:"14px 18px",border:"1px solid #34D39933",marginBottom:18,display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:28}}>🏆</span>
          <div>
            <div style={{color:C.td,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.4px",marginBottom:3}}>Total liberado em {anoAtual}</div>
            <div style={{color:"#34D399",fontSize:20,fontWeight:800}}>{fmtBRL(mAno.valor)}</div>
          </div>
        </div>
        <div style={{...S.card,overflow:"hidden"}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.b1}`,color:C.ts,fontSize:12,fontWeight:700}}>Desempenho mês a mês</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:C.deep}}>
                {["Mês","Enviadas","Concluídas","Pendentes","Canceladas","Valor Liberado"].map(h=>(
                  <th key={h} style={{color:C.td,fontSize:10,fontWeight:700,padding:"9px 12px",textAlign:"left",textTransform:"uppercase",borderBottom:`1px solid ${C.b1}`,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porMes.map((m,i)=>{
                const isAt = i===mesAtual;
                return (
                  <tr key={m.mes} style={{background:isAt?C.abg:"transparent",borderBottom:`1px solid ${C.b1}`}}>
                    <td style={{padding:"9px 12px",color:isAt?C.atxt:C.ts,fontWeight:isAt?700:400}}>{m.mes}{isAt&&" ←"}</td>
                    <td style={{padding:"9px 12px",color:C.ts}}>{m.total||"—"}</td>
                    <td style={{padding:"9px 12px",color:m.concluidas>0?"#34D399":C.td,fontWeight:m.concluidas>0?700:400}}>{m.concluidas||"—"}</td>
                    <td style={{padding:"9px 12px",color:m.pendentes>0?"#FBBF24":C.td}}>{m.pendentes||"—"}</td>
                    <td style={{padding:"9px 12px",color:m.canceladas>0?"#EF4444":C.td}}>{m.canceladas||"—"}</td>
                    <td style={{padding:"9px 12px",color:m.valor>0?"#34D399":C.td,fontWeight:m.valor>0?600:400}}>{m.valor>0?fmtBRL(m.valor):"—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Card expandido de proposta com TODOS os dados ──────────────
function PropCard({ p, myId, canSeeAll, onAtualizar }) {
  const [open, setOpen] = useState(false);
  const st = p.status||"Proposta Digitada";
  const col = STATUS_PROPOSTA_COLORS[st]||C.td;
  const isNew = !p.viewedBy?.includes(myId);

  const Row = ({label,val}) => val ? (
    <div style={{display:"flex",gap:8,marginBottom:3}}>
      <span style={{color:C.td,fontSize:11,minWidth:140,flexShrink:0}}>{label}:</span>
      <span style={{color:C.ts,fontSize:11.5,fontWeight:500,wordBreak:"break-all"}}>{val}</span>
    </div>
  ) : null;

  const Sec = ({title,children}) => (
    <div style={{marginBottom:12}}>
      <div style={{color:C.tm,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${C.b1}`}}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{...S.card,padding:"14px 18px",border:`1px solid ${isNew?"#EF444466":col+"33"}`,boxShadow:isNew?`0 0 14px #EF444422`:"none"}}>
      {/* Cabeçalho */}
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:180,cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
            {isNew&&<span style={{width:7,height:7,borderRadius:"50%",background:"#EF4444",animation:"pulse 1.5s infinite",flexShrink:0}}/>}
            <span style={{color:C.tp,fontSize:14,fontWeight:700}}>{p.nome||"—"}</span>
            <span style={{background:`${col}22`,color:col,fontSize:10,padding:"2px 8px",borderRadius:20,fontWeight:700,border:`1px solid ${col}33`}}>{st}</span>
            <span style={{background:`${C.abg}`,color:C.atxt,fontSize:10,padding:"2px 7px",borderRadius:20,fontWeight:600}}>{p.tipo||p.produto||"—"}</span>
          </div>
          <div style={{color:C.tm,fontSize:11.5}}>CPF: {p.cpf||"—"} · {p.contato1||p.telefone||"—"} · {p.createdAt?new Date(p.createdAt).toLocaleString("pt-BR"):"—"}</div>
          <div style={{color:C.td,fontSize:11,marginTop:1}}>Por: {p.criadoPorNome||"—"}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {/* Botão Cliente Formalizado — aparece em Propostas quando status=Aguardando Formalização e há link */}
          {st==="Aguardando Formalização" && p.linkFormalizacao && (
            <button onClick={async e=>{
              e.stopPropagation();
              await setDoc(doc(db,"propostas",p.id),{
                status:"Aguardando Checagem de Formalização",
                hasNewInteraction:true, viewedByDigitador:[], formalizadoAt:Date.now(),
              },{merge:true});
            }} style={{background:"linear-gradient(135deg,#34D399,#059669)",color:"#fff",border:"none",borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
              ✅ Cliente Formalizado
            </button>
          )}
          {/* Botão Permitir Edição — permite que o digitador edite a proposta */}
          {canSeeAll && (
            p.editavel ? (
              <button onClick={async e=>{
                e.stopPropagation();
                await setDoc(doc(db,"propostas",p.id),{editavel:false},{merge:true});
              }} style={{background:"#1A1400",color:"#FBBF24",border:"1px solid #FBBF2466",borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                🔓 Edição Ativa
              </button>
            ) : (
              <button onClick={async e=>{
                e.stopPropagation();
                await setDoc(doc(db,"propostas",p.id),{editavel:true},{merge:true});
              }} style={{background:"#0D0D0D",color:"#94A3B8",border:"1px solid #334155",borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
                🔒 Permitir Edição
              </button>
            )
          )}
          <button onClick={()=>setOpen(o=>!o)}
            style={{background:C.deep,color:C.tm,border:`1px solid ${C.b2}`,borderRadius:8,padding:"6px 12px",fontSize:11,cursor:"pointer"}}>
            {open?"▲ Fechar":"▼ Ver dados"}
          </button>
          {canSeeAll&&(
            <button onClick={()=>onAtualizar(p)}
              style={{background:C.abg,color:C.atxt,border:`1px solid ${C.atxt}33`,borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
              ✏ Atualizar
            </button>
          )}
        </div>
      </div>

      {/* Dados expandidos */}
      {open && (
        <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.b1}`}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px"}}>
            <Sec title="👤 Dados do Cliente">
              <Row label="Nome" val={p.nome}/>
              <Row label="CPF" val={p.cpf}/>
              <Row label="RG" val={p.rg}/>
              <Row label="Data Nasc." val={p.dataNasc}/>
              <Row label="Data Expedição" val={p.dataExpedicao}/>
              <Row label="Órgão Emissor" val={p.orgaoEmissor}/>
              <Row label="UF Doc" val={p.ufDoc}/>
              <Row label="Nome da Mãe" val={p.nomeMae}/>
              <Row label="Nome do Pai" val={p.nomePai}/>
              <Row label="Naturalidade" val={p.naturalidade}/>
            </Sec>
            <Sec title="📞 Contato">
              <Row label="Tel 1" val={p.contato1}/>
              <Row label="Tel 2" val={p.contato2}/>
              <Row label="Email 1" val={p.email1}/>
              <Row label="Email 2" val={p.email2}/>
            </Sec>
            <Sec title="📍 Endereço">
              <Row label="CEP" val={p.cep}/>
              <Row label="Rua" val={p.rua}/>
              <Row label="Número" val={p.numero}/>
              <Row label="Bairro" val={p.bairro}/>
              <Row label="Cidade" val={p.cidade}/>
              <Row label="UF" val={p.ufEnd}/>
              <Row label="Complemento" val={p.complemento}/>
            </Sec>
            <Sec title="💰 Proposta">
              <Row label="Tipo" val={p.tipo||p.produto}/>
              <Row label="Banco Proposta" val={p.bancoProposta}/>
              <Row label="Tabela" val={p.tabela}/>
              <Row label="Anos Antecipação" val={p.anosAntecipacao}/>
              <Row label="Com Seguro" val={p.comSeguro}/>
              <Row label="Valor Liberado" val={p.valorLiberado}/>
              <Row label="Valor Prometido" val={p.valorPrometido}/>
              <Row label="Valor Desconto" val={p.valorDesconto}/>
              <Row label="Parcelas" val={p.parcelas}/>
              <Row label="Prazo" val={p.prazo}/>
              <Row label="Matrícula" val={p.matricula}/>
              <Row label="Empresa" val={p.empresa}/>
              <Row label="CNPJ" val={p.cnpj}/>
              <Row label="Nº Benefício" val={p.numBeneficio}/>
              <Row label="Nº Matrícula" val={p.numMatricula}/>
              <Row label="Margem" val={p.margem}/>
              <Row label="Averbador" val={p.averbador}/>
              <Row label="Protocolo" val={p.protocolo}/>
            </Sec>
            <Sec title="🏦 Dados Bancários">
              <Row label="Banco" val={p.bancoPagto}/>
              <Row label="Agência" val={p.agencia}/>
              <Row label="Conta c/ Dígito" val={p.contaDigito}/>
              <Row label="Tipo de Conta" val={p.tipoConta}/>
              <Row label="PIX 1" val={p.pix1}/>
              <Row label="PIX 2" val={p.pix2}/>
            </Sec>
            <Sec title="📝 Observação">
              <Row label="Obs" val={p.observacao}/>
            </Sec>
          </div>
          {/* Documentos */}
          {(p.docFiles||[]).length>0&&(
            <Sec title="📎 Documentos">
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {p.docFiles.map((f,i)=>(
                  f.url ? (
                    <div key={i} style={{display:"flex",gap:0}}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer"
                        style={{background:C.abg,color:C.atxt,fontSize:11,padding:"5px 12px",borderRadius:"8px 0 0 8px",border:`1px solid ${C.atxt}33`,borderRight:"none",textDecoration:"none",display:"flex",alignItems:"center",gap:6,fontWeight:600}}>
                        {f.type?.startsWith("image/")?"🖼":"📄"} {f.name} ↗
                      </a>
                      <a href={f.url} download={f.name}
                        onClick={e=>e.stopPropagation()}
                        title="Baixar arquivo"
                        style={{background:C.atxt+"33",color:C.atxt,fontSize:13,padding:"5px 10px",borderRadius:"0 8px 8px 0",border:`1px solid ${C.atxt}33`,textDecoration:"none",display:"flex",alignItems:"center",cursor:"pointer",fontWeight:800}}>
                        ⬇
                      </a>
                    </div>
                  ) : (
                    <span key={i} style={{background:C.deep,color:C.ts,fontSize:11,padding:"3px 9px",borderRadius:7,border:`1px solid ${C.b1}`}}>
                      {f.type?.startsWith("image/")?"🖼":"📄"} {f.name}
                    </span>
                  )
                ))}
              </div>
            </Sec>
          )}
          {/* Representante (cartão) */}
          {p.nomeRep&&(
            <Sec title="👥 Representante">
              <Row label="Nome" val={p.nomeRep}/>
              <Row label="CPF" val={p.cpfRep}/>
              <Row label="Tel 1" val={p.contato1Rep}/>
              <Row label="Tel 2" val={p.contato2Rep}/>
              <Row label="Email" val={p.email1Rep}/>
            </Sec>
          )}
          <MensagemProposta proposta={p}/>
        </div>
      )}
    </div>
  );
}

// ── Rank de Propostas ─────────────────────────────────────────────
function PropostasRankTab({ propostas }) {
  const [selectedUsers, setSelectedUsers] = useState([]);

  // Agrupa propostas por digitador
  const byUser = {};
  propostas.forEach(p => {
    const id = p.criadoPor || "desconhecido";
    const nome = p.nomeOperador || p.criadoPorNome || id.slice(0,8)+"…";
    if (!byUser[id]) byUser[id] = { id, nome, total:0, ativos:0, inativos:0, status:{}, valores:[] };
    byUser[id].total++;
    const st = p.status || "Proposta Digitada";
    byUser[id].status[st] = (byUser[id].status[st]||0)+1;
    if (["Pago","Pago Aguardando Confirmação","Aprovado"].includes(st)) byUser[id].ativos++;
    else if (["Cancelado","Recusado"].includes(st)) byUser[id].inativos++;
    if (p.valorLiberado) byUser[id].valores.push(parseFloat(String(p.valorLiberado).replace(/\./g,"").replace(",",".")) || 0);
  });

  const allUsers = Object.values(byUser).sort((a,b)=>b.total-a.total);
  const users = selectedUsers.length > 0
    ? allUsers.filter(u => selectedUsers.includes(u.id))
    : allUsers;

  const fmtBRL2 = (v) => v.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const medal = (i) => i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;
  const medalColor = (i) => i===0?"#F59E0B":i===1?"#94A3B8":i===2?"#C2873A":C.td;
  const maxTotal = Math.max(...users.map(u=>u.total), 1);

  return (
    <div>
      {/* Filtros */}
      <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:1,minWidth:200}}>
          <div style={{color:C.tm,fontSize:11,marginBottom:6,fontWeight:600}}>Selecionar usuários para comparar</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {allUsers.map(u=>{
              const sel = selectedUsers.includes(u.id);
              return (
                <button key={u.id} onClick={()=>setSelectedUsers(p=>sel?p.filter(x=>x!==u.id):[...p,u.id])}
                  style={{background:sel?C.acc+"22":C.deep,color:sel?C.atxt:C.tm,border:`1px solid ${sel?C.atxt+"44":C.b2}`,borderRadius:20,padding:"4px 10px",fontSize:11.5,cursor:"pointer",fontWeight:sel?700:400}}>
                  {sel?"✓ ":""}{u.nome}
                </button>
              );
            })}
            {selectedUsers.length>0 && (
              <button onClick={()=>setSelectedUsers([])} style={{background:"transparent",border:`1px solid ${C.b2}`,color:C.td,borderRadius:20,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>✕ Limpar</button>
            )}
          </div>
        </div>
      </div>

      {/* Pódio Top 3 */}
      {users.length >= 2 && (
        <div style={{display:"flex",gap:16,marginBottom:24,justifyContent:"center",alignItems:"flex-end",flexWrap:"wrap"}}>
          {[users[1],users[0],users[2]].filter(Boolean).map((u,podioIdx)=>{
            const rank = podioIdx===0?1:podioIdx===1?0:2;
            const heights = [160,200,140];
            const cols = ["#94A3B8","#F59E0B","#C2873A"];
            return (
              <div key={u.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                <div style={{color:C.tp,fontSize:13,fontWeight:700,textAlign:"center",maxWidth:120}}>{u.nome}</div>
                <div style={{color:cols[rank],fontSize:24}}>{["🥈","🥇","🥉"][rank]}</div>
                <div style={{background:`linear-gradient(180deg,${cols[rank]}44,${cols[rank]}22)`,border:`2px solid ${cols[rank]}66`,borderRadius:"10px 10px 0 0",width:90,height:heights[rank],display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",padding:"12px 8px",gap:4}}>
                  <div style={{color:cols[rank],fontSize:26,fontWeight:900,lineHeight:1}}>{u.total}</div>
                  <div style={{color:C.td,fontSize:10}}>propostas</div>
                  {u.ativos>0&&<div style={{color:"#34D399",fontSize:11,fontWeight:600,marginTop:4}}>✔ {u.ativos}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lista completa com barra de progresso */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {users.map((u,i)=>{
          const pct = Math.round((u.total/maxTotal)*100);
          const totalValor = u.valores.reduce((a,b)=>a+b,0);
          return (
            <div key={u.id} style={{background:C.card,border:`1px solid ${C.b1}`,borderRadius:14,padding:"14px 18px"}}>
              <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:10}}>
                <div style={{fontSize:i<3?24:14,fontWeight:700,color:medalColor(i),minWidth:32,textAlign:"center"}}>{medal(i)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:C.tp,fontSize:13.5,fontWeight:700}}>{u.nome}</div>
                  <div style={{display:"flex",gap:10,marginTop:3,flexWrap:"wrap"}}>
                    <span style={{color:C.atxt,fontSize:12,fontWeight:600}}>{u.total} propostas</span>
                    {u.ativos>0&&<span style={{color:"#34D399",fontSize:11}}>✔ {u.ativos} aprovadas</span>}
                    {u.inativos>0&&<span style={{color:"#F87171",fontSize:11}}>✘ {u.inativos} canceladas</span>}
                    {totalValor>0&&<span style={{color:"#FBBF24",fontSize:11}}>💰 {fmtBRL2(totalValor)}</span>}
                  </div>
                </div>
                {/* Estatísticas por status */}
                <div style={{display:"flex",gap:8,flexShrink:0,flexWrap:"wrap"}}>
                  {Object.entries(u.status).slice(0,3).map(([st,cnt])=>(
                    <span key={st} style={{background:C.deep,color:C.td,fontSize:10,padding:"2px 8px",borderRadius:8,border:`1px solid ${C.b2}`}}>{st}: {cnt}</span>
                  ))}
                </div>
              </div>
              {/* Barra de progresso */}
              <div style={{background:C.deep,borderRadius:99,height:6,overflow:"hidden"}}>
                <div style={{background:`linear-gradient(90deg,${C.acc},${C.lg2})`,height:"100%",width:`${pct}%`,borderRadius:99,transition:"width 0.6s ease"}}/>
              </div>
            </div>
          );
        })}
        {users.length===0&&(
          <div style={{color:C.td,fontSize:13,textAlign:"center",padding:"32px 0"}}>Nenhuma proposta encontrada.</div>
        )}
      </div>
    </div>
  );
}

function PropostasPage({ currentUser, unreadPropostas=0 }) {
  const [propostas, setPropostas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [celebracao, setCelebracao] = useState(false);
  const [modalProp, setModalProp] = useState(null);
  const [abaProp, setAbaProp] = useState("lista"); // "lista" | "dashboard"
  const prevCountRef = useRef(0);
  const myId = currentUser.uid||currentUser.id;
  const canSeeAll = ["mestre","master","digitador"].includes(currentUser.role);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "propostas"), snap => {
      const all = snap.docs.map(d=>({...d.data(), id:d.id}));
      all.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      const relevant = canSeeAll ? all : all.filter(p=>p.criadoPor===myId);
      const novas = relevant.filter(p=>!p.viewedBy?.includes(myId));
      if (prevCountRef.current > 0 && novas.length > prevCountRef.current) {
        setCelebracao(true);
        setTimeout(()=>setCelebracao(false), 5000);
      }
      prevCountRef.current = novas.length;
      novas.forEach(async p => {
        await setDoc(doc(db,"propostas",p.id),{viewedBy:[...(p.viewedBy||[]),myId]},{merge:true});
      });
      setPropostas(all); setLoading(false);
    });
    return ()=>unsub();
  }, []); // eslint-disable-line

  // Timer para lembrar evidências após 10 min em "Pago"
  useEffect(() => {
    propostas.forEach(p => {
      if (p.status==="Pago Aguardando Confirmação" && !p.evidenciaConfirmacao?.length && !p.lembreteEnviado) {
        const diff = Date.now() - (p.pagoAt||p.createdAt||0);
        if (diff > 10*60*1000) {
          setDoc(doc(db,"propostas",p.id),{lembreteEnviado:true},{merge:true});
          // Notificação via Firestore
          setDoc(doc(db,"notifications","lembrete_"+p.id),{
            toId:p.criadoPor, type:"lembrete_evidencia",
            text:`⏰ Lembre-se de anexar o print de confirmação de pagamento da proposta de ${p.nome}!`,
            createdAt:Date.now(), readAt:null,
          });
        }
      }
    });
  }, [propostas]); // eslint-disable-line

  const visible = propostas.filter(p => {
    if (!canSeeAll && p.criadoPor !== myId) return false;
    if (statusFilter!=="Todos" && (p.status||"Proposta Digitada")!==statusFilter) return false;
    if (search && !((p.nome||"").toLowerCase().includes(search.toLowerCase())||(p.cpf||"").includes(search))) return false;
    return true;
  });

  const updateStatus = async (id, data) => {
    const extra = {};
    if (data.status==="Pago Aguardando Confirmação") extra.pagoAt = Date.now();
    const propAtual = propostas.find(p=>p.id===id);
    await setDoc(doc(db,"propostas",id),{...data,...extra},{merge:true});
    // Notificar o digitador sobre a atualização
    if (propAtual) {
      const notifId = "notif_prop_"+id+"_"+Date.now();
      const textoNotif = data.editadoBy
        ? `✏️ Proposta editada — ${propAtual.nome} · ${data.status||propAtual.status}`
        : `🔔 Proposta atualizada — ${propAtual.nome} · Status: ${data.status||propAtual.status}`;
      await setDoc(doc(db,"notifications",notifId),{
        toId: propAtual.criadoPor,
        type: "proposta_atualizada",
        text: textoNotif,
        propostaId: id,
        createdAt: Date.now(),
        readAt: null,
      });
      // Sincronizar com Leads: atualizar dados bancários do contato correspondente
      if (propAtual.cpf) {
        const cpfLimpo = (propAtual.cpf||"").replace(/\D/g,"");
        // importar saveContact do firebase
        const { saveContact: sc } = await import("./firebase");
        // Buscar contato pelo CPF
        const snap = await import("firebase/firestore").then(({collection,query,where,getDocs})=>
          getDocs(query(collection(db,"contacts"),where("cpf","==",propAtual.cpf)))
        ).catch(()=>null);
        if (snap && !snap.empty) {
          const contDoc = snap.docs[0];
          const updates = {
            id: contDoc.id,
            ...contDoc.data(),
          };
          // Atualizar dados bancários se vieram com a proposta
          if (propAtual.bancoPagto) updates.bancoPagto = propAtual.bancoPagto;
          if (propAtual.agencia)    updates.agencia    = propAtual.agencia;
          if (propAtual.contaDigito) updates.contaDigito = propAtual.contaDigito;
          if (propAtual.tipoConta)  updates.tipoConta  = propAtual.tipoConta;
          if (propAtual.pix1)       updates.pix1       = propAtual.pix1;
          if (propAtual.pix2)       updates.pix2       = propAtual.pix2;
          // Atualizar status do lead baseado na proposta
          if (data.status==="Proposta Concluída") updates.status = "Simulado";
          if (data.status==="Cancelada")          updates.status = "Não simulado";
          await sc(updates);
        } else if (cpfLimpo) {
          // Criar lead se não existir
          await sc({
            id: "lead_"+cpfLimpo,
            name: propAtual.nome||"",
            cpf: propAtual.cpf||"",
            phone: propAtual.contato1||"",
            phone2: propAtual.contato2||"",
            email: propAtual.email1||"",
            cep: propAtual.cep||"",
            rua: propAtual.rua||"",
            numero: propAtual.numero||"",
            bairro: propAtual.bairro||"",
            cidade: propAtual.cidade||"",
            ufEnd: propAtual.ufEnd||"",
            bancoPagto: propAtual.bancoPagto||"",
            agencia: propAtual.agencia||"",
            contaDigito: propAtual.contaDigito||"",
            tipoConta: propAtual.tipoConta||"",
            pix1: propAtual.pix1||"",
            leadType: propAtual.tipo||"FGTS",
            status: "Não simulado",
            reactions: [],
          });
        }
      }
    }
  };

  return (
    <div style={{padding:"24px 32px",maxWidth:1060,position:"relative"}}>
      {/* Modal ação digitador */}
      {modalProp && (
        <ModalAcaoProposta
          proposta={modalProp}
          onClose={()=>setModalProp(null)}
          onSave={updateStatus}
        />
      )}

      {/* 🎉 Comemoração */}
      {celebracao && (
        <div style={{position:"fixed",inset:0,zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.5)",animation:"fadeIn 0.3s ease"}}>
          <div style={{background:`linear-gradient(135deg,${C.lg1},${C.lg2})`,borderRadius:24,padding:"32px 48px",textAlign:"center",boxShadow:"0 12px 60px rgba(0,0,0,0.7)"}}>
            <div style={{fontSize:56,marginBottom:8}}>🎉</div>
            <div style={{color:"#fff",fontSize:22,fontWeight:800,marginBottom:6}}>Nova Proposta Recebida!</div>
            <div style={{color:"rgba(255,255,255,0.7)",fontSize:14,marginBottom:16}}>Uma nova proposta foi enviada para análise.</div>
            <button onClick={()=>setCelebracao(false)} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",borderRadius:8,padding:"8px 20px",cursor:"pointer",fontSize:13}}>OK 👍</button>
          </div>
        </div>
      )}

      {/* Abas */}
      <div style={{display:"flex",gap:2,borderBottom:`1px solid ${C.b1}`,marginBottom:20}}>
        {[
          {id:"lista",    label:"📋 Propostas",      badge:unreadPropostas},
          {id:"relatorio",label:"📊 Relatório Mensal"},
          ...(canSeeAll ? [{id:"rank", label:"🏆 Rank"}] : []),
        ].map(t=>(
          <button key={t.id} onClick={()=>setAbaProp(t.id)}
            style={{background:"transparent",border:"none",cursor:"pointer",padding:"9px 18px",fontSize:13,
              fontWeight:abaProp===t.id?700:400,color:abaProp===t.id?C.atxt:C.tm,
              borderBottom:abaProp===t.id?`2px solid ${C.atxt}`:"2px solid transparent",marginBottom:"-1px",
              display:"flex",alignItems:"center",gap:7}}>
            {t.label}
            {(t.badge||0)>0&&<span style={{background:"#EF4444",color:"#fff",fontSize:9,padding:"2px 6px",borderRadius:9,fontWeight:800,animation:"pulse 1.5s infinite"}}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* Relatório Mensal + Anual */}
      {abaProp==="relatorio" && (
        <RelatorioProposta propostas={propostas} canSeeAll={canSeeAll} myId={myId} />
      )}

      {/* Rank */}
      {abaProp==="rank" && canSeeAll && (
        <PropostasRankTab propostas={propostas} />
      )}

      {/* Lista de Propostas */}
      {abaProp==="lista" && (
        <>
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Nome ou CPF..."
              style={{...S.input,flex:1,minWidth:180,fontSize:12,padding:"7px 12px"}}/>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {["Todos",...STATUS_PROPOSTA].map(s=>{
                const col = STATUS_PROPOSTA_COLORS[s];
                return (
                  <button key={s} onClick={()=>setStatusFilter(s)}
                    style={{background:statusFilter===s?(col||C.acc)+"22":C.deep,color:statusFilter===s?(col||C.atxt):C.tm,
                      border:`1px solid ${statusFilter===s?(col||C.atxt)+"44":C.b2}`,borderRadius:20,padding:"5px 11px",fontSize:11,cursor:"pointer",fontWeight:statusFilter===s?700:400}}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {loading&&<div style={{color:C.tm,textAlign:"center",padding:"40px 0"}}>Carregando...</div>}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {visible.map(p=>(
              <PropCard key={p.id} p={p} myId={myId} canSeeAll={canSeeAll} onAtualizar={setModalProp}/>
            ))}
            {!loading&&visible.length===0&&(
              <div style={{textAlign:"center",padding:"50px 0",color:C.tm}}>
                <div style={{fontSize:36,opacity:0.3,marginBottom:10}}>📋</div>
                <div style={{fontSize:14,fontWeight:600}}>Nenhuma proposta encontrada</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}



// ── Pagamentos ────────────────────────────────────────────────────
function PagamentosPage({ currentUser }) {
  const [aba, setAba] = useState("produtos");

  const ABAS = [
    { id:"produtos",  label:"Produtos",  icon:"📦" },
    { id:"servicos",  label:"Serviços",  icon:"🔧" },
    { id:"chat",      label:"Chat",      icon:"💬" },
    { id:"adicional", label:"Adicional", icon:"➕" },
    { id:"digitacao", label:"Digitação", icon:"📝" },
  ];

  // Plano genérico reutilizável para cada aba
  function PlanoCard({ nome, preco, descricao, cor, recursos }) {
    return (
      <div style={{ background:C.card, border:`1px solid ${cor}33`, borderRadius:16, padding:"22px 20px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-12, right:-12, fontSize:60, opacity:0.05 }}>💳</div>
        <div style={{ color:cor, fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", marginBottom:6 }}>{nome}</div>
        <div style={{ color:C.tp, fontSize:28, fontWeight:800, lineHeight:1, marginBottom:4 }}>
          {preco === 0 ? <span style={{ color:"#34D399" }}>Grátis</span> : `R$ ${preco.toFixed(2).replace(".",",")}`}
          {preco > 0 && <span style={{ color:C.td, fontSize:12, fontWeight:400 }}>/mês</span>}
        </div>
        <div style={{ color:C.tm, fontSize:12, marginBottom:16, lineHeight:1.5 }}>{descricao}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {recursos.map((r, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, color:C.ts, fontSize:12 }}>
              <span style={{ color:cor, fontSize:13 }}>✓</span>{r}
            </div>
          ))}
        </div>
        <button style={{ marginTop:18, width:"100%", background:`linear-gradient(135deg,${cor},${cor}bb)`, color:"#fff", border:"none", borderRadius:10, padding:"11px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
          Contratar
        </button>
      </div>
    );
  }

  const conteudo = {
    produtos: {
      titulo: "📦 Produtos",
      sub: "Planos de produtos disponíveis para contratação",
      planos: [
        { nome:"Básico",      preco:0,      cor:"#6B7280", descricao:"Para começar sem custos", recursos:["Até 100 contatos","Importação CSV","Dashboard básico"] },
        { nome:"Profissional",preco:97,     cor:"#4F8EF7", descricao:"Para equipes em crescimento", recursos:["Contatos ilimitados","Importação avançada","Relatórios completos","Suporte prioritário"] },
        { nome:"Enterprise",  preco:297,    cor:"#C084FC", descricao:"Para grandes operações", recursos:["Tudo do Profissional","API de integração","Gestor de conta dedicado","Treinamento incluso","SLA garantido"] },
      ],
    },
    servicos: {
      titulo: "🔧 Serviços",
      sub: "Serviços adicionais de suporte e configuração",
      planos: [
        { nome:"Configuração Inicial", preco:150, cor:"#34D399", descricao:"Setup completo do sistema", recursos:["Criação de usuários","Configuração de permissões","Treinamento básico (1h)"] },
        { nome:"Suporte Mensal",       preco:89,  cor:"#FBBF24", descricao:"Atendimento técnico mensal", recursos:["Suporte via WhatsApp","Tempo de resposta < 2h","Relatório mensal de uso"] },
        { nome:"Consultoria",          preco:490, cor:"#F472B6", descricao:"Consultoria estratégica", recursos:["4h de consultoria","Análise de desempenho","Plano de melhoria personalizado","Acompanhamento 30 dias"] },
      ],
    },
    chat: {
      titulo: "💬 Chat",
      sub: "Planos do módulo de chat e comunicação interna",
      planos: [
        { nome:"Chat Básico",    preco:0,   cor:"#6B7280", descricao:"Comunicação interna simples", recursos:["Mensagens entre usuários","Histórico 7 dias","Envio de emojis"] },
        { nome:"Chat Pro",       preco:49,  cor:"#4F8EF7", descricao:"Chat avançado com stories", recursos:["Histórico ilimitado","Stories de equipe","Mensagens diretas","Notificações push"] },
        { nome:"Chat Business",  preco:129, cor:"#C084FC", descricao:"Comunicação empresarial completa", recursos:["Tudo do Pro","Grupos de trabalho","Integração WhatsApp","Gravação de áudio","Relatório de atividade"] },
      ],
    },
    adicional: {
      titulo: "➕ Adicional",
      sub: "Recursos extras para potencializar o sistema",
      planos: [
        { nome:"Storage Extra",     preco:29,  cor:"#34D399", descricao:"Espaço extra para arquivos", recursos:["50 GB adicionais","Backup automático diário","Acesso a arquivos antigos"] },
        { nome:"Relatórios Premium", preco:59, cor:"#FBBF24", descricao:"Analytics e relatórios avançados", recursos:["Dashboard personalizado","Exportação Excel/PDF","Gráficos interativos","Comparativo mensal"] },
        { nome:"Integrações",        preco:99, cor:"#F97316", descricao:"Conecte com outras ferramentas", recursos:["API REST completa","Webhooks","Integração CRM","Zapier / Make"] },
      ],
    },
    digitacao: {
      titulo: "📝 Digitação",
      sub: "Planos para o módulo de digitação de propostas",
      planos: [
        { nome:"Digitação Básica",   preco:0,   cor:"#6B7280", descricao:"Para baixo volume de propostas", recursos:["Até 20 propostas/mês","Modelos básicos","Acompanhamento simples"] },
        { nome:"Digitação Pro",      preco:79,  cor:"#4F8EF7", descricao:"Para operações em escala", recursos:["Propostas ilimitadas","Todos os bancos","Envio automático","Histórico completo"] },
        { nome:"Digitação Enterprise",preco:199,cor:"#C084FC", descricao:"Para grandes digitadores", recursos:["Tudo do Pro","Integração V8 Digital","Relatório por banco","Suporte dedicado","API de proposta"] },
      ],
    },
  };

  const atual = conteudo[aba];

  return (
    <div style={{ padding:"28px 36px", maxWidth:1100 }}>
      {/* Header */}
      <div style={{ marginBottom:22 }}>
        <h1 style={{ color:C.tp, fontSize:21, fontWeight:700, margin:"0 0 4px" }}>💳 Pagamentos</h1>
        <p style={{ color:C.tm, fontSize:12.5, margin:0 }}>Gerencie planos e serviços contratados</p>
      </div>

      {/* Sub-abas */}
      <div style={{ display:"flex", gap:2, borderBottom:`1px solid ${C.b1}`, marginBottom:28, overflowX:"auto" }}>
        {ABAS.map(t => (
          <button key={t.id} onClick={()=>setAba(t.id)}
            style={{ background:"transparent", border:"none", cursor:"pointer", padding:"9px 18px", fontSize:13, whiteSpace:"nowrap",
              fontWeight:aba===t.id?700:400, color:aba===t.id?C.atxt:C.tm,
              borderBottom:aba===t.id?`2px solid ${C.atxt}`:"2px solid transparent",
              marginBottom:"-1px", transition:"all 0.12s", display:"flex", alignItems:"center", gap:6 }}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo da aba */}
      <div>
        <div style={{ marginBottom:20 }}>
          <div style={{ color:C.ts, fontSize:16, fontWeight:700 }}>{atual.titulo}</div>
          <div style={{ color:C.tm, fontSize:12.5, marginTop:3 }}>{atual.sub}</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:18 }}>
          {atual.planos.map((p, i) => (
            <PlanoCard key={i} {...p} />
          ))}
        </div>

        {/* Aviso de contato */}
        <div style={{ marginTop:28, background:C.card, border:`1px solid ${C.b1}`, borderRadius:14, padding:"18px 22px", display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ fontSize:28 }}>💬</span>
          <div>
            <div style={{ color:C.ts, fontSize:13, fontWeight:700, marginBottom:3 }}>Precisa de um plano personalizado?</div>
            <div style={{ color:C.tm, fontSize:12 }}>Entre em contato com nosso time comercial para montar um pacote sob medida para sua operação.</div>
          </div>
          <a href="https://wa.me/5584981323542" target="_blank" rel="noopener noreferrer"
            style={{ marginLeft:"auto", background:"#25D366", color:"#fff", border:"none", borderRadius:10, padding:"9px 18px", fontSize:12.5, fontWeight:700, cursor:"pointer", textDecoration:"none", whiteSpace:"nowrap", flexShrink:0 }}>
            📲 Falar com suporte
          </a>
        </div>
      </div>
    </div>
  );
}

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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [unreadPropostas, setUnreadPropostas] = useState(0);
  const [unreadDigitacao, setUnreadDigitacao] = useState(0);
  const lastChatCount = useRef(0);
  // System config — mestre controls what others can access
  const [sysConfig, setSysConfig] = useState({
    masterChatEnabled: true,     // mestre can disable chat for masters
    indicadoChatEnabled: true,   // master can disable chat for indicados
    visitanteChatEnabled: true,
    pagamentosEnabled: true,     // admin can toggle pagamentos tab
    visitanteTabs: { dashboard:true, contacts:true, add:false, import:false, review:true, cstatus:true, leds:false, atalhos:true, premium:false, config:false },
  });

  // Salva a página ativa ao trocar — chat vira painel flutuante
  const setPageAndSave = (p) => {
    if (p === "chat") { setChatOpen(prev => !prev); return; }
    sessionStorage.setItem("nexp_page", p);
    setPage(p);
  };

  // Listener para navegação via evento (ex: botão V8 em ReviewClient)
  useEffect(() => {
    const handler = (e) => {
      const { page: pg, cpf } = e.detail || {};
      if (pg) { setPageAndSave(pg); }
      if (cpf) { sessionStorage.setItem("nexp_v8_simular_cpf", cpf); }
    };
    window.addEventListener("nexp_navigate", handler);
    return () => window.removeEventListener("nexp_navigate", handler);
  }, []); // eslint-disable-line

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

  // ── Ouvir propostas não lidas ────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;
    const isMestreOrMaster = ["mestre","master"].includes(currentUser.role);
    const isDigitador = currentUser.role === "digitador";
    const unsub = onSnapshot(collection(db, "propostas"), (snap) => {
      const all = snap.docs.map(d=>({...d.data(), id:d.id}));
      const unread = all.filter(p => {
        if (isMestreOrMaster) return !p.viewedBy?.includes(myId);
        return p.criadoPor === myId && p.hasNewInteraction && !p.viewedByDigitador?.includes(myId);
      }).length;
      setUnreadPropostas(unread);
      // Badge aba "Minhas Propostas" + sidebar "Digitação" — só digitador
      if (isDigitador) {
        setUnreadDigitacao(all.filter(p =>
          p.criadoPor === myId && p.hasNewInteraction && !p.viewedByDigitador?.includes(myId)
        ).length);
      }
    });
    return () => unsub();
  }, [currentUser]); // eslint-disable-line

  // ── Ouvir notificações do usuário atual ───────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const myId = currentUser.uid || currentUser.id;
    const unsub = onSnapshot(collection(db, "notifications"), (snap) => {
      const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const TIPOS_PROPOSTA = ["proposta_editada","proposta_atualizada","edicao_liberada","pendente_documentacao","documentos_enviados","lembrete_evidencia"];
      const mine = notifs.filter(n => !TIPOS_PROPOSTA.includes(n.type) && (n.toId === myId || n.broadcast === true));
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
        @media (max-width: 768px) {
          .nexp-sidebar { width: 0 !important; overflow: hidden !important; }
          .nexp-sidebar-open { width: 220px !important; position: fixed !important; z-index: 999 !important; height: 100vh !important; }
          .nexp-main { width: 100vw !important; }
          .nexp-mobile-fab { display: flex !important; }
          .nexp-fab-chat { right: 16px !important; bottom: 16px !important; width: 54px !important; height: 54px !important; }
        }
        @media (min-width: 769px) {
          .nexp-mobile-fab { display: none !important; }
          .nexp-mobile-overlay { display: none !important; }
        }
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
        ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
        * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
        html, body, #root { overflow: hidden !important; }
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
      {/* Overlay mobile */}
      {mobileSidebarOpen && (
        <div className="nexp-mobile-overlay" onClick={()=>setMobileSidebarOpen(false)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:998, display:"flex" }} />
      )}
      <Sidebar
        page={page}
        setPage={setPageAndSave}
        user={currentUser}
        users={users}
        onLogout={logout}
        unreadChat={unreadChat}
        unreadNotif={unreadNotif}
        unreadStories={unreadStories}
        unreadPropostas={unreadPropostas}
        unreadDigitacao={unreadDigitacao}
        presence={presence}
        flashUserId={flashUserId}
        stories={chatStories}
        sysConfig={sysConfig}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={()=>setMobileSidebarOpen(false)}
      />
      <div className="nexp-main" style={{ flex: 1, overflowY: "auto", height: "100vh", position:"relative", scrollbarWidth:"none" }}>
        <style>{`.nexp-main::-webkit-scrollbar { display: none; }`}</style>
        {/* Botão hamburguer mobile */}
        <button className="nexp-mobile-fab" onClick={()=>setMobileSidebarOpen(p=>!p)}
          style={{ display:"none", position:"fixed", top:12, left:12, zIndex:997, width:42, height:42, borderRadius:11,
            background:`linear-gradient(135deg,${C.acc},${C.lg2})`, border:"none", cursor:"pointer",
            alignItems:"center", justifyContent:"center", boxShadow:`0 3px 14px ${C.acc}66`,
            fontSize:18, color:"#fff" }}>
          ☰
        </button>
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
          <ReviewClient contacts={contacts} setContacts={setContacts} onDigitar={(c)=>{
            sessionStorage.setItem("nexp_digitar_cliente", JSON.stringify(c));
            setPageAndSave("digitacao");
          }} />
        )}
        {page === "cstatus" && (
          <ClienteStatus contacts={contacts} setContacts={setContacts} />
        )}
        {page === "leds" && (
          <LedsPage contacts={contacts} userRole={currentUser.role} />
        )}
        {page === "usuarios_page" && (
          <UsuariosPage users={users} setUsers={setUsers} currentUser={currentUser} sysConfig={sysConfig} onSysConfig={setSysConfig} />
        )}
        {page === "digitacao" && (
          <DigitacaoPage contacts={contacts} currentUser={currentUser} unreadExterno={unreadDigitacao} />
        )}
        {page === "propostas" && (
          <PropostasPage currentUser={currentUser} unreadPropostas={unreadPropostas} />
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
        {page === "apis" && <ApisBancosPage currentUser={currentUser} contacts={contacts} />}
        {page === "pagamentos" && (currentUser.role === "mestre" || currentUser.role === "administrador") && <PagamentosPage currentUser={currentUser} />}
      </div>

      {/* ── Chat Flutuante + FAB ── */}
      {(() => {
        const role = currentUser?.role;
        const uid = currentUser?.uid || currentUser?.id;
        const override = sysConfig?.userOverrides?.[uid];
        const chatAllowed = !(
          (override !== undefined && override.chat === false) ||
          (override === undefined && role === "visitante" && !sysConfig?.visitanteChatEnabled) ||
          (override === undefined && role === "indicado" && !sysConfig?.indicadoChatEnabled) ||
          (override === undefined && role === "master" && !sysConfig?.masterChatEnabled)
        );

        return (
          <>
            {/* Chat flutuante — abre apenas via aba Chat na sidebar */}
            {chatOpen && chatAllowed && (
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
          </>
        );
      })()}
    </div>
    </>
  );
}
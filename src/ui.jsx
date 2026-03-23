// src/ui.jsx
// ─────────────────────────────────────────────────────────────────
// Design System interno — componentes base reutilizáveis.
// Usa as variáveis de cores do tema (C) via prop ou contexto.
// ─────────────────────────────────────────────────────────────────

import React, { memo } from "react";

// ─── Button ──────────────────────────────────────────────────────
// variant: "primary" | "danger" | "ghost" | "success"
export const Button = memo(function Button({
  children,
  onClick,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "md",
  style: extraStyle = {},
  C, // tema
  ...rest
}) {
  const base = {
    border: "none",
    borderRadius: 9,
    fontWeight: 700,
    cursor: disabled || loading ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    transition: "opacity 0.15s, transform 0.1s",
    opacity: disabled || loading ? 0.6 : 1,
    fontFamily: "inherit",
  };

  const sizes = {
    sm: { padding: "5px 12px", fontSize: 12 },
    md: { padding: "9px 18px", fontSize: 13 },
    lg: { padding: "12px 24px", fontSize: 14 },
  };

  const variants = {
    primary: {
      background: C?.acc || "#4F8EF7",
      color: "#fff",
    },
    danger: {
      background: "rgba(239,68,68,0.12)",
      color: "#F87171",
      border: "1px solid #EF444430",
    },
    ghost: {
      background: "transparent",
      color: C?.tm || "#9CA3AF",
      border: `1px solid ${C?.b2 || "#2D3348"}`,
    },
    success: {
      background: "rgba(52,211,153,0.12)",
      color: "#34D399",
      border: "1px solid #34D39930",
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{ ...base, ...sizes[size], ...variants[variant], ...extraStyle }}
      {...rest}
    >
      {loading ? "⏳ Aguarde..." : children}
    </button>
  );
});

// ─── Input ───────────────────────────────────────────────────────
export const Input = memo(function Input({
  value,
  onChange,
  placeholder = "",
  type = "text",
  disabled = false,
  error = "",
  label = "",
  style: extraStyle = {},
  C,
  ...rest
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <label style={{ color: C?.tm || "#9CA3AF", fontSize: 11, fontWeight: 600 }}>
          {label}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          background: C?.deep || "#0F1320",
          border: `1px solid ${error ? "#EF4444" : C?.b2 || "#2D3348"}`,
          borderRadius: 9,
          color: C?.tp || "#fff",
          padding: "9px 12px",
          fontSize: 13,
          fontFamily: "inherit",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
          opacity: disabled ? 0.6 : 1,
          ...extraStyle,
        }}
        {...rest}
      />
      {error && (
        <span style={{ color: "#F87171", fontSize: 11 }}>⚠ {error}</span>
      )}
    </div>
  );
});

// ─── Card ────────────────────────────────────────────────────────
export const Card = memo(function Card({
  children,
  style: extraStyle = {},
  C,
  ...rest
}) {
  return (
    <div
      style={{
        background: C?.card || "#161B2E",
        border: `1px solid ${C?.b1 || "#1E2640"}`,
        borderRadius: 16,
        padding: "20px 22px",
        ...extraStyle,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});

// ─── Modal ───────────────────────────────────────────────────────
export const Modal = memo(function Modal({
  open,
  onClose,
  children,
  title = "",
  maxWidth = 480,
  C,
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C?.card || "#161B2E",
          border: `1px solid ${C?.b1 || "#1E2640"}`,
          borderRadius: 20,
          padding: "28px 28px 24px",
          width: "100%",
          maxWidth,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        {title && (
          <div
            style={{
              color: C?.tp || "#fff",
              fontSize: 16,
              fontWeight: 800,
              marginBottom: 18,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            {title}
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: C?.tm || "#9CA3AF",
                cursor: "pointer",
                fontSize: 18,
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
});

// ─── Badge ───────────────────────────────────────────────────────
// Usado para status, roles, tipos de lead.
export const Badge = memo(function Badge({
  children,
  color = "#9CA3AF",
  bg = "rgba(156,163,175,0.12)",
  style: extraStyle = {},
}) {
  return (
    <span
      style={{
        background: bg,
        color,
        borderRadius: 20,
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        ...extraStyle,
      }}
    >
      {children}
    </span>
  );
});

// ─── SectionTitle ────────────────────────────────────────────────
export const SectionTitle = memo(function SectionTitle({
  children,
  sub = "",
  style: extraStyle = {},
  C,
}) {
  return (
    <div style={{ marginBottom: 16, ...extraStyle }}>
      <div
        style={{
          color: C?.tp || "#fff",
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: "-0.3px",
        }}
      >
        {children}
      </div>
      {sub && (
        <div style={{ color: C?.tm || "#9CA3AF", fontSize: 12, marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
});

// ─── UploadButton ─────────────────────────────────────────────────
// Upload com validação de tipo, tamanho e progresso.
// Nunca salva base64 automaticamente se o upload falhar.
const TIPOS_PERMITIDOS = [
  "image/jpeg","image/png","image/webp","image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const TAMANHO_MAX_MB = 10;

export const UploadButton = memo(function UploadButton({
  onUpload,        // async (base64, fileName, tipo) => { url, source }
  onError,         // (msg) => void
  accept = "image/*,application/pdf",
  label = "📎 Anexar arquivo",
  C,
  style: extraStyle = {},
}) {
  const [progress, setProgress] = React.useState(null); // null | 0-100
  const inputRef = React.useRef();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset para permitir re-upload do mesmo arquivo

    // Validar tipo
    if (!TIPOS_PERMITIDOS.includes(file.type)) {
      onError?.(`Tipo de arquivo não permitido: ${file.type || "desconhecido"}`);
      return;
    }

    // Validar tamanho
    const maxBytes = TAMANHO_MAX_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      onError?.(`Arquivo muito grande. Máximo: ${TAMANHO_MAX_MB}MB`);
      return;
    }

    setProgress(0);
    try {
      // Lê como base64
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.round((ev.loaded / ev.total) * 50));
          }
        };
        reader.onload = () => res(reader.result);
        reader.onerror = () => rej(new Error("Falha ao ler o arquivo"));
        reader.readAsDataURL(file);
      });

      setProgress(60);
      const result = await onUpload(base64, file.name, file.type);

      // ⛔ Bloqueia salvamento automático de base64 se upload falhou
      if (!result?.url || result.source === "local") {
        setProgress(null);
        onError?.("Upload falhou. Verifique sua conexão e tente novamente.");
        return;
      }

      setProgress(100);
      setTimeout(() => setProgress(null), 1200);
    } catch (err) {
      setProgress(null);
      onError?.(`Erro no upload: ${err.message || "Tente novamente"}`);
    }
  };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6, ...extraStyle }}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFile}
        style={{ display: "none" }}
      />
      <Button
        variant="ghost"
        C={C}
        onClick={() => inputRef.current?.click()}
        disabled={progress !== null}
      >
        {progress !== null ? `⬆ Enviando ${progress}%` : label}
      </Button>
      {progress !== null && (
        <div style={{ height: 4, background: C?.b2 || "#2D3348", borderRadius: 99, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: C?.acc || "#4F8EF7",
              borderRadius: 99,
              transition: "width 0.3s",
            }}
          />
        </div>
      )}
    </div>
  );
});

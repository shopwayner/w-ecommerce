"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

type ProductCopyButtonProps = {
  label: string;
  text: string | null | undefined;
  className?: string;
};

async function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Falls through to the textarea fallback for restricted browser contexts.
    }
  }

  if (typeof document === "undefined") return;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export function ProductCopyButton({ label, text, className = "" }: ProductCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const value = text?.trim() ?? "";

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  if (!value) return null;

  return (
    <button
      aria-label={copied ? "Copiado" : label}
      className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded-md border border-matrix-border bg-matrix-panel2/85 text-matrix-gold transition hover:border-matrix-gold/60 hover:bg-matrix-goldSoft/45 hover:text-matrix-goldDark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matrix-gold ${className}`}
      onClick={async (event) => {
        event.stopPropagation();
        await copyToClipboard(value);
        setCopied(true);
      }}
      title={copied ? "Copiado" : label}
      type="button"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

import { useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { formatSha256Badge } from "./lib/cryptoUtils";

export default function Sha256Badge({ hash, className = "" }: { hash?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const hex = (hash || "").trim().toLowerCase();
  if (!hex) return null;
  const copy = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(hex);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={hex}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-slate-600 hover:border-slate-400 hover:text-slate-900 ${className}`}
    >
      {copied ? <Check className="h-2.5 w-2.5 shrink-0 text-emerald-600" /> : <Copy className="h-2.5 w-2.5 shrink-0" />}
      <span className="min-w-0 truncate">{formatSha256Badge(hex)}</span>
    </button>
  );
}

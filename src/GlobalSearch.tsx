import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock, FileText, FolderOpen, GitCommitHorizontal, MapPin,
  Phone, Search, User, Users, X,
} from "lucide-react";
import type { SearchGroup, SearchHit } from "./lib/globalSearch";
import { searchDossier } from "./lib/globalSearch";

const mono = "font-mono";

const GROUP_ICON: Record<SearchGroup, typeof User> = {
  Cases: FolderOpen,
  Entities: Users,
  Events: GitCommitHorizontal,
  Evidence: FileText,
  Contacts: Phone,
};

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (hit: SearchHit) => void;
};

export default function GlobalSearch({ open, onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    setBusy(true);
    const handle = window.setTimeout(() => {
      void searchDossier(q).then((rows) => {
        setHits(rows);
        setActive(0);
        setBusy(false);
      });
    }, 140);
    return () => window.clearTimeout(handle);
  }, [query, open]);

  const grouped = useMemo(() => {
    const order: SearchGroup[] = ["Cases", "Entities", "Events", "Evidence", "Contacts"];
    return order
      .map((group) => ({ group, rows: hits.filter((h) => h.group === group) }))
      .filter((g) => g.rows.length);
  }, [hits]);

  const flat = grouped.flatMap((g) => g.rows);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(flat.length - 1, i + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter" && flat[active]) {
        e.preventDefault();
        onPick(flat[active]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, active, onClose, onPick]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/35 px-4 pt-[12vh] backdrop-blur-[3px]">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-[640px] overflow-hidden rounded-[16px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cases, entities, events, evidence, contacts…"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-slate-400"
          />
          <span className={`shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 ${mono} text-[10px] text-slate-400`}>ESC</span>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[min(60vh,420px)] overflow-auto py-2">
          {!query.trim() && (
            <div className="px-4 py-8 text-center text-[13px] text-slate-400">Type a name, plate, address, or quote.</div>
          )}
          {query.trim() && busy && hits.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-slate-400">Searching local vault…</div>
          )}
          {query.trim() && !busy && hits.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-slate-400">No matches in this vault.</div>
          )}
          {grouped.map((g) => {
            const Icon = GROUP_ICON[g.group];
            return (
              <div key={g.group} className="px-2 pb-1">
                <div className={`flex items-center gap-2 px-3 py-1.5 ${mono} text-[10px] tracking-[0.12em] text-slate-400`}>
                  <Icon className="h-3 w-3" />{g.group.toUpperCase()}
                </div>
                {g.rows.map((hit) => {
                  const idx = flat.indexOf(hit);
                  const on = idx === active;
                  const RowIcon = hit.kind === "entity" ? User : hit.kind === "event" ? Clock : hit.kind === "evidence" ? FileText : hit.kind === "contact" ? Phone : hit.kind === "case" ? FolderOpen : MapPin;
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => onPick(hit)}
                      className={`flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left ${on ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <RowIcon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? "text-blue-600" : "text-slate-400"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-slate-900">{hit.title}</span>
                        <span className="block truncate text-[12px] text-slate-500">{hit.subtitle}</span>
                      </span>
                      <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 ${mono} text-[9.5px] tracking-[0.06em] ${on ? "border-blue-200 bg-white text-blue-700" : "border-slate-200 text-slate-400"}`}>
                        {hit.group.slice(0, 1)}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className={`flex items-center gap-3 border-t border-slate-100 px-4 py-2 ${mono} text-[10px] text-slate-400`}>
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
        </div>
      </div>
    </div>
  );
}

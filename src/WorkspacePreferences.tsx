import { useState } from "react";
import { applyThemePreference, type ThemePreference } from "./db";
import { getLocalApiKey, getLocalProvider, setLocalApiKey, setLocalProvider, type LlmProvider } from "./lib/settings";

const mono = "font-mono";
const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

const THEMES: { id: ThemePreference; label: string; hint: string }[] = [
  { id: "system", label: "System", hint: "Follow the OS appearance." },
  { id: "light", label: "Light", hint: "Always use the daylight workspace." },
  { id: "dark", label: "Dark", hint: "Always use the night workspace." },
];

export default function WorkspacePreferences({
  themePreference,
  onThemeChange,
  onBack,
}: {
  themePreference: ThemePreference;
  onThemeChange: (pref: ThemePreference) => void | Promise<void>;
  onBack: () => void;
}) {
  const [providerDraft, setProviderDraft] = useState<LlmProvider>(getLocalProvider);
  const [apiKeyDraft, setApiKeyDraft] = useState(getLocalApiKey);
  const [saved, setSaved] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[780px] px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-10">
      <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>SETTINGS / WORKSPACE</div>
      <h1 className="mb-2 text-[34px] font-semibold leading-tight tracking-tight">Workspace preferences</h1>
      <p className="mb-8 max-w-2xl text-[14px] text-slate-500">Appearance and local AI fallbacks for this machine. Keys never leave the browser except for extract calls.</p>

      <section className="mb-5 overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-[22px] py-[18px]">
          <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Appearance</h2>
          <p className="text-[12.5px] text-slate-500">Stored on the operator profile.</p>
        </div>
        <div className="grid gap-2.5 px-[22px] py-[22px] sm:grid-cols-3">
          {THEMES.map((t) => {
            const on = themePreference === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  applyThemePreference(t.id);
                  void onThemeChange(t.id);
                }}
                className={`rounded-[12px] border px-3.5 py-3 text-left ${on ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}
              >
                <div className="text-[13.5px] font-semibold">{t.label}</div>
                <div className="mt-1 text-[12px] text-slate-500">{t.hint}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-6 overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-[22px] py-[18px]">
          <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Local AI fallback</h2>
          <p className="text-[12.5px] text-slate-500">
            Prefer <span className={mono}>GEMINI_API_KEY</span> or <span className={mono}>OPENAI_API_KEY</span> in <span className={mono}>.env.local</span>. This field is a device fallback.
          </p>
        </div>
        <div className="flex flex-col gap-4 px-[22px] py-[22px]">
          <div className="flex flex-wrap gap-2">
            {(["gemini", "openai", "anthropic"] as LlmProvider[]).map((p) => (
              <button key={p} type="button" onClick={() => setProviderDraft(p)}
                className={`h-9 flex-1 rounded-lg border text-[12.5px] font-medium ${providerDraft === p ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                {p === "gemini" ? "Gemini" : p === "openai" ? "OpenAI" : "Anthropic"}
              </button>
            ))}
          </div>
          <input type="password" value={apiKeyDraft} onChange={(e) => setApiKeyDraft(e.target.value)}
            placeholder="AIza… or sk-…" className={`${inputCls} h-10 text-[13.5px]`} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setLocalApiKey(apiKeyDraft);
                setLocalProvider(providerDraft);
                setSaved(true);
                window.setTimeout(() => setSaved(false), 1600);
              }}
              className="h-9 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700"
            >
              {saved ? "Saved" : "Save API fallback"}
            </button>
          </div>
        </div>
      </section>

      <button type="button" onClick={onBack}
        className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900">
        Back to Hub
      </button>
    </div>
  );
}

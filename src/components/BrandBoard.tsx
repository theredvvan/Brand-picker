"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  intlLocale,
  isRtl,
  LANGS,
  pickLang,
  plural,
  translate,
  type Lang,
  type MessageKey,
  type Vars,
} from "@/lib/i18n";
import { looksLikeTypo, toKey } from "@/lib/normalize";
import type { ActivityEvent, Claim, Snapshot } from "@/lib/types";

const TOKENS_KEY = "brand-picker:tokens";
const ADMIN_KEY = "brand-picker:admin";
const LANG_KEY = "brand-picker:lang";
const POLL_MS = 4000;

/* ---------- storage helpers ---------- */

function readJSON<T>(storage: () => Storage, key: string, fallback: T): T {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: just won't persist */
  }
}

/* ---------- shared context: language, logos, duplicates ---------- */

type Board = {
  lang: Lang;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Like t(), but placeholders can be React elements. */
  r: (key: MessageKey, parts: Record<string, ReactNode>) => ReactNode;
  arrow: string;
  relative: (iso: string, now: number) => string;
  exact: (iso: string) => string;
  logos: Map<string, Claim>;
  /** claim id -> an earlier claim pointing to the same company website */
  dupOf: Map<number, Claim>;
};

const BoardContext = createContext<Board | null>(null);
const useBoard = () => useContext(BoardContext)!;

function makeBoard(lang: Lang, claims: Claim[]): Board {
  const locale = intlLocale(lang);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const dtf = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const t = (key: MessageKey, vars?: Vars) => translate(lang, key, vars);

  const logos = new Map(claims.map((c) => [toKey(c.brandName), c]));
  const dupOf = new Map<number, Claim>();
  const firstByDomain = new Map<string, Claim>();
  for (const c of claims) {
    const d = c.logoDomain?.replace(/^www\./, "");
    if (!d) continue;
    const first = firstByDomain.get(d);
    if (first) dupOf.set(c.id, first);
    else firstByDomain.set(d, c);
  }

  return {
    lang,
    t,
    r: (key, parts) => {
      const template = translate(lang, key);
      return template.split(/(\{\w+\})/).map((piece, i) => {
        const m = piece.match(/^\{(\w+)\}$/);
        return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : piece}</Fragment>;
      });
    },
    arrow: isRtl(lang) ? "←" : "→",
    relative: (iso, now) => {
      const s = Math.round((new Date(iso).getTime() - now) / 1000);
      const abs = Math.abs(s);
      if (abs < 10) return t("justNow");
      if (abs < 60) return rtf.format(s, "second");
      if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
      if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
      return rtf.format(Math.round(s / 86400), "day");
    },
    exact: (iso) => dtf.format(new Date(iso)),
    logos,
    dupOf,
  };
}

/* ---------- small visual pieces ---------- */

const TAG_COLORS = [
  ["#e3e2e0", "#32302c"],
  ["#eee0da", "#5c3b23"],
  ["#fadec9", "#73381d"],
  ["#fdecc8", "#6a4f1b"],
  ["#dbeddb", "#1c3829"],
  ["#d3e5ef", "#183347"],
  ["#e8deee", "#412454"],
  ["#f5e0e9", "#4c2337"],
];
function tagColor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = TAG_COLORS[h % TAG_COLORS.length];
  return { background: bg, color: fg };
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={tagColor(toKey(name))}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function BrandLogo({ name, size }: { name: string; size: number }) {
  const { logos, t } = useBoard();
  const info = logos.get(toKey(name));
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const box = { width: size, height: size };

  if (info?.logoUrl && info.logoUrl !== brokenUrl)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={info.logoUrl}
        alt=""
        title={info.logoDomain ?? undefined}
        style={box}
        className="shrink-0 rounded-full bg-white object-contain p-[2px] ring-1 ring-black/5"
        onError={() => setBrokenUrl(info.logoUrl)}
      />
    );
  if (info?.logoStatus === "pending")
    return <span style={box} className="live-dot shrink-0 rounded-full bg-black/10" title={t("findingLogo")} />;
  return (
    <span
      style={{ ...box, fontSize: size * 0.55 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-white/60 font-semibold"
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function BrandTag({ name, strike, large }: { name: string; strike?: boolean; large?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full align-middle ${
        large ? "py-1 ps-1 pe-3.5 text-lg" : "py-0.5 ps-0.5 pe-2.5 text-[0.95em]"
      } ${strike ? "opacity-60" : ""}`}
      style={tagColor(toKey(name) + "#brand")}
    >
      <BrandLogo name={name} size={large ? 28 : 18} />
      <span className={`truncate ${strike ? "line-through" : ""}`}>{name}</span>
    </span>
  );
}

/** Warning when Groq found the same website as an earlier pick (e.g. "Coke" vs "Coca-Cola"). */
function DupBadge({ claim }: { claim: Claim }) {
  const { dupOf, t } = useBoard();
  const orig = dupOf.get(claim.id);
  if (!orig) return null;
  return (
    <span
      className="inline-block rounded-full bg-warn-bg px-2 py-0.5 text-[11px] text-warn"
      title={t("dup.title", { name: orig.studentName, brand: orig.brandName, domain: claim.logoDomain ?? "" })}
    >
      {t("dup.badge", { name: orig.studentName })}
    </span>
  );
}

/* ---------- main component ---------- */

type Props = { initial: Snapshot; setupError: string | null; initialLang: Lang };

export default function BrandBoard({ initial, setupError, initialLang }: Props) {
  const [data, setData] = useState<Snapshot>(initial);
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [tab, setTab] = useState<"table" | "activity">("table");
  const [query, setQuery] = useState("");
  const [flashIds, setFlashIds] = useState<Set<number>>(new Set());
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [success, setSuccess] = useState<{ claim: Claim; rank: number } | null>(null);
  const [unlocking, setUnlocking] = useState<Claim | null>(null);
  const knownIds = useRef(new Set(initial.claims.map((c) => c.id)));

  const board = useMemo(() => makeBoard(lang, data.claims), [lang, data.claims]);
  const { t } = board;

  // Per-browser state, and the device language (unless the viewer picked one).
  useEffect(() => {
    setTokens(readJSON(() => localStorage, TOKENS_KEY, {}));
    setAdminKey(readJSON<string | null>(() => sessionStorage, ADMIN_KEY, null));
    const saved = readJSON<string | null>(() => localStorage, LANG_KEY, null);
    setLangState(saved ? pickLang([saved]) : pickLang(navigator.languages ?? [navigator.language]));
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
    document.title = translate(lang, "title");
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    writeJSON(() => localStorage, LANG_KEY, l);
  };

  const showToast = useCallback((kind: "ok" | "bad", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/claims", {
        cache: "no-store",
        headers: adminKey ? { "x-admin-key": adminKey } : {},
      });
      if (!res.ok) throw new Error();
      const json = (await res.json()) as Snapshot & { isAdmin: boolean };
      const fresh = json.claims.filter((c) => !knownIds.current.has(c.id)).map((c) => c.id);
      knownIds.current = new Set(json.claims.map((c) => c.id));
      if (fresh.length) setFlashIds(new Set(fresh));
      setData({ claims: json.claims, events: json.events });
      setIsAdmin(json.isAdmin);
      setOnline(true);
      setNow(Date.now());
      return json;
    } catch {
      setOnline(false);
      return null;
    }
  }, [adminKey]);

  // Live updates: poll while the tab is visible.
  useEffect(() => {
    refresh();
    const tick = () => document.visibilityState === "visible" && refresh();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const saveToken = (id: number, token: string | null) => {
    setTokens((prev) => {
      const next = { ...prev };
      if (token) next[id] = token;
      else delete next[id];
      writeJSON(() => localStorage, TOKENS_KEY, next);
      return next;
    });
  };

  const headers = (id?: number): Record<string, string> => {
    const h: Record<string, string> = { "content-type": "application/json", "x-lang": lang };
    if (id != null && tokens[id]) h["x-edit-token"] = tokens[id];
    if (adminKey) h["x-admin-key"] = adminKey;
    return h;
  };

  /* ----- actions ----- */

  async function claim(studentName: string, brandName: string, pin: string) {
    const res = await fetch("/api/claims", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ studentName, brandName, pin }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return json.error ?? t("toast.saveFail");
    saveToken(json.claim.id, json.token);
    knownIds.current.add(json.claim.id);
    setFlashIds(new Set([json.claim.id]));
    const snap = await refresh();
    const pos = snap?.claims.findIndex((c) => c.id === json.claim.id) ?? -1;
    setSuccess({ claim: json.claim, rank: pos >= 0 ? pos + 1 : data.claims.length + 1 });
    return null;
  }

  /** "This is me": trade the PIN for this pick's edit key on this device. */
  async function unlock(c: Claim, pin: string) {
    const res = await fetch(`/api/claims/${c.id}/unlock`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ pin }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return json.error ?? t("toast.unlockFail");
    saveToken(c.id, json.token);
    setUnlocking(null);
    showToast("ok", t("toast.welcomeBack", { name: c.studentName }));
    window.scrollTo({ top: 0, behavior: "smooth" });
    return null;
  }

  async function edit(id: number, studentName: string, brandName: string) {
    const res = await fetch(`/api/claims/${id}`, {
      method: "PATCH",
      headers: headers(id),
      body: JSON.stringify({ studentName, brandName }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return json.error ?? t("toast.saveFail");
    showToast("ok", t("toast.saved"));
    await refresh();
    return null;
  }

  async function release(c: Claim) {
    if (!confirm(t("toast.releaseConfirm", { brand: c.brandName }))) return;
    const res = await fetch(`/api/claims/${c.id}`, { method: "DELETE", headers: headers(c.id) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return showToast("bad", json.error ?? t("toast.releaseFail"));
    saveToken(c.id, null);
    showToast("ok", t("toast.released", { brand: c.brandName }));
    await refresh();
  }

  async function toggleAdmin() {
    if (adminKey) {
      setAdminKey(null);
      setIsAdmin(false);
      try {
        sessionStorage.removeItem(ADMIN_KEY);
      } catch {}
      return;
    }
    const key = prompt(t("toast.adminPrompt"));
    if (!key) return;
    const res = await fetch("/api/claims", { headers: { "x-admin-key": key } });
    const json = await res.json().catch(() => ({}));
    if (json.isAdmin) {
      setAdminKey(key);
      writeJSON(() => sessionStorage, ADMIN_KEY, key);
      showToast("ok", t("toast.adminOn"));
    } else showToast("bad", t("toast.wrongPass"));
  }

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["#", t("csv.student"), t("csv.brand"), "Website", t("csv.claimedAt"), t("csv.lastEdited")],
      ...data.claims.map((c, i) => [
        String(i + 1),
        c.studentName,
        c.brandName,
        c.logoDomain ?? "",
        c.createdAt,
        c.updatedAt !== c.createdAt ? c.updatedAt : "",
      ]),
    ];
    // BOM so Excel opens accents and Arabic correctly.
    const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "brand-picks.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ----- derived ----- */

  const mine = data.claims.filter((c) => tokens[c.id]);
  const lastEvent = data.events[0];
  const q = toKey(query);
  const visible = q
    ? data.claims.filter((c) => toKey(c.studentName).includes(q) || toKey(c.brandName).includes(q))
    : data.claims;
  const rank = useMemo(() => new Map(data.claims.map((c, i) => [c.id, i + 1])), [data.claims]);
  // Show the live row in the popup so the logo (and any duplicate warning) appears as soon as it's found.
  const successClaim = success ? (data.claims.find((c) => c.id === success.claim.id) ?? success.claim) : null;

  return (
    <BoardContext.Provider value={board}>
      <div className="min-h-screen pb-16 sm:pb-24">
        {/* Cover */}
        <div className="h-28 w-full bg-gradient-to-r from-[#f6d365]/60 via-[#fda085]/50 to-[#a18cd1]/50 sm:h-40" />

        <main className="mx-auto max-w-[880px] px-4 sm:px-12">
          <div className="-mt-9 select-none text-[56px] leading-none sm:-mt-12 sm:text-[78px]" aria-hidden>
            🏷️
          </div>
          <h1 className="mt-3 text-[30px] font-bold leading-tight tracking-tight sm:mt-4 sm:text-[40px]">
            {t("title")}
          </h1>
          <p className="mt-1 text-muted">{t("subtitle")}</p>

          {/* Notion-style properties */}
          <dl className="mt-5 grid grid-cols-[112px_1fr] gap-y-1 text-sm sm:mt-6 sm:grid-cols-[150px_1fr]">
            <Prop icon="◎" label={t("prop.rule")}>
              {t("prop.ruleValue")}
            </Prop>
            <Prop icon="#" label={t("prop.claimed")}>
              {plural(lang, "prop.brands", data.claims.length)}
            </Prop>
            <Prop icon="◷" label={t("prop.lastActivity")}>
              {lastEvent && now ? (
                <span title={board.exact(lastEvent.createdAt)}>{board.relative(lastEvent.createdAt, now)}</span>
              ) : (
                <span className="text-faint">{t("prop.nothingYet")}</span>
              )}
            </Prop>
            <Prop icon="●" label={t("prop.status")}>
              {online ? (
                <span className="flex items-start gap-1.5">
                  <span className="live-dot mt-1.5 size-2 shrink-0 rounded-full bg-ok" />
                  <span>{t("prop.live")}</span>
                </span>
              ) : (
                <span className="text-bad">{t("prop.offline")}</span>
              )}
            </Prop>
          </dl>

          <hr className="my-6 border-line sm:my-7" />

          {setupError ? (
            <div className="rounded-lg border border-line bg-warn-bg p-4 text-sm text-warn">
              <strong>{t("setupNeeded")}</strong> {setupError}
            </div>
          ) : (
            <ClaimSection
              claims={data.claims}
              mine={mine}
              onClaim={claim}
              onEdit={edit}
              onRelease={release}
              onUnlock={setUnlocking}
            />
          )}

          {/* Tabs + toolbar */}
          <div className="mt-10 flex flex-wrap items-center gap-x-2 border-b border-line">
            <TabButton active={tab === "table"} onClick={() => setTab("table")}>
              ▦ {t("tab.table")}
            </TabButton>
            <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
              ⏱ {t("tab.activity")}
              <span className="ms-1.5 rounded bg-hover px-1.5 text-xs text-muted">{data.events.length}</span>
            </TabButton>
            <div className="flex w-full items-center gap-1 pb-1.5 sm:ms-auto sm:w-auto">
              {tab === "table" && (
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("search")}
                  type="search"
                  className="min-w-0 flex-1 rounded px-2 py-1.5 text-base outline-none placeholder:text-faint hover:bg-hover focus:bg-hover sm:w-44 sm:flex-none sm:py-1 sm:text-sm"
                />
              )}
              <button
                onClick={exportCsv}
                className="ms-auto shrink-0 rounded px-2 py-1.5 text-sm text-muted hover:bg-hover sm:py-1"
              >
                {t("exportCsv")}
              </button>
            </div>
          </div>

          {tab === "table" ? (
            <ClaimsList
              claims={visible}
              all={data.claims}
              rank={rank}
              now={now}
              canEdit={(c) => isAdmin || Boolean(tokens[c.id])}
              flashIds={flashIds}
              onEdit={edit}
              onRelease={release}
              onUnlock={setUnlocking}
              empty={data.claims.length === 0 ? t("emptyNone") : t("emptyNoMatch")}
            />
          ) : (
            <ActivityLog events={data.events} now={now} />
          )}

          <footer className="mt-14 flex flex-col gap-3 text-xs text-faint sm:mt-16 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("footer.compare")}</span>
            <span className="flex shrink-0 items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span aria-hidden>🌐</span>
                <span className="sr-only">{t("footer.language")}</span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as Lang)}
                  className="rounded bg-transparent px-1 py-1 text-sm text-muted outline-none hover:bg-hover"
                  aria-label={t("footer.language")}
                >
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={toggleAdmin} className="rounded px-1.5 py-1 hover:bg-hover hover:text-muted">
                {adminKey ? t("exitAdmin") : t("admin")}
              </button>
            </span>
          </footer>
        </main>

        {success && successClaim && (
          <SuccessDialog claim={successClaim} rank={success.rank} onClose={() => setSuccess(null)} />
        )}

        {unlocking && (
          <UnlockDialog claim={unlocking} onUnlock={(pin) => unlock(unlocking, pin)} onClose={() => setUnlocking(null)} />
        )}

        {toast && (
          <div
            role="status"
            className={`card fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg px-4 py-2.5 text-center text-sm ${
              toast.kind === "ok" ? "bg-fg text-bg" : "bg-bad text-white"
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>
    </BoardContext.Provider>
  );
}

/* ---------- layout pieces ---------- */

function Prop({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex items-start gap-2 py-1 text-muted">
        <span className="w-4 shrink-0 text-center text-faint">{icon}</span>
        {label}
      </dt>
      <dd className="py-1">{children}</dd>
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center border-b-2 px-2 py-2.5 text-sm sm:py-2 ${
        active ? "border-fg font-medium" : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/** Centered dialog on desktop, bottom sheet on phones. */
function Sheet({
  labelledBy,
  onClose,
  children,
  asForm,
  onSubmit,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  asForm?: boolean;
  onSubmit?: (e: React.FormEvent) => void;
}) {
  const Box = asForm ? "form" : "div";
  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <Box
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="card pop-in max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-bg px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-center sm:max-w-sm sm:rounded-2xl sm:p-7"
      >
        <div className="mx-auto -mt-2 mb-4 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        {children}
      </Box>
    </div>
  );
}

/* ---------- dialogs ---------- */

/** 4 separate digit boxes; typing moves to the next box, Backspace goes back. */
function PinInput({
  value,
  onChange,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  label: string;
}) {
  const { t } = useBoard();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 4 }, (_, i) => value[i] ?? "");

  function set(i: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    // Pasting "1234" into any box fills them all.
    const next = (value.slice(0, i) + typed).slice(0, 4);
    onChange(next);
    refs.current[Math.min(next.length, 3)]?.focus();
  }

  function key(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const cut = digits[i] ? i : Math.max(i - 1, 0);
      onChange(value.slice(0, cut));
      refs.current[cut]?.focus();
    }
  }

  return (
    // PINs always read left to right, even in Arabic.
    <div className="grid w-full max-w-[224px] grid-cols-4 gap-2" role="group" aria-label={label} dir="ltr">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => key(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          type="password"
          maxLength={4}
          autoFocus={autoFocus && i === 0}
          aria-label={t("pin.digit", { label, n: i + 1 })}
          className="h-12 w-full min-w-0 rounded-lg border-2 border-line bg-bg text-center text-xl font-semibold outline-none transition focus:border-accent"
        />
      ))}
    </div>
  );
}

function UnlockDialog({
  claim,
  onUnlock,
  onClose,
}: {
  claim: Claim;
  onUnlock: (pin: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t, r } = useBoard();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Check automatically once the 4th digit is typed.
  useEffect(() => {
    if (pin.length === 4) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (pin.length !== 4 || busy) return;
    setBusy(true);
    setError(null);
    const err = await onUnlock(pin);
    setBusy(false);
    if (err) {
      setError(err);
      setPin("");
    }
  }

  return (
    <Sheet labelledBy="unlock-title" onClose={onClose} asForm onSubmit={submit}>
      <div className="text-4xl" aria-hidden>
        🔑
      </div>
      <h2 id="unlock-title" className="mt-3 text-xl font-bold">
        {t("unlock.title", { name: claim.studentName })}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {r("unlock.body", { brand: <BrandTag name={claim.brandName} /> })}
      </p>
      <div className="mt-5 flex justify-center">
        <PinInput value={pin} onChange={setPin} autoFocus label={t("unlock.pin")} />
      </div>
      {error && <p className="mt-4 rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
      <button
        type="submit"
        disabled={pin.length !== 4 || busy}
        className="mt-6 w-full rounded-md bg-accent px-5 py-3 font-medium text-accent-fg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:py-2.5"
      >
        {busy ? t("unlock.checking") : t("unlock.button")}
      </button>
      <p className="mt-3 text-xs text-faint">{t("unlock.forgot")}</p>
    </Sheet>
  );
}

function SuccessDialog({ claim, rank, onClose }: { claim: Claim; rank: number; onClose: () => void }) {
  const { t, exact, dupOf } = useBoard();
  const dup = dupOf.get(claim.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "Enter") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Sheet labelledBy="success-title" onClose={onClose}>
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-ok-bg">
        <svg
          viewBox="0 0 24 24"
          className="size-8 text-ok"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h2 id="success-title" className="mt-5 text-2xl font-bold">
        {t("success.title")}
      </h2>
      <p className="mt-2 text-muted">{t("success.body")}</p>
      <p className="mt-2 text-sm text-muted">{t("success.pin")}</p>
      <div className="mt-5 rounded-xl bg-soft px-4 py-4">
        <p className="text-sm text-muted">{claim.studentName}</p>
        <p className="mt-2 font-semibold">
          <BrandTag name={claim.brandName} large />
        </p>
        <p className="mt-2 text-xs text-faint">
          {t("success.rank", { rank })} · {exact(claim.createdAt)}
        </p>
      </div>
      {dup && (
        <p className="mt-4 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">
          {t("dup.popup", { name: dup.studentName, brand: dup.brandName })}
        </p>
      )}
      <button
        onClick={onClose}
        autoFocus
        className="mt-6 w-full rounded-md bg-accent px-5 py-3 font-medium text-accent-fg transition hover:brightness-110 sm:py-2.5"
      >
        {t("success.gotIt")}
      </button>
    </Sheet>
  );
}

/* ---------- claiming and editing ---------- */

/** Live check under a brand input: exact match (blocked), likely typo, similar name, or free. */
function BrandHint({ claims, brand, ignoreId }: { claims: Claim[]; brand: string; ignoreId?: number }) {
  const { t, exact } = useBoard();
  const brandKey = toKey(brand);
  if (!brandKey) return null;
  const others = claims.filter((c) => c.id !== ignoreId);
  const owner = others.find((c) => toKey(c.brandName) === brandKey);

  if (owner)
    return (
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-bad">
        <strong className="font-semibold">✕ {t("hint.takenTitle")}</strong>
        <BrandTag name={owner.brandName} />
        <span className="text-xs opacity-80">
          {t("hint.takenBy", { name: owner.studentName, time: exact(owner.createdAt) })}
        </span>
      </span>
    );

  const typo = others.find((c) => looksLikeTypo(toKey(c.brandName), brandKey));
  if (typo)
    return <span className="text-warn">⚠ {t("hint.typo", { brand: typo.brandName, name: typo.studentName })}</span>;

  const similar =
    brandKey.length >= 3
      ? others.find((c) => {
          const k = toKey(c.brandName);
          return k.length >= 3 && (k.includes(brandKey) || brandKey.includes(k));
        })
      : undefined;
  return (
    <span className="text-ok">
      {t("hint.available")}
      {similar && <span className="text-warn">{t("hint.similar", { name: similar.studentName, brand: similar.brandName })}</span>}
    </span>
  );
}

/** Name + brand editor used on the "Your pick" card and in the list. */
function ClaimEditor({
  claim,
  claims,
  onSave,
  onCancel,
}: {
  claim: Claim;
  claims: Claim[];
  onSave: (studentName: string, brandName: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const { t } = useBoard();
  const [name, setName] = useState(claim.studentName);
  const [brand, setBrand] = useState(claim.brandName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = claims.some((c) => c.id !== claim.id && toKey(c.brandName) === toKey(brand));
  const rank = claims.findIndex((c) => c.id === claim.id) + 1;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === claim.studentName && brand.trim() === claim.brandName) return onCancel();
    setBusy(true);
    const err = await onSave(name, brand);
    setBusy(false);
    setError(err);
  }

  return (
    <form
      onSubmit={save}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      className="grid gap-4 text-start sm:grid-cols-2"
    >
      <label className="block">
        <span className="text-sm text-muted">{t("my.yourName")}</span>
        <input
          className="typeform-input mt-1 !text-lg"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
        />
      </label>
      <label className="block">
        <span className="text-sm text-muted">{t("my.brand")}</span>
        <input
          className="typeform-input mt-1 !text-lg"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          maxLength={60}
          required
          autoFocus
        />
        <span className="mt-1.5 block min-h-5 text-sm">
          {brand.trim() !== claim.brandName && <BrandHint claims={claims} brand={brand} ignoreId={claim.id} />}
        </span>
      </label>
      {error && <p className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad sm:col-span-2">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={busy || taken}
          className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:py-2"
        >
          {busy ? t("saving") : t("my.saveChanges")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-2.5 text-sm text-muted hover:bg-hover sm:py-2"
        >
          {t("cancel")}
        </button>
        <span className="ms-auto text-xs text-faint">{t("my.keepPlace", { rank })}</span>
      </div>
    </form>
  );
}

/** Your own claim, with Change / Release. */
function MyPick({
  claim,
  claims,
  onEdit,
  onRelease,
}: {
  claim: Claim;
  claims: Claim[];
  onEdit: (id: number, studentName: string, brandName: string) => Promise<string | null>;
  onRelease: (c: Claim) => void;
}) {
  const { t, arrow } = useBoard();
  const [editing, setEditing] = useState(false);

  if (editing)
    return (
      <div className="mt-3">
        <ClaimEditor
          claim={claim}
          claims={claims}
          onCancel={() => setEditing(false)}
          onSave={async (n, b) => {
            const err = await onEdit(claim.id, n, b);
            if (!err) setEditing(false);
            return err;
          }}
        />
      </div>
    );

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-xl sm:text-2xl">
          <strong className="break-words">{claim.studentName}</strong> <span className="text-faint">{arrow}</span>
          <BrandTag name={claim.brandName} large />
        </p>
        <span className="flex w-full gap-2 sm:ms-auto sm:w-auto">
          <button
            onClick={() => setEditing(true)}
            className="flex-1 rounded-md border border-line px-3 py-2.5 text-sm hover:bg-hover sm:flex-none sm:py-1.5"
          >
            {t("my.change")}
          </button>
          <button
            onClick={() => onRelease(claim)}
            className="flex-1 rounded-md border border-line px-3 py-2.5 text-sm text-muted hover:bg-bad-bg hover:text-bad sm:flex-none sm:py-1.5"
          >
            {t("release")}
          </button>
        </span>
      </div>
      <div className="mt-2">
        <DupBadge claim={claim} />
      </div>
    </div>
  );
}

/* Typeform-style claim card */
function ClaimSection({
  claims,
  mine,
  onClaim,
  onEdit,
  onRelease,
  onUnlock,
}: {
  claims: Claim[];
  mine: Claim[];
  onClaim: (studentName: string, brandName: string, pin: string) => Promise<string | null>;
  onEdit: (id: number, studentName: string, brandName: string) => Promise<string | null>;
  onRelease: (c: Claim) => void;
  onUnlock: (c: Claim) => void;
}) {
  const { t, arrow } = useBoard();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const brandKey = toKey(brand);
  const owner = brandKey ? claims.find((c) => toKey(c.brandName) === brandKey) : undefined;
  // Same name already has a pick: offer to unlock it instead of claiming again.
  const nameKey = toKey(name);
  const existing = nameKey ? claims.find((c) => toKey(c.studentName) === nameKey && !mine.includes(c)) : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pin.length !== 4) return setError(t("q.choosePin"));
    setBusy(true);
    setError(null);
    const err = await onClaim(name, brand, pin);
    setBusy(false);
    if (err) setError(err);
    else {
      setName("");
      setBrand("");
      setPin("");
      setShowForm(false);
    }
  }

  if (mine.length && !showForm) {
    return (
      <div className="card rounded-xl border border-line bg-bg p-5 sm:p-8">
        <p className="text-sm text-muted">{t("my.yourPick")}</p>
        {mine.map((c) => (
          <MyPick key={c.id} claim={c} claims={claims} onEdit={onEdit} onRelease={onRelease} />
        ))}
        <p className="mt-5 text-sm text-muted">
          <button
            className="underline decoration-line underline-offset-2 hover:text-fg"
            onClick={() => setShowForm(true)}
          >
            {t("my.someoneElse")}
          </button>
        </p>
      </div>
    );
  }

  const Step = ({ n, children }: { n: number; children: ReactNode }) => (
    <span className="flex items-baseline gap-2 text-lg sm:text-xl">
      <span className="shrink-0 whitespace-nowrap text-sm text-accent">
        {n} {arrow}
      </span>
      <span>{children}</span>
    </span>
  );

  return (
    <form onSubmit={submit} className="card rounded-xl border border-line bg-bg p-5 sm:p-10">
      <label className="block">
        <Step n={1}>{t("q.name")}</Step>
        <input
          className="typeform-input mt-3"
          placeholder={t("q.namePh")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoComplete="name"
          required
        />
        {existing && (
          <span className="mt-2 block text-sm text-warn">
            {t("q.existing", { name: existing.studentName, brand: existing.brandName })}{" "}
            <button
              type="button"
              onClick={() => onUnlock(existing)}
              className="font-medium text-accent underline underline-offset-2"
            >
              {t("q.thatsMe")}
            </button>
          </span>
        )}
      </label>

      <label className="mt-8 block sm:mt-9">
        <Step n={2}>{t("q.brand")}</Step>
        <input
          className="typeform-input mt-3"
          placeholder={t("q.brandPh")}
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          maxLength={60}
          required
        />
        <span className="mt-2 block min-h-5 text-sm">
          <BrandHint claims={claims} brand={brand} />
        </span>
      </label>

      <div className="mt-8 sm:mt-9">
        <Step n={3}>{t("q.pin")}</Step>
        <p className="mt-1 text-sm text-muted">{t("q.pinHelp")}</p>
        <div className="mt-4">
          <PinInput value={pin} onChange={setPin} label={t("q.yourPin")} />
        </div>
      </div>

      {error && <p className="mt-4 rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || Boolean(owner) || pin.length !== 4}
          className="w-full rounded-md bg-accent px-5 py-3 font-medium text-accent-fg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5"
        >
          {busy ? t("saving") : t("q.claim")}
        </button>
        <span className="hidden text-xs text-faint sm:inline">
          {t("q.pressEnter", { key: "Enter ↵" })}
        </span>
        {mine.length > 0 && (
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="text-sm text-muted hover:text-fg sm:ms-auto"
          >
            {t("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

/* ---------- list: cards on phones, table on larger screens ---------- */

type ListProps = {
  claims: Claim[];
  all: Claim[];
  rank: Map<number, number>;
  now: number | null;
  canEdit: (c: Claim) => boolean;
  flashIds: Set<number>;
  onEdit: (id: number, studentName: string, brandName: string) => Promise<string | null>;
  onRelease: (c: Claim) => void;
  onUnlock: (c: Claim) => void;
  empty: string;
};

function ClaimedAt({ claim }: { claim: Claim }) {
  const { t, exact } = useBoard();
  return (
    <>
      <span className="tabular-nums">{exact(claim.createdAt)}</span>
      {claim.updatedAt !== claim.createdAt && (
        <span
          className="ms-1.5 rounded bg-warn-bg px-1 text-[11px] text-warn"
          title={t("table.lastEdited", { time: exact(claim.updatedAt) })}
        >
          {t("table.edited")}
        </span>
      )}
    </>
  );
}

function RowActions({
  claim,
  editable,
  onEdit,
  onRelease,
  onUnlock,
}: {
  claim: Claim;
  editable: boolean;
  onEdit: () => void;
  onRelease: (c: Claim) => void;
  onUnlock: (c: Claim) => void;
}) {
  const { t } = useBoard();
  if (editable)
    return (
      <span className="inline-flex gap-1">
        <button onClick={onEdit} className="rounded px-2.5 py-1.5 text-muted hover:bg-hover hover:text-fg sm:px-2 sm:py-1">
          {t("table.edit")}
        </button>
        <button
          onClick={() => onRelease(claim)}
          className="rounded px-2.5 py-1.5 text-muted hover:bg-bad-bg hover:text-bad sm:px-2 sm:py-1"
        >
          {t("release")}
        </button>
      </span>
    );
  return (
    <button
      onClick={() => onUnlock(claim)}
      className="whitespace-nowrap rounded px-2.5 py-1.5 text-faint transition hover:bg-hover hover:text-fg sm:px-2 sm:py-1 sm:opacity-60 sm:group-hover:opacity-100"
    >
      {t("table.thisIsMe")}
    </button>
  );
}

function ClaimsList({ claims, all, rank, now, canEdit, flashIds, onEdit, onRelease, onUnlock, empty }: ListProps) {
  const { t } = useBoard();
  const [editing, setEditing] = useState<number | null>(null);

  if (!claims.length) return <p className="py-10 text-center text-sm text-faint">{empty}</p>;

  const editor = (c: Claim) => (
    <ClaimEditor
      claim={c}
      claims={all}
      onCancel={() => setEditing(null)}
      onSave={async (n, b) => {
        const err = await onEdit(c.id, n, b);
        if (!err) setEditing(null);
        return err;
      }}
    />
  );

  return (
    <>
      {/* Phones: stacked cards */}
      <ul className="sm:hidden">
        {claims.map((c) => (
          <li key={c.id} className={`border-b border-line py-3.5 ${flashIds.has(c.id) ? "flash" : ""}`}>
            {editing === c.id ? (
              editor(c)
            ) : (
              <div className="flex gap-3">
                <span className="w-5 shrink-0 pt-0.5 text-sm tabular-nums text-faint">{rank.get(c.id)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Avatar name={c.studentName} />
                    <span className="truncate font-medium">{c.studentName}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <BrandTag name={c.brandName} />
                    <DupBadge claim={c} />
                  </div>
                  <div className="mt-1.5 text-xs text-muted">{now && <ClaimedAt claim={c} />}</div>
                  <div className="-ms-2.5 mt-1 text-sm">
                    <RowActions
                      claim={c}
                      editable={canEdit(c)}
                      onEdit={() => setEditing(c.id)}
                      onRelease={onRelease}
                      onUnlock={onUnlock}
                    />
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Tablets and up: table */}
      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-line text-start text-muted">
            <th className="w-12 py-2 pe-3 ps-1 text-start font-normal">#</th>
            <th className="py-2 text-start font-normal">Aa {t("table.student")}</th>
            <th className="py-2 text-start font-normal">≡ {t("table.brand")}</th>
            <th className="py-2 text-start font-normal">◷ {t("table.claimed")}</th>
            <th className="w-40 py-2 pe-1" />
          </tr>
        </thead>
        <tbody>
          {claims.map((c) =>
            editing === c.id ? (
              <tr key={c.id} className="border-b border-line bg-soft">
                <td className="py-3 pe-3 ps-1 align-top tabular-nums text-faint">{rank.get(c.id)}</td>
                <td colSpan={4} className="py-3 pe-1">
                  {editor(c)}
                </td>
              </tr>
            ) : (
              <tr
                key={c.id}
                className={`group border-b border-line hover:bg-soft ${flashIds.has(c.id) ? "flash" : ""}`}
              >
                <td className="py-2.5 pe-3 ps-1 tabular-nums text-faint">{rank.get(c.id)}</td>
                <td className="py-2.5 pe-3">
                  <span className="flex items-center gap-2">
                    <Avatar name={c.studentName} />
                    <span className="truncate">{c.studentName}</span>
                  </span>
                </td>
                <td className="py-2.5 pe-3">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <BrandTag name={c.brandName} />
                    <DupBadge claim={c} />
                  </span>
                </td>
                <td className="whitespace-nowrap py-2.5 pe-3 text-muted">{now && <ClaimedAt claim={c} />}</td>
                <td className="py-1.5 pe-1 text-end">
                  <RowActions
                    claim={c}
                    editable={canEdit(c)}
                    onEdit={() => setEditing(c.id)}
                    onRelease={onRelease}
                    onUnlock={onUnlock}
                  />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </>
  );
}

/* ---------- activity log ---------- */

function ActivityLog({ events, now }: { events: ActivityEvent[]; now: number | null }) {
  const { t, relative, exact } = useBoard();
  if (!events.length) return <p className="py-10 text-center text-sm text-faint">{t("activity.none")}</p>;
  return (
    <ol className="relative ms-2 mt-4 border-s border-line">
      {events.map((e) => {
        const style = {
          claimed: { dot: "bg-ok", label: t("ev.claimed") },
          edited: { dot: "bg-[#d9a23b]", label: t("ev.edited") },
          released: { dot: "bg-bad", label: t("ev.released") },
        }[e.action];
        return (
          <li key={e.id} className="relative pb-5 ps-6">
            <span className={`absolute -start-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-bg ${style.dot}`} />
            <p className="leading-relaxed">
              <EventText e={e} />
            </p>
            <p className="mt-0.5 text-xs text-faint">
              {style.label}
              {now && (
                <>
                  {" · "}
                  <span title={exact(e.createdAt)}>{relative(e.createdAt, now)}</span>
                  <span className="hidden sm:inline">
                    {" · "}
                    <span className="tabular-nums">{exact(e.createdAt)}</span>
                  </span>
                </>
              )}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function EventText({ e }: { e: ActivityEvent }) {
  const { r } = useBoard();
  const name = (n: string) => <strong>{n}</strong>;

  if (e.action === "claimed")
    return <>{r("ev.claimedText", { name: name(e.studentName), brand: <BrandTag name={e.brandName} /> })}</>;
  if (e.action === "released")
    return <>{r("ev.releasedText", { name: name(e.studentName), brand: <BrandTag name={e.brandName} strike /> })}</>;

  const renamed = Boolean(e.prevStudentName && e.prevStudentName !== e.studentName);
  const rebranded = Boolean(e.prevBrandName && e.prevBrandName !== e.brandName);
  const from = <BrandTag name={e.prevBrandName ?? ""} strike />;
  const to = <BrandTag name={e.brandName} />;

  if (renamed && rebranded)
    return <>{r("ev.renamedSwitched", { old: name(e.prevStudentName!), new: name(e.studentName), from, to })}</>;
  if (renamed) return <>{r("ev.renamed", { old: name(e.prevStudentName!), new: name(e.studentName) })}</>;
  return <>{r("ev.switched", { name: name(e.studentName), from, to })}</>;
}

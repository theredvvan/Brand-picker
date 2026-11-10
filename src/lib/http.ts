import { NextResponse } from "next/server";
import { translate, type Lang, type MessageKey, type Vars } from "./i18n";

// Checked by tag rather than instanceof: bundling can load the error classes twice.
type AppError = Error & {
  kind?: string;
  field?: "brand" | "student";
  owner?: string;
  remaining?: number;
  minutes?: number;
};

export function fail(lang: Lang, status: number, key: MessageKey, vars?: Vars, extra?: object) {
  return NextResponse.json({ error: translate(lang, key, vars), ...extra }, { status });
}

/** Turns known errors into a translated JSON response. */
export function errorResponse(err: unknown, lang: Lang) {
  const e = err as AppError;
  switch (e?.kind) {
    case "conflict":
      return e.field === "brand"
        ? fail(lang, 409, "err.brandTaken", { name: e.owner ?? "" }, { field: "brand" })
        : fail(lang, 409, "err.studentHas", { name: e.owner ?? "" }, { field: "student" });
    case "not-allowed":
      return fail(lang, 403, "err.notAllowed");
    case "wrong-pin":
      return e.remaining && e.remaining > 0
        ? fail(lang, 403, "err.wrongPin", { n: e.remaining })
        : fail(lang, 403, "err.wrongPinLocked");
    case "locked":
      return fail(lang, 429, "err.locked", { n: e.minutes ?? 15 });
  }
  console.error(err);
  return fail(lang, 500, "err.server");
}

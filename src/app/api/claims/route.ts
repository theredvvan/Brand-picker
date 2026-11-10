import { NextResponse } from "next/server";
import { errorResponse, fail } from "@/lib/http";
import { langFromRequest } from "@/lib/i18n";
import { lookupLogoLater } from "@/lib/logo-job";
import { clean, validate } from "@/lib/normalize";
import { PIN_RE } from "@/lib/pin";
import { getStore, isAdmin } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const store = await getStore();
    const snap = await store.snapshot();
    return NextResponse.json(
      { ...snap, isAdmin: isAdmin(req.headers.get("x-admin-key")) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, langFromRequest(req.headers));
  }
}

export async function POST(req: Request) {
  const lang = langFromRequest(req.headers);
  try {
    const body = await req.json().catch(() => ({}));
    const studentName = clean(body.studentName);
    const brandName = clean(body.brandName);
    const pin = String(body.pin ?? "");
    const problem = validate(studentName, brandName);
    if (problem) return fail(lang, 400, problem.key, problem.vars);
    if (!PIN_RE.test(pin)) return fail(lang, 400, "v.pin");

    const store = await getStore();
    const result = await store.claim({ studentName, brandName, pin });
    lookupLogoLater(result.claim.id, result.claim.brandName);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err, lang);
  }
}

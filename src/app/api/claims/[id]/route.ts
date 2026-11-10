import { NextResponse } from "next/server";
import { errorResponse, fail } from "@/lib/http";
import { langFromRequest } from "@/lib/i18n";
import { lookupLogoLater } from "@/lib/logo-job";
import { clean, validate } from "@/lib/normalize";
import { getStore, isAdmin } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function auth(req: Request) {
  return {
    token: req.headers.get("x-edit-token") ?? undefined,
    admin: isAdmin(req.headers.get("x-admin-key")),
  };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const lang = langFromRequest(req.headers);
  try {
    const id = Number((await params).id);
    const body = await req.json().catch(() => ({}));
    const studentName = clean(body.studentName);
    const brandName = clean(body.brandName);
    const problem = validate(studentName, brandName);
    if (problem) return fail(lang, 400, problem.key, problem.vars);

    const store = await getStore();
    const { claim, brandChanged } = await store.edit(id, { studentName, brandName }, auth(req));
    if (brandChanged) lookupLogoLater(claim.id, claim.brandName);
    return NextResponse.json({ claim });
  } catch (err) {
    return errorResponse(err, lang);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const lang = langFromRequest(req.headers);
  try {
    const id = Number((await params).id);
    const store = await getStore();
    await store.release(id, auth(req));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, lang);
  }
}

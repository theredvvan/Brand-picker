import { NextResponse } from "next/server";
import { errorResponse, fail } from "@/lib/http";
import { langFromRequest } from "@/lib/i18n";
import { PIN_RE } from "@/lib/pin";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** "This is me": exchanges the right PIN for the pick's edit key, so this device can edit it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const lang = langFromRequest(req.headers);
  try {
    const id = Number((await params).id);
    const body = await req.json().catch(() => ({}));
    const pin = String(body.pin ?? "");
    if (!PIN_RE.test(pin)) return fail(lang, 400, "v.enterPin");

    const store = await getStore();
    const result = await store.unlock(id, pin);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, lang);
  }
}

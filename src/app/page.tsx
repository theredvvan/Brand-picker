import { headers } from "next/headers";
import BrandBoard from "@/components/BrandBoard";
import { langFromRequest } from "@/lib/i18n";
import { getStore } from "@/lib/store";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  // First paint in the device language (from Accept-Language); the browser refines it after load.
  const initialLang = langFromRequest(await headers());
  let initial: Snapshot = { claims: [], events: [] };
  let setupError: string | null = null;
  try {
    initial = await (await getStore()).snapshot();
  } catch (err) {
    setupError = err instanceof Error ? err.message : "Could not load data.";
  }
  return <BrandBoard initial={initial} setupError={setupError} initialLang={initialLang} />;
}

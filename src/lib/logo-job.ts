import { after } from "next/server";
import { findLogo } from "./logo";
import { getStore } from "./store";

/** Looks up the brand logo after the response is sent, so claiming stays instant. */
export function lookupLogoLater(id: number, brandName: string) {
  after(async () => {
    try {
      const logo = await findLogo(brandName);
      await (await getStore()).setLogo(id, brandName, logo);
    } catch (err) {
      console.warn("[logo] lookup failed:", err);
      await (await getStore()).setLogo(id, brandName, null).catch(() => {});
    }
  });
}

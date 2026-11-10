import type { LogoResult } from "./logo";
import type { Claim, Snapshot } from "./types";

export type ClaimInput = { studentName: string; brandName: string };

/** `token` is the secret handed to whoever claimed; `admin` bypasses it. */
export type Auth = { token?: string; admin?: boolean };

export interface Store {
  snapshot(): Promise<Snapshot>;
  claim(input: ClaimInput & { pin: string }): Promise<{ claim: Claim; token: string }>;
  /** Checks the PIN and returns the claim's edit token, so another device can edit it. */
  unlock(id: number, pin: string): Promise<{ claim: Claim; token: string }>;
  /** `brandChanged` tells the caller to look up a new logo. */
  edit(id: number, input: ClaimInput, auth: Auth): Promise<{ claim: Claim; brandChanged: boolean }>;
  release(id: number, auth: Auth): Promise<void>;
  /** Saves a logo lookup result, unless the brand was changed again in the meantime. */
  setLogo(id: number, brandName: string, logo: LogoResult | null): Promise<void>;
}

let store: Store | null = null;

export async function getStore(): Promise<Store> {
  if (store) return store;
  if (process.env.DATABASE_URL) {
    const { PostgresStore } = await import("./store-postgres");
    store = new PostgresStore(process.env.DATABASE_URL);
  } else if (process.env.NODE_ENV !== "production") {
    // Local development without a database: keep data in memory.
    const { MemoryStore } = await import("./store-memory");
    store = MemoryStore.shared();
  } else {
    throw new Error(
      "DATABASE_URL is not set. Connect a Neon database to this Vercel project.",
    );
  }
  return store;
}

export function isAdmin(headerValue: string | null): boolean {
  const key = process.env.ADMIN_KEY;
  return Boolean(key && headerValue && headerValue === key);
}

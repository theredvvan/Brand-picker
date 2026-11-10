import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const PIN_RE = /^\d{4}$/;
/** Wrong tries allowed before the pick is locked. */
export const MAX_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

/** Stores PINs as "salt:hash" (scrypt) so they can't be read back from the database. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !PIN_RE.test(pin)) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pin, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

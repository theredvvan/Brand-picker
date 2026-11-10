import type { MessageKey, Vars } from "./i18n";

/**
 * Turns a name into a comparison key so that "Coca-Cola", "coca cola" and
 * "COCA COLA" all count as the same brand. Accents, spaces and punctuation
 * are ignored.
 */
export function toKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Trims and collapses whitespace for display. */
export function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export const MAX_LEN = 60;

export type Problem = { key: MessageKey; vars?: Vars };

export function validate(studentName: string, brandName: string): Problem | null {
  if (!studentName) return { key: "v.name" };
  if (!brandName) return { key: "v.brand" };
  if (studentName.length > MAX_LEN || brandName.length > MAX_LEN)
    return { key: "v.tooLong", vars: { n: MAX_LEN } };
  if (!toKey(studentName)) return { key: "v.nameChars" };
  if (!toKey(brandName)) return { key: "v.brandChars" };
  return null;
}

/** Edit distance between two keys (for spotting typos like "addidas" vs "adidas"). */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** True when two brand keys are probably the same brand typed differently. */
export function looksLikeTypo(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3 || a === b) return false;
  const max = Math.max(a.length, b.length) <= 5 ? 1 : 2;
  return distance(a, b) <= max;
}

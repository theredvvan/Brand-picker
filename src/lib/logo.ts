import { toKey } from "./normalize";

/**
 * Finds a logo for a brand:
 *  1. Ask Groq (gpt-oss with built-in web search) for the brand's official website.
 *  2. Check that a logo actually exists for that domain before saving it.
 * Without GROQ_API_KEY it falls back to guessing "<brand>.com".
 */

export type LogoResult = { domain: string; url: string };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DOMAIN_RE = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b/gi;

const SYSTEM_PROMPT = `You find the official website of a company or brand, so its logo can be shown.
Search the web if you are not certain.
Reply with ONLY the bare domain of the brand's main official website, for example: nike.com
No sentences, no URL scheme, no explanation. If you cannot identify the brand, reply: NONE`;

export const logoUrlFor = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

function extractDomains(text: string): string[] {
  if (/^\s*NONE\b/i.test(text)) return [];
  const found = [...text.matchAll(DOMAIN_RE)].map((m) => m[1].toLowerCase().replace(/^www\./, ""));
  return [...new Set(found)].slice(0, 3);
}

async function askGroq(brandName: string, model: string, webSearch: boolean): Promise<string[]> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      reasoning_effort: "low",
      // Groq's built-in web search, available on the gpt-oss models.
      ...(webSearch ? { tools: [{ type: "browser_search" }] } : {}),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Brand: ${brandName}` },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    console.warn(`[logo] Groq ${model} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const json = await res.json();
  return extractDomains(String(json?.choices?.[0]?.message?.content ?? ""));
}

/**
 * "yes" when Google's favicon service has a real icon for the domain (it returns 404 otherwise),
 * "unknown" when the check itself timed out or failed.
 */
async function hasLogo(domain: string): Promise<"yes" | "no" | "unknown"> {
  try {
    const res = await fetch(logoUrlFor(domain), { signal: AbortSignal.timeout(10_000) });
    return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/") ? "yes" : "no";
  } catch {
    return "unknown";
  }
}

export async function findLogo(brandName: string): Promise<LogoResult | null> {
  let candidates: string[] = [];

  if (process.env.GROQ_API_KEY) {
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
    const attempts: [string, boolean][] = [
      [model, true],
      ["openai/gpt-oss-120b", true],
      [model, false],
    ];
    for (const [m, search] of attempts) {
      try {
        candidates = await askGroq(brandName, m, search);
      } catch (err) {
        console.warn(`[logo] Groq ${m} failed:`, err);
      }
      if (candidates.length) break;
    }
  } else {
    const key = toKey(brandName);
    if (key) candidates = [`${key}.com`];
  }

  let unverified: string | null = null;
  for (const domain of candidates) {
    const check = await hasLogo(domain);
    if (check === "yes") return { domain, url: logoUrlFor(domain) };
    if (check === "unknown") unverified ??= domain;
  }
  // Couldn't verify (slow network): keep the domain; the page falls back to the initial if it fails to load.
  return unverified ? { domain: unverified, url: logoUrlFor(unverified) } : null;
}

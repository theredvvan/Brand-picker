# Brand Picker

A small web app for the marketing exam: each student claims one brand to study, and no two students can take the same brand. First come, first served.

## Features

- **Claim a brand**: name, brand and a 4-digit PIN. A "Done!" popup confirms it, with your place in line.
- **Duplicate detection**
  - Exact duplicates are blocked: brand names are compared ignoring case, spaces, accents and punctuation ("Coca-Cola" = "coca cola"). The database enforces it, so two people clicking at the same second can't both get it.
  - Typos are caught while typing: "Addidas" → "Did you mean Adidas? It's already taken by …".
  - Same company under another name ("Coke" vs "Coca-Cola") is flagged once the brand's website is found.
- **Brand logos**: after a claim, Groq (`openai/gpt-oss-20b` with web search) finds the brand's official website, and its logo is shown in the brand pill.
- **Who was first**: every row has its rank (#1, #2…) and the exact time it was claimed, to the second.
- **Activity log**: every claim, change and release, with the time and the old and new values.
- **Editing your own pick**: from the browser you claimed with (it keeps a private key), or from any other device with "This is me" + your PIN. 5 wrong PINs lock the pick for 15 minutes. PINs are stored hashed.
- **Admin mode** (optional): with the `ADMIN_KEY` passphrase, the class rep can fix or remove any entry.
- **Languages**: English, French, Arabic (right-to-left) and Spanish. The page follows the device language; a switcher in the footer overrides it.
- **Mobile first**: card list and bottom-sheet popups on phones, table on larger screens. Light and dark mode.
- **Export CSV** for the teacher. Live: the page refreshes every few seconds.

## Run locally

```bash
npm install
npm run dev
```

Create `.env.local` with `GROQ_API_KEY=...` for logos. Without `DATABASE_URL`, local development keeps data in memory (it resets when the server restarts).

## Deploy on Vercel

1. Import this repository at https://vercel.com/new.
2. In the Vercel project, open **Storage → Create Database → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL` for you.
3. Under **Settings → Environment Variables**, add `GROQ_API_KEY` (for brand logos).
   Optional: add `ADMIN_KEY` with a passphrase only the class rep knows.
4. Redeploy. The tables are created automatically on first visit.

## Stack

Next.js (App Router) · Tailwind CSS · Neon Postgres via `@neondatabase/serverless` · Groq API.

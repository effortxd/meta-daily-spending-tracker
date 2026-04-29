# Meta Spend Dashboard — Vercel Deployment

A shared dashboard for tracking daily Meta ad spend, leads, and deposits — deployable to Vercel with shared data via Supabase.

## What you're getting

- A Next.js 14 app (deploys natively on Vercel)
- Supabase as the shared database (free tier covers this easily)
- Server-side API route for Anthropic vision (keeps your API key safe)
- Same dashboard UI as the artifact

## What's different from the artifact version

| Artifact (Claude) | Vercel version |
|---|---|
| `window.storage` | Supabase Postgres |
| Anthropic API called from browser | Anthropic API called from `/api/extract-image` (server-side) |
| Single artifact link to share | Public URL (`https://your-app.vercel.app`) |

---

## Setup walkthrough (~15 minutes)

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free).
2. Click **New Project**. Pick a name, set a strong database password (save it somewhere), pick a region close to you.
3. Wait ~2 minutes for it to provision.
4. Once it's ready, go to **SQL Editor** in the left sidebar.
5. Open the file `supabase/schema.sql` from this project, copy its contents, paste into the SQL Editor, and click **Run**. This creates the `entries`, `deposits`, and `config` tables.
6. Go to **Project Settings** → **API**. You'll need two values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public key** (a long string starting with `eyJ...`)

   Keep this tab open — you'll paste these into Vercel later.

### Step 2 — Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com).
2. Create an account, add billing (vision API isn't free, but extracting a screenshot costs roughly $0.01–$0.03 per image).
3. Go to **API Keys** → **Create Key**. Copy the key (starts with `sk-ant-...`). Save it.

### Step 3 — Push this project to GitHub

1. Create a new GitHub repository (private if you want).
2. From your terminal, in this project's folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

### Step 4 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com), sign up with GitHub.
2. Click **Add New** → **Project**.
3. Import your GitHub repo.
4. Before clicking Deploy, expand **Environment Variables** and add these three:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL from Step 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon public key from Step 1 |
   | `ANTHROPIC_API_KEY` | Your Anthropic API key from Step 2 |

   The `ANTHROPIC_API_KEY` does NOT have the `NEXT_PUBLIC_` prefix on purpose — that keeps it server-only.

5. Click **Deploy**. After ~1 minute you'll get a URL like `https://your-app.vercel.app`.

### Step 5 — First-run setup

1. Open your Vercel URL.
2. Click **Admin** in the top right.
3. Set an admin passcode (4+ characters). This passcode protects the input forms — anyone without it can only view, not edit.
4. Start adding data, or use **Bulk Import** to paste/upload your historical numbers.
5. Share the URL with your bosses. They'll see the dashboard read-only.

---

## Local development (optional)

If you want to test locally before deploying:

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local and fill in your Supabase URL, anon key, and Anthropic key
npm run dev
```

Then open `http://localhost:3000`.

---

## Costs

- **Vercel** — free tier (Hobby plan) is plenty for this.
- **Supabase** — free tier gives you 500MB database, more than enough for years of daily entries.
- **Anthropic** — only used when you upload a screenshot for AI extraction. Roughly $0.01–$0.03 per screenshot. Skip the screenshot import and you'll pay $0.

---

## Security notes

- The admin passcode is **stored as plaintext** in Supabase (in the `config` table). It's a soft-lock to prevent accidental edits, not a real auth system. Don't use a password you reuse elsewhere.
- The Supabase **anon key** is exposed to the browser by design — that's how Supabase clients work. Real security comes from Row Level Security (RLS) policies. The included schema enables RLS but allows public read/write on these tables (matches the artifact's "anyone with the link can edit" behavior with passcode soft-lock on top). If you want stricter access control, see the **"Tighter security"** section below.
- The **Anthropic API key** stays on the server and is never sent to the browser.

---

## Tighter security (optional)

If you want bosses to only ever view (never edit) at the database level, you can:

1. Lock down Supabase RLS so only authenticated requests can write.
2. Use Supabase Auth (email/password or magic link) for admin login instead of the soft passcode.

This is more work — happy to walk you through it if you want, just ask.

---

## Troubleshooting

- **"Supabase connection failed"** — Re-check your `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars. They need to match your Supabase project exactly.
- **Screenshot extraction fails** — Check that `ANTHROPIC_API_KEY` is set in Vercel (Project Settings → Environment Variables). Redeploy after adding it.
- **Deploy fails on Vercel** — Check the build logs. Most common cause is a missing dependency. Try `npm install` locally first to make sure it builds.
- **Data not syncing between you and bosses** — Hit the refresh button (top right). Data persists on save, but the dashboard doesn't poll the database every second; refresh to pull latest.

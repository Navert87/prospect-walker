# Prospect Walker

Mobile-first prospecting tool for Hypandra Consulting. Auto-discovers neighborhoods, scouts businesses with weak web presence, generates talking points, and builds walking routes.

## ⚠️ Important: This is a SEPARATE project from SellSequence

This project has its own repo, its own Vercel deployment, and its own Supabase table. **Do not** put these files inside your SellSequence project folder. Keep them completely separate:

```
~/projects/
├── sellsequence/        ← SellSequence lives here. Don't touch it.
└── prospect-walker/     ← This project lives here. Totally separate.
```

You CAN use the same Supabase project (same dashboard, same URL, same anon key) because the table name (`prospect_data`) won't conflict with anything in SellSequence. But the code repos and Vercel deployments must be separate.

---

## Setup

### 1. Create a NEW GitHub Repo

Create a new repo called `prospect-walker` (or whatever you want). Do NOT add this to the SellSequence repo.

```bash
mkdir prospect-walker
cd prospect-walker
# unzip the downloaded files here, or copy them in
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:YOUR_USERNAME/prospect-walker.git
git push -u origin main
```

### 2. Supabase Table

You can use your **existing SellSequence Supabase project** — just add a new table. This is safe because the table name `prospect_data` is unique and won't conflict with SellSequence tables.

Run this in your Supabase SQL editor:

```sql
create table prospect_data (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table prospect_data enable row level security;

create policy "Allow all access" on prospect_data
  for all using (true) with check (true);
```

### 3. Create a NEW Vercel Project

In Vercel, import the `prospect-walker` repo as a **new project** — do NOT add it to your SellSequence Vercel project.

Add these environment variables in Vercel → Settings → Environment Variables:

| Key | Value | Notes |
|-----|-------|-------|
| `VITE_SUPABASE_URL` | `https://your-project.supabase.co` | Same as SellSequence is fine |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key | Same as SellSequence is fine |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Your Anthropic API key (server-side only) |

Deploy.

### 4. Use on Phone

Open your Vercel URL on your phone → Share → Add to Home Screen.

---

## How It Works

1. **Add a city** → Claude finds 15-25 neighborhoods with small businesses
2. **Pick neighborhoods** → Select which areas to prospect
3. **Scout Weak Presence** → Claude searches the web for real businesses with poor/weak web presence, generates issues and talking points for your pitch
4. **Walk Route** → Opens Google Maps with walking directions to unvisited businesses
5. **Track visits** → Mark status, add contact info, write visit notes, flag interested leads
6. **Scout again** → Hit scout multiple times to find more businesses (duplicates are auto-skipped)

Data syncs across devices (phone + laptop) via Supabase.

## Features

- **Auto neighborhoods**: Enter a city, get 15-25 prospectable neighborhoods
- **Weak presence scouting**: AI + web search finds businesses with poor web/digital presence
- **Talking points**: Auto-generated pitch ideas based on each business's specific issues
- **Contact tracking**: Save the name/role/phone of whoever you talk to
- **Status system**: Not Visited, Visited, Interested, Go Back, Not Interested
- **Walking routes**: Google Maps links with turn-by-turn walking directions
- **Deduplication**: Scout as many times as you want without getting doubles
- **Cross-device sync**: Supabase keeps phone and laptop in sync

## Updating

Since this is on Vercel, updates are just:

```bash
git add .
git commit -m "description of change"
git push
```

Vercel auto-deploys. No republishing artifacts, no hassle.

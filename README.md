# Trip Ready

Web-first app for **group trip readiness**: drop booking confirmations, extract the essentials, check documents/luggage per person, and work out when to leave home for the airport.

## Run it

```bash
cd C:\Users\brand\Projects\trip-ready
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## AI extraction (recommended)

Without a key, the app uses the local heuristic parser.

1. Copy `.env.example` to `.env.local`
2. Set `OPENAI_API_KEY=sk-...`
3. Restart `npm run dev`

## Cloud sync (Supabase) — shared trip + traveller logins

Without Supabase keys the app still works with **browser localStorage** only.

To go live / share across phones:

1. Create a project at [supabase.com](https://supabase.com)
2. **SQL editor** → paste and run `supabase/schema.sql`
3. **SQL editor** → also run `supabase/ticket-storage.sql` (boarding-pass wallet files)
4. **Authentication → Providers** → enable **Email** (magic link)
5. **Authentication → URL configuration** → add redirects:
   - `http://localhost:3000/**`
   - `http://localhost:3000/join`
   - `https://YOUR-SITE.netlify.app/**`
   - `https://YOUR-SITE.netlify.app/join`
6. Optional but recommended: **Database → Replication** → enable Realtime for table `trips`
7. In `.env.local` (and Netlify env):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_APP_URL=https://YOUR-SITE.netlify.app
```

8. Restart `npm run dev`
9. Open **Account & sync** (hub menu or top-right avatar):
   - Owner: magic-link sign-in → **Upload this trip & get invite code** → **Copy invite message** (WhatsApp/email)
   - Travellers: open the shared `/join?code=…` link → email sign-in → pick **I am** → open their checklist

Invite links always use `NEXT_PUBLIC_APP_URL` (or the live Netlify site) so copying from localhost still works for phones.
Edits sync to the shared trip (local cache kept as backup). Realtime updates other open devices when enabled.

## What works now

- Responsive web UI (desktop + phone)
- Drag/drop or paste (`.pdf`, `.txt`, `.eml`)
- AI extract when configured; local fallback otherwise
- Leave-home timeline (multi-stop map + pick-ups)
- Group readiness matrix + per-traveller packing
- **Wallet** — upload boarding passes (PDF/photo); travellers open full-screen on their phone
- localStorage always; Supabase when configured

## Later

- OCR for scanned/image-only PDFs
- Day-trip / on-location bookings page
- Stricter per-traveller write rules (checklist-only for travellers)
- Live traffic when `GOOGLE_MAPS_API_KEY` is set

## Stack

- Next.js (App Router) + TypeScript
- OpenAI Chat Completions (optional)
- Supabase Auth + Postgres (optional cloud)
- localStorage cache

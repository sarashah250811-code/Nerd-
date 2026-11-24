# Setup

Roughly 15 minutes. You need a free Supabase account, and your existing Netlify site.

## 1. Create the Supabase project

1. Go to <https://supabase.com> → **New project**. Pick a region near you and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of `supabase/migrations/0001_schema.sql`, and press **Run**. It is safe to run twice.
3. Check **Table Editor**: you should see `profiles`, `user_preferences`, `timer_settings`, `subjects`, `tasks`, `goals`, `study_sessions`, `reflections`, each showing **RLS enabled**.

Using the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`.

## 2. Configure authentication

**Authentication → Providers → Email**: enable it (it is on by default).

**Authentication → URL Configuration**
- **Site URL:** your live address, e.g. `https://nerdorabitchwhowantstogrow.netlify.app`
- **Redirect URLs:** add the same address, plus `http://localhost:5173` for local development.

These must be exact. Password-reset and confirmation links return the user to the Site URL, and the app reads the recovery token from there.

**Authentication → Providers → Email → Confirm email**
- **On (recommended for a public site):** new users must click a link before signing in. The app shows "check your inbox" after sign-up.
- **Off:** quicker for testing; users are signed in immediately.

Supabase's built-in email sender is rate-limited (a few emails per hour). For real use, add your own SMTP under **Authentication → SMTP Settings**.

**Optional but sensible:** Authentication → Policies → raise the minimum password length to 8 or more (the app already requires 8 on the change-password form).

## 3. Get the two keys

**Project Settings → API**
- **Project URL** → `VITE_SUPABASE_URL`
- **anon / publishable key** → `VITE_SUPABASE_ANON_KEY`

> Use the anon key only. **Never** put the `service_role` key in this project, in Netlify, or anywhere in the browser. The anon key is designed to be public; Row Level Security is what keeps data private. Account deletion needs no service key because it runs as a `security definer` database function (`delete_my_account`).

## 4. Run locally

```bash
npm install
cp .env.example .env.local     # paste the two values
npm run dev                    # http://localhost:5173
```

Without both values, the app shows a "Setup required" screen rather than a fake offline mode.

## 5. Deploy to Netlify (your existing project)

1. Put this folder in a Git repository (GitHub, GitLab or Bitbucket) and push it.
2. In Netlify, open your existing site → **Site configuration → Build & deploy → Continuous deployment → Link repository** and choose the repo. (Or create a new site from the repo and move your domain later.)
3. Build settings are read from `netlify.toml`: command `npm run build`, publish directory `dist`.
4. **Site configuration → Environment variables:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. They are read at build time, so **trigger a redeploy** after adding them.
5. Confirm the live URL matches the **Site URL** from step 2.

No Netlify CLI is needed, but drag-and-drop works too: run `npm run build` locally (with `.env.local` filled in) and drop `dist/` onto the site's *Deploys* page.

## 6. Moving your existing data

The previous version stored everything in the browser's local storage on the old site address. If you deploy this version to the **same Netlify address**, then the first time you sign in on a browser that used the old version, a banner appears: *"Study data found in this browser"*. It offers, in order:

1. **Download a backup first**: saves the raw old data as a file.
2. **Move into my account**: copies subjects, tasks and study logs into your account, then checks the cloud really has every record before saying it worked. Existing cloud data is never overwritten, and running it twice does not create duplicates.
3. **Not now**: dismisses it; your old browser data is never deleted either way.

Notes:
- Detection is tolerant: it scans for saved data containing subjects, tasks or session logs and maps common field names. The old file's exact format was not available, so **check the result** after migrating and keep the backup file until you have.
- If you deploy to a **different address**, the old data stays behind in the old browser origin. Open the old site, use its backup/export feature, then import that file under *Settings → Your data*, or keep the old site up until you have migrated.
- Moving between devices after migration needs nothing special: sign in and the cloud data loads.

Importing a Nerd backup file (*Settings → Your data → Import*) validates it, skips records you already have, and never overwrites.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Setup required" screen | The two `VITE_` variables are missing, or the site was not redeployed after adding them |
| Sign-up works but no email arrives | Built-in sender rate limit; check spam; add SMTP |
| Reset link lands on the wrong site | **Site URL** / **Redirect URLs** do not match |
| Sync error, "permission denied" or "relation does not exist" | The migration was not run (or not fully) in this project |
| Blank page after deploy | Env vars missing at build time; check the Netlify build log |

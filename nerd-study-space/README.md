# Nerd — Your Study Space

A personal study workspace: tasks, subjects, goals, a Pomodoro timer, analytics, a calendar and reflections, with accounts and cloud sync across devices. Six themes.

**Stack:** React 18 + TypeScript + Vite · plain CSS with design tokens (no runtime CSS library) · Supabase (Postgres, Auth, Row Level Security) · Netlify.

> **Status.** The code is complete, but it has only been checked offline: the pure logic has automated tests (`npm test`) and the theme contrast is verified. It has **not** been run against a real Supabase project, so cloud sync, sign-in, RLS and the multi-device flow are unverified until you work through [TESTING.md](TESTING.md). Nothing here pretends sync works before the backend is configured: without the two environment variables the app shows a setup screen instead of a fake mode.

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in your Supabase URL + anon key
npm run dev
```

Full backend setup: [SETUP.md](SETUP.md). Verification checklist: [TESTING.md](TESTING.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm test` | WCAG contrast check for all six themes + logic tests (dates/timezones, analytics, goal progress, backup import/dedupe) |

## Project structure

```
supabase/migrations/0001_schema.sql   tables, RLS, Nerd ID, conflict guards, delete_my_account()
src/
  auth/        AuthProvider (Supabase Auth), sign-in / sign-up / recovery screens
  sync/        engine.ts: local cache, write queue, retry, conflict handling, realtime + polling
  data/        DataProvider (state for the UI), actions.ts (typed writes)
  timer/       TimerProvider: timestamp-based timer that survives navigation and refresh
  views/       Dashboard, Tasks, Timer, Goals, Subjects, Analytics, Calendar, Reflections, Settings
  components/  ui primitives, charts (SVG), icons, legacy-data migration prompt
  lib/         dates (timezone-safe day keys), analytics, backup/import, themes, types
  styles/      themes.css (the six palettes) and app.css
scripts/       check-contrast.ts, test-logic.ts
```

## How the important parts work

**Identity.** `auth.users.id` (a UUID) is the real identity. At sign-up a database trigger creates a profile with a readable, permanent Nerd ID (`NERD-XXXX-XXXX`). A second trigger blocks any attempt to change it, and the column grant only lets users edit their display name. The ID is a label: every row is protected by Row Level Security on `auth.uid()`, so knowing someone's Nerd ID gives no access to anything.

**Sync.** Every change is written to a local cache first, then pushed to Supabase. Rows have client-generated UUIDs (so retries cannot duplicate) and a `client_updated_at` clock. The database rejects stale writes instead of overwriting newer data, and the app then re-pulls the newer version and keeps the losing edit under *Settings → Sync → Edits kept after a conflict* so nothing is silently lost. Deletes are soft so they reach other devices. Status shows as Synced, Saving, Offline or Sync error. Failed writes stay on the device until you retry or discard them.

**Timer.** Stores a start timestamp, not a counter, so it is correct after switching tabs, navigating, or refreshing. Only a completed focus run is recorded; abandoned timers and breaks never count as study time.

**Dates.** A "day" is a calendar day in the timezone set in Settings (default: the browser's). All grouping uses `YYYY-MM-DD` keys, with day arithmetic done in UTC on the key so daylight-saving changes cannot shift anything.

**Themes.** Warm Parchment, Light, Midnight, Star, Dark and Starry Evening are CSS variable sets in `src/styles/themes.css`. The choice is saved to your account. `npm test` fails if any theme drops below WCAG AA contrast.

## Design choices worth knowing

- Plain CSS variables instead of Tailwind. The spec allowed "a similarly maintainable styling system", and a variable-per-theme setup keeps the six themes in one file with no build-time dependency.
- Hash routing (`#/tasks`), so deep links and refreshes work on Netlify with no server config.
- No social features, friends, public profiles or study rooms, as specified.
- Email change is not supported in this version.

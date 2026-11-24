# Testing

## Automated (no network, no Supabase)

```bash
npm test
```

Covers: WCAG AA contrast for every text/background pair in all six themes; timezone-correct day keys, DST-safe date arithmetic, week/month boundaries; what counts as study time (completed focus/manual only; breaks, abandoned and deleted sessions excluded); streaks; week-over-week comparison; goal progress for every metric; backup export → import round trip; import validation (bad rows dropped, dangling references cleared, values clamped); importing the same file twice yields identical ids, so no duplicates; legacy-data mapping.

`npm run build` also typechecks the whole app.

## Manual: needs a real Supabase project

These cannot be verified without a configured backend. Do them in order after [SETUP.md](SETUP.md). Use two different browsers (or one normal and one private window) as "device A" and "device B". Create two accounts, **Alice** and **Bob**, for the isolation test.

| # | Check | Pass when |
|---|---|---|
| 1 | **Register.** Sign up as Alice. | A Nerd ID like `NERD-1A2B-3C4D` shows in *Settings → Profile*. |
| 2 | **Second device.** Sign in as Alice on device B. | Same Nerd ID. |
| 3 | **Data appears.** On A add two subjects and a task; reload B. | They appear on B (live within seconds, or after a refresh at worst). |
| 4 | **Two-way.** Create a task on B. | It appears on A. |
| 5 | **Timer → analytics.** Set focus to 1 minute in *Settings → Study & timer*, run it to the end on A. | A session shows on the Dashboard, Calendar and Analytics (and on B). Then start another timer and reset it halfway: nothing new is recorded. |
| 6 | **Theme persists.** Choose Midnight on A, sign out, sign in on B. | B shows Midnight. Try all six; none should alter your data. |
| 7 | **Refresh.** Reload mid-timer and mid-edit. | Timer continues at the right time; no data lost. |
| 8 | **Offline.** In DevTools → Network set *Offline*, add a task and edit another. Badge shows *Offline*. Reload (still offline), then go back online. | Both changes are still there after reload and upload on reconnect; badge returns to *Synced*. |
| 9 | **Isolation (RLS).** Sign in as Bob, copy his access token (DevTools → Application → Local Storage → the `sb-…-auth-token` entry), then call the REST API with it and your anon key: `GET <project-url>/rest/v1/tasks?user_id=eq.<Alice's uuid>`. | Returns `[]`. Updating or deleting one of Alice's rows by id affects 0 rows. Inserting a row with Alice's `user_id` is rejected. Knowing Alice's Nerd ID gives nothing. |
| 10 | **Nerd ID is immutable.** With Bob's token, `PATCH /rest/v1/profiles?id=eq.<bob uuid>` with `{"nerd_id":"NERD-0000-0000"}`. | Rejected (permission denied). |
| 11 | **Conflict.** Put device B offline, edit task X's title on B; edit the same task's title on A (later). Bring B online. | A's newer edit wins everywhere; B's version appears in *Settings → Sync → Edits kept after a conflict* with a Restore button. Nothing silently lost. |
| 12 | **Forms and buttons.** Tasks (add, edit, delete, complete, reopen, filter, sort), subjects, goals (all periods, manual +/−, complete, history), reflections (add, edit, delete, search, jump to date), calendar (month nav, select a day), timer (start, pause, resume, reset, skip, focus mode, subject), settings (every tab). | Each works and persists after refresh. |
| 13 | **Themes × screens.** Visit every page in every theme at desktop and phone widths. | Readable, nothing clipped, bottom nav usable on phone. |
| 14 | **Failure handling.** Stop the project (Supabase → Project Settings → Pause) or block the host in DevTools, then make edits. | Badge shows *Offline* or *Sync error*; edits are kept; after restore they upload. A rejected write appears under *Settings → Sync* with Discard / Retry. |
| 15 | **Export / import.** Download a backup, delete a task, import the file. | The task returns; importing again adds nothing. Invalid JSON and non-Nerd files show a clear error. |
| 16 | **Password.** Change password; then sign out and use *Forgot password*. | Both work; the reset email link returns to the app and prompts for a new password. |
| 17 | **Delete account.** Use a throwaway account. | Requires the password and typing DELETE; afterwards you are signed out, cannot sign in, and the rows are gone from Table Editor. |

Things most worth watching on the first real run, because they depend on live Supabase behaviour that could not be exercised offline: realtime updates between devices, the stale-write guard path in check 11, editing your display name under the column-level grants (profile updates are restricted to `display_name`), and the email redirect flow in check 16.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { SUBJECT_COLORS } from '../data/actions';
import { cacheKey } from '../sync/engine';
import { THEMES } from '../lib/themes';
import { buildBackup, downloadJson, parseBackup, type ImportResult } from '../lib/backup';
import { COLLECTION_ORDER, type Subject } from '../lib/types';
import { clamp, formatMinutes, plural } from '../lib/format';
import { Icon } from '../components/Icon';
import { EmptyState, Field, Modal, PageHead, useConfirm } from '../components/ui';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'study', label: 'Study & timer' },
  { id: 'subjects', label: 'Subjects' },
  { id: 'security', label: 'Security' },
  { id: 'sync', label: 'Sync' },
  { id: 'data', label: 'Your data' },
];

export function Settings({ tab, onSignOut }: { tab?: string; onSignOut: () => Promise<boolean> | void }) {
  const current = TABS.some((t) => t.id === tab) ? (tab as string) : 'profile';
  return (
    <>
      <PageHead title="Settings" sub="Everything here is saved to your account and follows you to every device." />
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <a key={t.id} role="tab" aria-selected={current === t.id} className="tab" href={`#/settings/${t.id}`} style={{ textDecoration: 'none' }}>{t.label}</a>
        ))}
      </div>
      {current === 'profile' && <ProfileTab onSignOut={onSignOut} />}
      {current === 'appearance' && <AppearanceTab />}
      {current === 'study' && <StudyTab />}
      {current === 'subjects' && <SubjectsTab />}
      {current === 'security' && <SecurityTab />}
      {current === 'sync' && <SyncTab />}
      {current === 'data' && <DataTab />}
    </>
  );
}

/* ------------------------------------------------------------------ */
function ProfileTab({ onSignOut }: { onSignOut: () => Promise<boolean> | void }) {
  const { profile, email, setDisplayName } = useData();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setName(profile?.display_name ?? ''), [profile?.display_name]);

  const copy = async () => {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(profile.nerd_id);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2500);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    setDisplayName(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="grid cols-2">
      <section className="card" aria-labelledby="st-profile">
        <h2 id="st-profile">Profile</h2>
        <p className="card-sub">Only you can see this.</p>
        <form onSubmit={save} className="stack">
          <Field label="Display name">{(id) => <input id={id} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Email" hint="Used to sign in. Changing the email address is not supported in this version.">{(id) => <input id={id} className="input" value={email} readOnly />}</Field>
          <div className="row">
            <button className="btn primary" type="submit" disabled={!name.trim() || name.trim() === profile?.display_name}>Save name</button>
            {saved && <span role="status" className="small muted">Saved</span>}
          </div>
        </form>
      </section>

      <section className="card" aria-labelledby="st-id">
        <h2 id="st-id">Your Nerd ID</h2>
        <p className="card-sub">Permanent. It never changes, on any device. It is a label, not a password: knowing it gives nobody access to your data.</p>
        <div className="row wrap">
          <code className="chip num" style={{ fontSize: '1.05rem', padding: '6px 14px' }} aria-label="Nerd ID">{profile?.nerd_id ?? 'Loading…'}</code>
          <button className="btn" onClick={() => void copy()} disabled={!profile}><Icon name="copy" /> Copy ID</button>
          <span role="status" className="small muted">{copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed. Select the ID and copy it manually.' : ''}</span>
        </div>
        <hr className="divider" />
        <button className="btn" onClick={() => void onSignOut()}><Icon name="logout" /> Sign out</button>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function AppearanceTab() {
  const { prefs, setTheme, updatePrefs } = useData();
  const onKey = (e: React.KeyboardEvent) => {
    const i = THEMES.findIndex((t) => t.id === prefs.theme);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setTheme(THEMES[(i + 1) % THEMES.length].id);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setTheme(THEMES[(i - 1 + THEMES.length) % THEMES.length].id);
    else return;
    e.preventDefault();
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="st-theme">
        <h2 id="st-theme">Theme</h2>
        <p className="card-sub">Saved to your account, so it follows you to other devices. Changing it never touches your study data.</p>
        <div className="theme-grid" role="radiogroup" aria-label="Theme" onKeyDown={onKey}>
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={prefs.theme === t.id} tabIndex={prefs.theme === t.id ? 0 : -1} className="theme-card" onClick={() => setTheme(t.id)}>
              <div data-theme={t.id}>
                <div className="theme-preview" aria-hidden="true">
                  <div className="p-side" />
                  <div className="p-main">
                    <div className="p-card">Nerd</div>
                    <div className="p-bar" />
                    <div className="p-btn">Start</div>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <b>{t.name}</b> {prefs.theme === t.id && <span className="chip">Selected</span>}
                <div className="small muted">{t.blurb}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="card" aria-labelledby="st-week">
        <h2 id="st-week">Calendar</h2>
        <Field label="Week starts on">{(id) => (
          <select id={id} className="input" style={{ maxWidth: 220 }} value={prefs.week_starts_on} onChange={(e) => updatePrefs({ week_starts_on: Number(e.target.value) })}>
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
            <option value={6}>Saturday</option>
          </select>
        )}</Field>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const numOr = (v: string, lo: number, hi: number): number | null => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : null;
};

function StudyTab() {
  const { prefs, timer, updatePrefs, updateTimer, tz } = useData();
  const [target, setTarget] = useState(String(prefs.daily_target_minutes));
  const [focus, setFocus] = useState(String(timer.focus_minutes));
  const [short, setShort] = useState(String(timer.short_break_minutes));
  const [long, setLong] = useState(String(timer.long_break_minutes));
  const [every, setEvery] = useState(String(timer.sessions_until_long_break));
  const [msg, setMsg] = useState<string | null>(null);
  const [notifMsg, setNotifMsg] = useState<string | null>(null);

  // Pull in changes made on another device.
  useEffect(() => setTarget(String(prefs.daily_target_minutes)), [prefs.daily_target_minutes]);
  useEffect(() => {
    setFocus(String(timer.focus_minutes));
    setShort(String(timer.short_break_minutes));
    setLong(String(timer.long_break_minutes));
    setEvery(String(timer.sessions_until_long_break));
  }, [timer.focus_minutes, timer.short_break_minutes, timer.long_break_minutes, timer.sessions_until_long_break]);

  const zones = useMemo(() => {
    const list: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [];
    return list.includes(tz) ? list : [tz, ...list];
  }, [tz]);

  const saveStudy = (e: FormEvent) => {
    e.preventDefault();
    const t = numOr(target, 0, 1440);
    const f = numOr(focus, 1, 180);
    const s = numOr(short, 1, 60);
    const l = numOr(long, 1, 120);
    const n = numOr(every, 2, 12);
    if ([t, f, s, l, n].some((x) => x === null)) return setMsg('Please enter whole numbers in every field.');
    updatePrefs({ daily_target_minutes: t! });
    updateTimer({ focus_minutes: f!, short_break_minutes: s!, long_break_minutes: l!, sessions_until_long_break: n! });
    setTarget(String(t));
    setFocus(String(f));
    setShort(String(s));
    setLong(String(l));
    setEvery(String(n));
    setMsg('Saved. A timer already running keeps its original length.');
  };

  const toggleNotifications = async (on: boolean) => {
    setNotifMsg(null);
    if (!on) return updatePrefs({ notifications_enabled: false });
    if (typeof Notification === 'undefined') {
      setNotifMsg('This browser does not support notifications. You will still see an in-app message when a session ends.');
      return;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm === 'granted') updatePrefs({ notifications_enabled: true });
    else setNotifMsg('Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.');
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <form className="card" onSubmit={saveStudy} aria-labelledby="st-study">
        <h2 id="st-study">Daily target &amp; timer</h2>
        <p className="card-sub">A gentle baseline, not a punishment. Currently {formatMinutes(prefs.daily_target_minutes)} a day.</p>
        <div className="form-grid">
          <Field label="Daily study target (minutes)" hint="0 turns the target off.">{(id) => <input id={id} className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />}</Field>
          <Field label="Sessions before a long break" hint="2 to 12">{(id) => <input id={id} className="input" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} />}</Field>
          <Field label="Focus (minutes)" hint="1 to 180">{(id) => <input id={id} className="input" inputMode="numeric" value={focus} onChange={(e) => setFocus(e.target.value)} />}</Field>
          <Field label="Short break (minutes)" hint="1 to 60">{(id) => <input id={id} className="input" inputMode="numeric" value={short} onChange={(e) => setShort(e.target.value)} />}</Field>
          <Field label="Long break (minutes)" hint="1 to 120">{(id) => <input id={id} className="input" inputMode="numeric" value={long} onChange={(e) => setLong(e.target.value)} />}</Field>
        </div>
        <div className="stack" style={{ marginTop: 14 }}>
          <label className="check"><input type="checkbox" checked={timer.auto_start_breaks} onChange={(e) => updateTimer({ auto_start_breaks: e.target.checked })} /> Start breaks automatically</label>
          <label className="check"><input type="checkbox" checked={timer.auto_start_focus} onChange={(e) => updateTimer({ auto_start_focus: e.target.checked })} /> Start the next focus session automatically</label>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" type="submit">Save</button>
          {msg && <span role="status" className={msg.startsWith('Saved') ? 'small muted' : 'error-text'}>{msg}</span>}
        </div>
      </form>

      <section className="card" aria-labelledby="st-notif">
        <h2 id="st-notif">Notifications</h2>
        <p className="card-sub">Shown when a timer finishes, even if you are on another tab.</p>
        <div className="stack">
          <label className="check"><input type="checkbox" checked={prefs.notifications_enabled} onChange={(e) => void toggleNotifications(e.target.checked)} /> Browser notifications</label>
          <label className="check"><input type="checkbox" checked={prefs.sound_enabled} onChange={(e) => updatePrefs({ sound_enabled: e.target.checked })} /> Play a soft sound</label>
          {notifMsg && <p role="alert" className="error-text">{notifMsg}</p>}
        </div>
      </section>

      <section className="card" aria-labelledby="st-tz">
        <h2 id="st-tz">Timezone</h2>
        <p className="card-sub">Decides where one study day ends and the next begins. Changing it does not move sessions you already recorded.</p>
        <Field label="Timezone">{(id) => (
          <select id={id} className="input" style={{ maxWidth: 360 }} value={tz} onChange={(e) => updatePrefs({ timezone: e.target.value })}>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        )}</Field>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function SubjectsTab() {
  const { sync, actions } = useData();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [color, setColor] = useState(SUBJECT_COLORS[0]);
  const subjects = sync.lists.subjects;
  const ordered = useMemo(() => [...subjects].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [subjects]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    actions.addSubject(name, color, (ordered.at(-1)?.sort_order ?? -1) + 1);
    setName('');
    setColor(SUBJECT_COLORS[(subjects.length + 1) % SUBJECT_COLORS.length]);
  };

  const remove = async (s: Subject) => {
    const tasks = sync.lists.tasks.filter((t) => t.subject_id === s.id).length;
    const ok = await confirm({
      title: `Delete “${s.name}”?`,
      body: `Its ${plural(tasks, 'task')} and study history stay in your account but will show as “No subject”.`,
      confirmLabel: 'Delete subject',
      danger: true,
    });
    if (ok) actions.deleteSubject(s.id);
  };

  return (
    <section className="card" aria-labelledby="st-subj">
      <h2 id="st-subj">Subjects</h2>
      <p className="card-sub">Rename, recolour or remove them. <a href="#/subjects">Open the full subject view</a> for per-subject progress.</p>
      <form onSubmit={add} className="row wrap" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 180 }}><Field label="New subject">{(id) => <input id={id} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Organic chemistry" />}</Field></div>
        <Field label="Colour">{(id) => <input id={id} type="color" className="input" style={{ width: 56, padding: 3 }} value={color} onChange={(e) => setColor(e.target.value)} />}</Field>
        <button className="btn primary" type="submit" disabled={!name.trim()}><Icon name="plus" /> Add</button>
      </form>
      {ordered.length === 0 ? (
        <EmptyState title="No subjects yet">Add the subjects you study so sessions and tasks can be grouped.</EmptyState>
      ) : (
        <ul className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ordered.map((s) => <SubjectRow key={s.id} s={s} onDelete={() => void remove(s)} />)}
        </ul>
      )}
    </section>
  );
}

function SubjectRow({ s, onDelete }: { s: Subject; onDelete: () => void }) {
  const { actions } = useData();
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);
  const commit = () => {
    const n = name.trim();
    if (!n) return setName(s.name);
    if (n !== s.name) actions.updateSubject(s.id, { name: n });
  };
  return (
    <li className="list-item" style={{ alignItems: 'center' }}>
      <input type="color" aria-label={`Colour for ${s.name}`} className="input" style={{ width: 48, minHeight: 36, padding: 3 }} value={s.color} onChange={(e) => actions.updateSubject(s.id, { color: e.target.value })} />
      <input aria-label={`Name of ${s.name}`} className="input grow" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <button className="btn ghost icon sm" aria-label={`Delete ${s.name}`} onClick={onDelete}><Icon name="trash" /></button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
function SecurityTab() {
  const { changePassword } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setOk(false);
    if (next.length < 8) return setErr('Use at least 8 characters.');
    if (next !== again) return setErr('The new passwords do not match.');
    if (next === cur) return setErr('Choose a password you have not used just now.');
    setBusy(true);
    setErr(null);
    try {
      await changePassword(cur, next);
      setCur('');
      setNext('');
      setAgain('');
      setOk(true);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="st-sec" style={{ maxWidth: 520 }}>
      <h2 id="st-sec">Password</h2>
      <p className="card-sub">Forgot it instead? Sign out and use “Forgot password” on the sign-in screen.</p>
      <form onSubmit={submit} className="stack" noValidate>
        <Field label="Current password">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
        <Field label="New password" hint="At least 8 characters.">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <Field label="Repeat new password" error={err}>{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}</Field>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || !cur || !next}>{busy ? 'Updating…' : 'Update password'}</button>
          {ok && <span role="status" className="small muted">Password updated.</span>}
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
const STATUS_TEXT = {
  synced: 'Everything is saved to your account.',
  saving: 'Saving changes to the cloud…',
  offline: 'You are offline. Changes are kept on this device and will upload when you reconnect.',
  error: 'Some changes could not be saved yet. They are safe on this device.',
} as const;

function summary(row: any, table: string): string {
  const t = row?.title || row?.name || (typeof row?.body === 'string' ? row.body.slice(0, 60) : '');
  return t ? `${table.replace(/_/g, ' ')}: ${t}` : table.replace(/_/g, ' ');
}

function SyncTab() {
  const { sync, engine, profile } = useData();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await engine.retryNow();
    } finally {
      setBusy(false);
    }
  };
  const backup = () => downloadJson(`nerd-backup-${new Date().toISOString().slice(0, 10)}.json`, buildBackup(profile?.nerd_id, engine.exportAll()));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="st-sync">
        <h2 id="st-sync">Cloud sync</h2>
        <div className="row wrap" style={{ margin: '6px 0 10px' }}>
          <span className="sync" data-status={sync.status} style={{ cursor: 'default' }}><span className="dot" aria-hidden="true" />{{ synced: 'Synced', saving: 'Saving…', offline: 'Offline', error: 'Sync error' }[sync.status]}</span>
          <span className="small muted">{sync.pending > 0 ? `${plural(sync.pending, 'change')} waiting to upload` : 'Nothing waiting'}</span>
          {sync.lastSyncedAt && <span className="small muted">Last synced {new Date(sync.lastSyncedAt).toLocaleTimeString()}</span>}
        </div>
        <p>{STATUS_TEXT[sync.status]}</p>
        {sync.error && <p className="error-text" role="alert" style={{ marginTop: 6 }}>{sync.error}</p>}
        <div className="row wrap" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => void run()} disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button>
          <button className="btn" onClick={backup}>Download a backup</button>
        </div>
      </section>

      {sync.failed.length > 0 && (
        <section className="card" aria-labelledby="st-failed">
          <h2 id="st-failed">Changes the server rejected</h2>
          <p className="card-sub">These stay on this device until you decide. Download a backup first if you are unsure, then retry or discard each one.</p>
          <ul className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {sync.failed.map((f) => (
              <li key={f.key} className="list-item" style={{ alignItems: 'center' }}>
                <div className="grow"><b>{f.label}</b><div className="small error-text">{f.message}</div></div>
                <button className="btn sm danger" onClick={() => engine.discardFailed(f.key)}>Discard</button>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 12 }}><button className="btn" onClick={() => void run()}>Retry all</button></div>
        </section>
      )}

      {sync.backups.length > 0 && (
        <section className="card" aria-labelledby="st-conf">
          <h2 id="st-conf">Edits kept after a conflict</h2>
          <p className="card-sub">When two devices changed the same item, the newer edit won. Your other version was set aside here, never silently deleted.</p>
          <ul className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {sync.backups.map((b) => (
              <li key={b.id} className="list-item" style={{ alignItems: 'center' }}>
                <div className="grow"><b>{summary(b.row, b.table)}</b><div className="small muted">{b.reason} · {new Date(b.at).toLocaleString()}</div></div>
                <button className="btn sm" onClick={() => engine.restoreBackup(b.id)}>Restore this version</button>
                <button className="btn sm ghost" onClick={() => engine.dropBackup(b.id)}>Dismiss</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="st-recover">
        <h2 id="st-recover">If sync keeps failing</h2>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20 }} className="stack">
          <li>Download a backup above. It includes everything on this device.</li>
          <li>Check your connection, then press “Sync now”.</li>
          <li>If one item is rejected, discard it above or fix it and re-save.</li>
          <li>As a last resort, sign out, sign back in (cloud data reloads), and import your backup from <a href="#/settings/data">Your data</a>. Importing never creates duplicates.</li>
        </ol>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function DataTab() {
  const { engine, profile, tz, userId } = useData();
  const { deleteAccount } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ file: string; result: ImportResult } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [applySettings, setApplySettings] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportNow = () => {
    downloadJson(`nerd-backup-${new Date().toISOString().slice(0, 10)}.json`, buildBackup(profile?.nerd_id, engine.exportAll()));
  };

  const onFile = async (f: File | undefined) => {
    setErr(null);
    setDone(null);
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return setErr('That file is larger than 20 MB, which is far beyond a normal Nerd backup.');
    try {
      setParsed({ file: f.name, result: parseBackup(await f.text(), tz) });
    } catch (e) {
      setParsed(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    setImporting(true);
    setErr(null);
    try {
      const { bundle } = parsed.result;
      let added = 0;
      let skipped = 0;
      for (const c of COLLECTION_ORDER) {
        const rows = bundle[c] as any[];
        if (!rows?.length) continue;
        const r = engine.bulkAdd(c, rows);
        added += r.added;
        skipped += r.skipped;
      }
      if (applySettings) {
        if (bundle.user_preferences) engine.updateDoc('user_preferences', bundle.user_preferences as any);
        if (bundle.timer_settings) engine.updateDoc('timer_settings', bundle.timer_settings as any);
      }
      await engine.flush();
      const left = engine.getState().pending;
      setDone(
        `Imported ${plural(added, 'record')}${skipped ? `, skipped ${skipped} already in your account` : ''}.` +
          (left > 0 ? ` ${plural(left, 'change')} still waiting to upload; they are safe on this device and will sync when possible.` : ' Everything is saved to the cloud.'),
      );
      setParsed(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const c = parsed?.result.counts;
  const total = c ? Object.values(c).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="st-export">
        <h2 id="st-export">Export</h2>
        <p className="card-sub">A JSON file with your subjects, tasks, goals, sessions, reflections and settings. Keep it somewhere safe.</p>
        <button className="btn primary" onClick={exportNow}>Download backup</button>
      </section>

      <section className="card" aria-labelledby="st-import">
        <h2 id="st-import">Import</h2>
        <p className="card-sub">Restore a Nerd backup. The file is validated first, records already in your account are skipped, and nothing is overwritten.</p>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" id="import-file" onChange={(e) => void onFile(e.target.files?.[0])} />
        <label htmlFor="import-file" className="btn" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileRef.current?.click())}>Choose a backup file…</label>
        {err && <p className="error-text" role="alert" style={{ marginTop: 10 }}>{err}</p>}
        {done && <p role="status" style={{ marginTop: 10 }}>{done}</p>}
      </section>

      <section className="card" aria-labelledby="st-danger" style={{ borderColor: 'var(--danger)' }}>
        <h2 id="st-danger">Delete account</h2>
        <p className="card-sub">Permanently removes your account and everything in it, on every device. This cannot be undone.</p>
        <button className="btn danger" onClick={() => setDeleting(true)}>Delete my account…</button>
      </section>

      {parsed && (
        <Modal
          title="Import this backup?"
          onClose={() => !importing && setParsed(null)}
          actions={
            <>
              <button className="btn" onClick={() => setParsed(null)} disabled={importing}>Cancel</button>
              <button className="btn primary" onClick={() => void doImport()} disabled={importing || total === 0}>{importing ? 'Importing…' : 'Import'}</button>
            </>
          }
        >
          <p className="muted small" style={{ overflowWrap: 'anywhere' }}>{parsed.file}</p>
          {total === 0 ? (
            <p style={{ marginTop: 8 }}>This file has no importable records.</p>
          ) : (
            <ul style={{ margin: '10px 0', paddingLeft: 20 }}>
              {Object.entries(c!).filter(([, n]) => n > 0).map(([k, n]) => <li key={k}>{n} {k.replace(/_/g, ' ')}</li>)}
            </ul>
          )}
          {parsed.result.warnings.map((w) => <p key={w} className="error-text small">{w}</p>)}
          {(parsed.result.bundle.user_preferences || parsed.result.bundle.timer_settings) && (
            <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={applySettings} onChange={(e) => setApplySettings(e.target.checked)} /> Also replace my current theme, daily target and timer lengths with the ones in this file</label>
          )}
        </Modal>
      )}
      {deleting && <DeleteAccount onClose={() => setDeleting(false)} onExport={exportNow} onDelete={async (pw) => { await deleteAccount(pw); try { localStorage.removeItem(cacheKey(userId)); } catch { /* ignore */ } }} />}
    </div>
  );
}

function DeleteAccount({ onClose, onExport, onDelete }: { onClose: () => void; onExport: () => void; onDelete: (password: string) => Promise<void> }) {
  const [pw, setPw] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onDelete(pw);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
      setBusy(false);
    }
  };
  return (
    <Modal title="Delete your account?" onClose={() => !busy && onClose()}>
      <form onSubmit={go} className="stack" noValidate>
        <p>This permanently deletes, from the cloud and from every device:</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>your account, login and Nerd ID (the ID is never reused)</li>
          <li>all tasks, subjects and goals</li>
          <li>every study session and your whole history</li>
          <li>all reflections and notes</li>
          <li>your theme, timer and other settings</li>
        </ul>
        <p className="muted small">Nothing can be recovered afterwards, except from a backup file you keep yourself.</p>
        <button type="button" className="btn" onClick={onExport}>Download a backup first</button>
        <Field label="Your password">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        <Field label="Type DELETE to confirm" error={err}>{(id) => <input id={id} className="input" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />}</Field>
        <div className="modal-actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn danger solid" type="submit" disabled={busy || !pw || typed !== 'DELETE'}>{busy ? 'Deleting…' : 'Delete everything'}</button>
        </div>
      </form>
    </Modal>
  );
}

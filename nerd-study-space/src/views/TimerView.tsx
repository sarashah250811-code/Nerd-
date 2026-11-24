import { useMemo, useState, type FormEvent } from 'react';
import { useData } from '../data/DataProvider';
import { useTimer, type Phase } from '../timer/TimerProvider';
import { Field, PageHead, useConfirm } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatClock, formatMinutes, pct } from '../lib/format';
import { formatDay } from '../lib/dates';

const PHASE_LABEL: Record<Phase, string> = { focus: 'Focus', short_break: 'Short break', long_break: 'Long break' };

export function TimerFace({ big = false }: { big?: boolean }) {
  const t = useTimer();
  const progress = t.plannedSec > 0 ? 1 - t.remainingSec / t.plannedSec : 0;
  const r = 90;
  const c = 2 * Math.PI * r;
  return (
    <div className="timer-ring" role="timer" aria-label={`${PHASE_LABEL[t.phase]} timer`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
        <circle cx="100" cy="100" r={r} fill="none" stroke={t.phase === 'focus' ? 'var(--accent)' : 'var(--success)'} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct(progress, 1) / 100)} />
      </svg>
      <div className="time" style={big ? { fontSize: 'clamp(3rem, 14vw, 5rem)' } : undefined}>{formatClock(t.remainingSec)}</div>
    </div>
  );
}

export function TimerControls() {
  const t = useTimer();
  const confirm = useConfirm();
  const reset = async () => {
    if (t.status === 'idle' || (await confirm({ title: 'Reset this timer?', body: 'The current session will not be saved.', confirmLabel: 'Reset', danger: true }))) t.reset();
  };
  const skip = async () => {
    if (t.status === 'idle' || t.phase !== 'focus' || (await confirm({ title: 'Skip this focus session?', body: 'Skipped sessions are not saved or counted as study time.', confirmLabel: 'Skip', danger: true }))) t.skip();
  };
  return (
    <div className="row wrap" style={{ justifyContent: 'center' }}>
      {t.status === 'idle' && <button className="btn primary" onClick={t.start}><Icon name="play" /> Start</button>}
      {t.status === 'running' && <button className="btn primary" onClick={t.pause}><Icon name="pause" /> Pause</button>}
      {t.status === 'paused' && <button className="btn primary" onClick={t.resume}><Icon name="play" /> Resume</button>}
      <button className="btn" onClick={() => void reset()} disabled={t.status === 'idle'}><Icon name="reset" /> Reset</button>
      <button className="btn" onClick={() => void skip()}><Icon name="skip" /> Skip</button>
    </div>
  );
}

export function TimerView() {
  const t = useTimer();
  const { sync, timer: cfg, actions, today, tz, prefs, updatePrefs } = useData();
  const confirm = useConfirm();
  const subjects = sync.lists.subjects;
  const subjMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const recent = useMemo(() => [...sync.lists.study_sessions].sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1)).slice(0, 8), [sync.lists.study_sessions]);
  const todayMinutes = sync.lists.study_sessions.filter((s) => s.local_date === today && s.completed && (s.session_type === 'focus' || s.session_type === 'manual')).reduce((a, s) => a + s.duration_seconds / 60, 0);

  const enableNotifs = async () => {
    if (!('Notification' in window)) return;
    const res = await Notification.requestPermission();
    updatePrefs({ notifications_enabled: res === 'granted' });
  };

  return (
    <>
      <PageHead title="Focus timer" sub={`${cfg.focus_minutes} / ${cfg.short_break_minutes} / ${cfg.long_break_minutes} minutes. Change this in Settings.`} actions={<button className="btn" onClick={() => t.setFocusMode(true)}><Icon name="expand" /> Focus mode</button>} />
      <div className="grid cols-2">
        <section className="card timer-face" aria-label="Timer">
          <div className="seg" role="group" aria-label="Timer phase">
            {(Object.keys(PHASE_LABEL) as Phase[]).map((p) => (
              <button key={p} aria-pressed={t.phase === p} disabled={t.status !== 'idle'} onClick={() => t.choosePhase(p)}>{PHASE_LABEL[p]}</button>
            ))}
          </div>
          <TimerFace />
          <TimerControls />
          <div style={{ width: '100%', maxWidth: 320 }}>
            <Field label="Subject (optional)">{(id) => (
              <select id={id} className="input" value={t.subjectId ?? ''} onChange={(e) => t.setSubject(e.target.value || null)} disabled={t.status !== 'idle' && t.phase === 'focus'}>
                <option value="">No subject</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}</Field>
          </div>
          <p className="small muted" style={{ textAlign: 'center' }}>
            Today: <b>{t.todayFocusCount}</b> focus session{t.todayFocusCount === 1 ? '' : 's'} · {formatMinutes(todayMinutes)} studied · cycle {t.focusDone % cfg.sessions_until_long_break} of {cfg.sessions_until_long_break} before a long break
          </p>
          {'Notification' in window && !prefs.notifications_enabled && (
            <button className="btn sm" onClick={() => void enableNotifs()}>Notify me when a session ends</button>
          )}
        </section>

        <div className="stack">
          <ManualLog />
          <section className="card">
            <h2>Recent sessions</h2>
            {recent.length === 0 ? <p className="muted small" style={{ marginTop: 8 }}>Nothing recorded yet. Finish a focus session or log one by hand.</p> : (
              <ul className="list" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
                {recent.map((s) => {
                  const label = s.session_type === 'focus' ? 'Focus' : s.session_type === 'manual' ? 'Logged' : s.session_type === 'short_break' ? 'Short break' : 'Long break';
                  return (
                    <li className="list-item" key={s.id}>
                      <div className="grow">
                        <div className="title">{label} · {formatMinutes(s.duration_seconds / 60)}</div>
                        <div className="small muted">{formatDay(s.local_date)}{s.subject_id && subjMap.get(s.subject_id) ? ` · ${subjMap.get(s.subject_id)!.name}` : ''}</div>
                      </div>
                      <button className="btn ghost icon sm" aria-label="Delete this session" onClick={async () => { if (await confirm({ title: 'Delete this session?', body: 'It will no longer count toward your analytics.', confirmLabel: 'Delete', danger: true })) actions.deleteSession(s.id); }}><Icon name="trash" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
      <span className="sr-only">{tz}</span>
    </>
  );
}

function ManualLog() {
  const { sync, actions, today, tz } = useData();
  const [minutes, setMinutes] = useState('30');
  const [subjectId, setSubjectId] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = Number(minutes);
    if (!Number.isFinite(m) || m < 1 || m > 1440) return setErr('Enter between 1 and 1440 minutes.');
    if (!date || date > today) return setErr('Pick today or an earlier date.');
    // Anchor the entry at noon on the chosen day in the user's timezone (or "now" for today).
    const end = date === today ? new Date() : zonedNoon(date, tz);
    const start = new Date(end.getTime() - m * 60000);
    actions.addSession({ subject_id: subjectId || null, session_type: 'manual', started_at: start.toISOString(), ended_at: end.toISOString(), duration_seconds: m * 60, note });
    setErr(null);
    setOk(true);
    setNote('');
    setTimeout(() => setOk(false), 2500);
  };

  return (
    <section className="card">
      <h2>Log study without the timer</h2>
      <p className="card-sub">For work you already did.</p>
      <form className="form-grid" onSubmit={submit} noValidate>
        <Field label="Minutes" error={err}>{(id) => <input id={id} className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
        <Field label="Date">{(id) => <input id={id} className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Subject">{(id) => (
          <select id={id} className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">No subject</option>
            {sync.lists.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}</Field>
        <Field label="Note (optional)">{(id) => <input id={id} className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}</Field>
        <div className="full row"><button className="btn primary" type="submit">Save session</button>{ok && <span role="status" className="small muted">Saved.</span>}</div>
      </form>
    </section>
  );
}

/** A Date at 12:00 local time on `day` in the given timezone. */
function zonedNoon(day: string, tz: string): Date {
  const guess = new Date(`${day}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return new Date(guess.getTime() - ((h - 12) * 60 + m) * 60000);
}

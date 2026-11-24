import { useMemo } from 'react';
import { useData } from '../data/DataProvider';
import { useNow } from '../lib/hooks';
import { quoteForDay } from '../lib/quotes';
import { addDays, clockParts, formatDay } from '../lib/dates';
import { formatMinutes, plural } from '../lib/format';
import { goalProgress, isStudy, lastNDays, minutesByDay, sumRange } from '../lib/analytics';
import { BarChart, Ring } from '../components/charts';
import { EmptyState, ProgressBar, SubjectDot } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';

const TILES: { id: string; label: string; icon: IconName }[] = [
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'timer', label: 'Start a timer', icon: 'timer' },
  { id: 'goals', label: 'Goals', icon: 'goals' },
  { id: 'reflections', label: 'Reflect', icon: 'reflections' },
];

export function Dashboard({ name, go }: { name: string; go: (r: string) => void }) {
  const { sync, prefs, tz, today } = useData();
  const now = useNow(1000);
  const { subjects, tasks, goals, study_sessions } = sync.lists;
  const subjMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const study = useMemo(() => study_sessions.filter(isStudy), [study_sessions]);
  const byDay = useMemo(() => minutesByDay(study), [study]);

  const hour = clockParts(now, tz).h;
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayMin = byDay.get(today) ?? 0;
  const target = prefs.daily_target_minutes;
  const remaining = Math.max(0, target - todayMin);

  const open = tasks.filter((t) => !t.completed_at);
  const dueNow = open.filter((t) => t.due_date && t.due_date <= today).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
  const current = [...dueNow, ...open.filter((t) => !t.due_date || t.due_date > today)].slice(0, 5);
  const upcoming = open.filter((t) => t.due_date && t.due_date > today && t.due_date <= addDays(today, 14)).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1)).slice(0, 5);
  const activeGoals = goals.filter((g) => !g.completed_at && g.end_date >= today).slice(0, 4);
  const recent = [...study_sessions].filter((s) => s.session_type !== 'short_break' && s.session_type !== 'long_break').sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1)).slice(0, 5);
  const week = lastNDays(today, 7).map((d) => ({ label: formatDay(d, { weekday: 'narrow' }), value: byDay.get(d) ?? 0, title: `${formatDay(d)}: ${formatMinutes(byDay.get(d) ?? 0)}` }));
  const weekTotal = sumRange(byDay, addDays(today, -6), today);
  const q = quoteForDay(today);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting}, {name}</h1>
          <p>{formatDay(today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="stat" style={{ textAlign: 'right' }}>
          <span className="stat-value num" aria-label="Current time">{now.toLocaleTimeString([], { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span className="stat-label">{tz.replace('_', ' ')}</span>
        </div>
      </div>

      <blockquote className="card" style={{ margin: '0 0 16px' }}>
        <p style={{ fontFamily: 'Fraunces, serif', fontSize: '1.1rem' }}>“{q.text}”</p>
        <footer className="small muted" style={{ marginTop: 6 }}>— {q.by}</footer>
      </blockquote>

      <div className="grid cols-3">
        <section className="card" aria-labelledby="d-target">
          <h2 id="d-target">Today's target</h2>
          <div className="row" style={{ gap: 18, marginTop: 10 }}>
            <Ring ratio={target > 0 ? todayMin / target : 0} size={110}>
              <div><div className="stat-value" style={{ fontSize: '1.3rem' }}>{formatMinutes(todayMin)}</div><div className="small muted">of {formatMinutes(target)}</div></div>
            </Ring>
            <div className="stack" style={{ gap: 4 }}>
              <div className="stat"><span className="stat-value" style={{ fontSize: '1.3rem' }}>{formatMinutes(remaining)}</span><span className="stat-label">{target > 0 && remaining === 0 ? 'Target reached' : 'remaining today'}</span></div>
              <div className="small muted">{plural(study.filter((s) => s.local_date === today).length, 'session')} today</div>
            </div>
          </div>
        </section>

        <section className="card span-2" aria-labelledby="d-week">
          <div className="row between"><h2 id="d-week">Last 7 days</h2><span className="small muted">{formatMinutes(weekTotal)} studied</span></div>
          <BarChart data={week} height={140} ariaLabel="Study minutes over the last 7 days" />
        </section>

        <section className="card span-2" aria-labelledby="d-tasks">
          <div className="row between"><h2 id="d-tasks">Current tasks</h2><a href="#/tasks" className="small">All tasks</a></div>
          {current.length === 0 ? (
            <EmptyState title="Nothing open" action={<a className="btn sm" href="#/tasks">Add a task</a>}>Add a task to see it here.</EmptyState>
          ) : (
            <ul className="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {current.map((t) => (
                <li className="list-item" key={t.id}>
                  <div className="grow">
                    <div className="title">{t.title}</div>
                    <div className="small muted row wrap" style={{ gap: 10 }}>
                      {t.subject_id && subjMap.get(t.subject_id) && <SubjectDot color={subjMap.get(t.subject_id)!.color} name={subjMap.get(t.subject_id)!.name} />}
                      {t.due_date && <span className={t.due_date < today ? 'pill-overdue' : ''}>{t.due_date < today ? 'Overdue · ' : t.due_date === today ? 'Due today' : 'Due '}{t.due_date === today ? '' : formatDay(t.due_date)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="d-up">
          <h2 id="d-up">Upcoming deadlines</h2>
          {upcoming.length === 0 ? <p className="muted small" style={{ marginTop: 8 }}>No deadlines in the next two weeks.</p> : (
            <ul className="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {upcoming.map((t) => (
                <li className="list-item" key={t.id}><div className="grow"><div className="title">{t.title}</div><div className="small muted">{formatDay(t.due_date!)}</div></div></li>
              ))}
            </ul>
          )}
        </section>

        <section className="card span-2" aria-labelledby="d-goals">
          <div className="row between"><h2 id="d-goals">Active goals</h2><a href="#/goals" className="small">All goals</a></div>
          {activeGoals.length === 0 ? <p className="muted small" style={{ marginTop: 8 }}>No active goals. Set one for this week.</p> : (
            <div className="stack" style={{ marginTop: 10 }}>
              {activeGoals.map((g) => {
                const p = goalProgress(g, study_sessions, tasks, tz);
                return (
                  <div key={g.id}>
                    <div className="row between small"><span>{g.title}</span><span className="muted num">{Math.round(p.value)} / {g.target_value} {p.unit}</span></div>
                    <ProgressBar value={p.value} total={g.target_value} label={g.title} done={p.reached} />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="d-recent">
          <h2 id="d-recent">Recent sessions</h2>
          {recent.length === 0 ? <p className="muted small" style={{ marginTop: 8 }}>Finish a focus session to see it here.</p> : (
            <ul className="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {recent.map((s) => (
                <li className="list-item" key={s.id}>
                  <div className="grow">
                    <div className="title">{formatMinutes(s.duration_seconds / 60)}{s.session_type === 'manual' ? ' · logged' : ''}</div>
                    <div className="small muted">{formatDay(s.local_date)}{s.subject_id && subjMap.get(s.subject_id) ? ` · ${subjMap.get(s.subject_id)!.name}` : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <nav className="grid cols-4" style={{ marginTop: 16 }} aria-label="Quick links">
        {TILES.map((t) => (
          <button key={t.id} className="card row" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => go(t.id)}>
            <Icon name={t.icon} className="" /><span style={{ fontWeight: 500 }}>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

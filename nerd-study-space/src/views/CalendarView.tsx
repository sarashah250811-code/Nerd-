import { useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { addDays, addMonths, endOfMonth, endOfWeek, formatDay, formatMonth, startOfMonth, startOfWeek, weekdayLabels, dayKey } from '../lib/dates';
import { formatMinutes, plural } from '../lib/format';
import { isStudy } from '../lib/analytics';
import { EmptyState, PageHead, SubjectDot, useConfirm } from '../components/ui';
import { Icon } from '../components/Icon';

export function CalendarView() {
  const { sync, actions, prefs, tz, today } = useData();
  const confirm = useConfirm();
  const [month, setMonth] = useState(startOfMonth(today));
  const [selected, setSelected] = useState(today);
  const { subjects, tasks, goals, study_sessions, reflections } = sync.lists;
  const ws = prefs.week_starts_on;
  const subjMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const study = useMemo(() => study_sessions.filter(isStudy), [study_sessions]);
  const minutes = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of study) m.set(s.local_date, (m.get(s.local_date) ?? 0) + s.duration_seconds / 60);
    return m;
  }, [study]);
  const dueBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (t.due_date && !t.completed_at) m.set(t.due_date, (m.get(t.due_date) ?? 0) + 1);
    return m;
  }, [tasks]);
  const goalEnds = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of goals) m.set(g.end_date, (m.get(g.end_date) ?? 0) + 1);
    return m;
  }, [goals]);

  const gridStart = startOfWeek(month, ws);
  const gridEnd = endOfWeek(endOfMonth(month), ws);
  const days: string[] = [];
  for (let k = gridStart; k <= gridEnd; k = addDays(k, 1)) days.push(k);

  const move = (n: number) => {
    const m = addMonths(month, n);
    setMonth(m);
    setSelected(today.slice(0, 7) === m.slice(0, 7) ? today : m);
  };
  const jumpToday = () => {
    setMonth(startOfMonth(today));
    setSelected(today);
  };

  const dayStudy = study_sessions.filter((s) => s.local_date === selected && s.session_type !== 'short_break' && s.session_type !== 'long_break').sort((a, b) => (a.ended_at < b.ended_at ? -1 : 1));
  const dayDue = tasks.filter((t) => t.due_date === selected);
  const dayDone = tasks.filter((t) => t.completed_at && dayKey(t.completed_at, tz) === selected);
  const dayGoals = goals.filter((g) => g.end_date === selected);
  const dayNotes = reflections.filter((r) => r.entry_date === selected);
  const dayTotal = minutes.get(selected) ?? 0;
  const empty = !dayStudy.length && !dayDue.length && !dayDone.length && !dayGoals.length && !dayNotes.length;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { timeZone: tz, hour: '2-digit', minute: '2-digit' });

  const removeSession = async (id: string) => {
    if (await confirm({ title: 'Delete this study record?', body: 'It will be removed from your history and analytics on every device.', confirmLabel: 'Delete', danger: true })) actions.deleteSession(id);
  };

  return (
    <>
      <PageHead
        title="Calendar"
        sub="Sessions, deadlines and goal end dates in one place."
        actions={<button className="btn" onClick={jumpToday}>Today</button>}
      />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <section className="card" aria-label="Month">
          <div className="row between" style={{ marginBottom: 12 }}>
            <button className="btn ghost icon" aria-label="Previous month" onClick={() => move(-1)}><Icon name="chevL" /></button>
            <h2 aria-live="polite">{formatMonth(month)}</h2>
            <button className="btn ghost icon" aria-label="Next month" onClick={() => move(1)}><Icon name="chevR" /></button>
          </div>
          <div className="cal">
            {weekdayLabels(ws).map((l, i) => <div key={i} className="dow">{l}</div>)}
            {days.map((d) => {
              const m = minutes.get(d) ?? 0;
              const due = dueBy.get(d) ?? 0;
              const ge = goalEnds.get(d) ?? 0;
              return (
                <button
                  key={d}
                  className={`day ${d.slice(0, 7) !== month.slice(0, 7) ? 'out' : ''} ${d === today ? 'today' : ''}`}
                  aria-pressed={d === selected}
                  aria-label={`${formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}${m ? `, ${formatMinutes(m)} studied` : ''}${due ? `, ${plural(due, 'task')} due` : ''}${ge ? `, ${plural(ge, 'goal')} ending` : ''}`}
                  onClick={() => setSelected(d)}
                >
                  <b className="num">{Number(d.slice(8))}</b>
                  {m > 0 && <span className="mark">{formatMinutes(m)}</span>}
                  {due > 0 && <span className="mark">{due} due</span>}
                  {ge > 0 && <span className="mark">goal ends</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="card" aria-label={`Details for ${formatDay(selected)}`}>
          <h2>{formatDay(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <p className="card-sub">{dayTotal > 0 ? `${formatMinutes(dayTotal)} studied` : 'No study time recorded'}</p>
          {empty && <EmptyState title="Nothing here">No sessions, deadlines or notes for this day.</EmptyState>}

          {dayStudy.length > 0 && (
            <>
              <h3>Study</h3>
              <ul className="list" style={{ listStyle: 'none', margin: '4px 0 12px', padding: 0 }}>
                {dayStudy.map((s) => (
                  <li key={s.id} className="list-item" style={{ alignItems: 'center' }}>
                    <div className="grow">
                      <SubjectDot color={s.subject_id ? subjMap.get(s.subject_id)?.color : undefined} name={s.subject_id ? subjMap.get(s.subject_id)?.name : undefined} />
                      <div className="small muted">{s.session_type === 'manual' ? 'Logged manually' : 'Focus'} · until {time(s.ended_at)}</div>
                    </div>
                    <span className="num">{formatMinutes(s.duration_seconds / 60)}</span>
                    <button className="btn ghost icon sm" aria-label="Delete this study record" onClick={() => void removeSession(s.id)}><Icon name="trash" /></button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {dayDue.length > 0 && (
            <>
              <h3>Due</h3>
              <ul className="list" style={{ listStyle: 'none', margin: '4px 0 12px', padding: 0 }}>
                {dayDue.map((t) => (
                  <li key={t.id} className={`list-item ${t.completed_at ? 'done' : ''}`} style={{ alignItems: 'center' }}>
                    <label className="check grow">
                      <input type="checkbox" checked={!!t.completed_at} onChange={(e) => actions.setTaskDone(t.id, e.target.checked)} />
                      <span className="title">{t.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {dayDone.length > 0 && (
            <>
              <h3>Completed</h3>
              <ul className="list" style={{ listStyle: 'none', margin: '4px 0 12px', padding: 0 }}>
                {dayDone.map((t) => <li key={t.id} className="list-item done"><span className="title">{t.title}</span></li>)}
              </ul>
            </>
          )}

          {dayGoals.length > 0 && (
            <>
              <h3>Goal milestones</h3>
              <ul className="list" style={{ listStyle: 'none', margin: '4px 0 12px', padding: 0 }}>
                {dayGoals.map((g) => (
                  <li key={g.id} className="list-item"><span className="grow">{g.title}</span><span className="chip">{g.completed_at ? 'Completed' : `${g.period} ends`}</span></li>
                ))}
              </ul>
            </>
          )}

          {dayNotes.length > 0 && (
            <>
              <h3>Reflections &amp; notes</h3>
              <ul className="list" style={{ listStyle: 'none', margin: '4px 0 12px', padding: 0 }}>
                {dayNotes.map((r) => <li key={r.id} className="list-item"><a href="#/reflections">{r.title || (r.kind === 'note' ? 'Note' : 'Reflection')}</a></li>)}
              </ul>
            </>
          )}
        </section>
      </div>
      <style>{`@media (max-width: 899px) { .main .grid[style*='1.6fr'] { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </>
  );
}

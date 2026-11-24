import { useMemo, useState, type FormEvent } from 'react';
import { useData } from '../data/DataProvider';
import type { Goal, GoalMetric, GoalPeriod } from '../lib/types';
import { goalProgress, goalRange } from '../lib/analytics';
import { EmptyState, Field, Modal, PageHead, ProgressBar, SubjectDot, useConfirm } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatDay } from '../lib/dates';

const PERIODS: GoalPeriod[] = ['daily', 'weekly', 'monthly'];
const METRIC_LABEL: Record<GoalMetric, string> = { minutes: 'Study minutes', sessions: 'Study sessions', tasks: 'Tasks completed', manual: 'Manual count' };

export function Goals() {
  const { sync, actions, tz, today } = useData();
  const confirm = useConfirm();
  const [tab, setTab] = useState<GoalPeriod | 'history'>('weekly');
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const { goals, study_sessions, tasks, subjects } = sync.lists;
  const subjMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const isActive = (g: Goal) => !g.completed_at && g.end_date >= today;
  const shown = goals
    .filter((g) => (tab === 'history' ? !isActive(g) : isActive(g) && g.period === tab))
    .sort((a, b) => (a.end_date < b.end_date ? (tab === 'history' ? 1 : -1) : tab === 'history' ? -1 : 1));
  const count = (p: GoalPeriod) => goals.filter((g) => isActive(g) && g.period === p).length;

  const remove = async (g: Goal) => {
    if (await confirm({ title: 'Delete this goal?', body: `“${g.title}” and its progress will be removed.`, confirmLabel: 'Delete', danger: true })) actions.deleteGoal(g.id);
  };

  return (
    <>
      <PageHead title="Goals" sub="Measurable, and kind to yourself." actions={<button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" /> New goal</button>} />
      <div className="tabs" role="tablist" aria-label="Goal periods">
        {PERIODS.map((p) => (
          <button key={p} role="tab" aria-selected={tab === p} className="tab" onClick={() => setTab(p)}>
            {p[0].toUpperCase() + p.slice(1)} <span className="muted">({count(p)})</span>
          </button>
        ))}
        <button role="tab" aria-selected={tab === 'history'} className="tab" onClick={() => setTab('history')}>History</button>
      </div>

      {shown.length === 0 ? (
        <section className="card">
          <EmptyState title={tab === 'history' ? 'No past goals yet' : `No ${tab} goals`} action={tab !== 'history' ? <button className="btn primary" onClick={() => setEditing('new')}>Set a goal</button> : undefined}>
            {tab === 'history' ? 'Completed goals and goals whose period has ended appear here.' : 'Try something small you can actually hit.'}
          </EmptyState>
        </section>
      ) : (
        <div className="grid cols-2">
          {shown.map((g) => {
            const p = goalProgress(g, study_sessions, tasks, tz);
            const s = g.subject_id ? subjMap.get(g.subject_id) : undefined;
            const done = !!g.completed_at;
            return (
              <section key={g.id} className="card" aria-label={g.title}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <h3>{g.title}</h3>
                    <div className="small muted">{METRIC_LABEL[g.metric]} · {formatDay(g.start_date)}{g.end_date !== g.start_date ? ` – ${formatDay(g.end_date)}` : ''}</div>
                  </div>
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn ghost icon sm" aria-label={`Edit ${g.title}`} onClick={() => setEditing(g)}><Icon name="edit" /></button>
                    <button className="btn ghost icon sm" aria-label={`Delete ${g.title}`} onClick={() => void remove(g)}><Icon name="trash" /></button>
                  </div>
                </div>
                {g.description && <p className="small muted" style={{ marginTop: 6 }}>{g.description}</p>}
                <div style={{ margin: '12px 0 6px' }}><ProgressBar value={p.value} total={p.target} label={`${g.title} progress`} done={p.reached || done} /></div>
                <div className="row between small">
                  <span className="num"><b>{Math.round(p.value * 10) / 10}</b> / {g.target_value} {p.unit}</span>
                  {s && <SubjectDot color={s.color} name={s.name} />}
                </div>
                <div className="row wrap" style={{ marginTop: 12 }}>
                  {g.metric === 'manual' && !done && (
                    <>
                      <button className="btn sm" onClick={() => actions.updateGoal(g.id, { current_value: Math.max(0, g.current_value - 1) })} aria-label="Decrease progress">−1</button>
                      <button className="btn sm" onClick={() => actions.updateGoal(g.id, { current_value: g.current_value + 1 })} aria-label="Increase progress">+1</button>
                    </>
                  )}
                  {done ? (
                    <button className="btn sm" onClick={() => actions.setGoalDone(g.id, false)}>Reopen</button>
                  ) : (
                    <button className={`btn sm ${p.reached ? 'primary' : ''}`} onClick={() => actions.setGoalDone(g.id, true)}><Icon name="check" /> Mark complete</button>
                  )}
                  {p.reached && !done && <span className="chip">Target reached</span>}
                  {done && <span className="chip">Completed {formatDay(g.completed_at!.slice(0, 10))}</span>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {editing && <GoalForm goal={editing === 'new' ? null : editing} defaultPeriod={tab === 'history' ? 'weekly' : tab} onClose={() => setEditing(null)} />}
    </>
  );
}

function GoalForm({ goal, defaultPeriod, onClose }: { goal: Goal | null; defaultPeriod: GoalPeriod; onClose: () => void }) {
  const { sync, actions, today, prefs } = useData();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [period, setPeriod] = useState<GoalPeriod>(goal?.period ?? defaultPeriod);
  const [metric, setMetric] = useState<GoalMetric>(goal?.metric ?? 'minutes');
  const [target, setTarget] = useState(String(goal?.target_value ?? 300));
  const [subjectId, setSubjectId] = useState(goal?.subject_id ?? '');
  const init = goal ? { start: goal.start_date, end: goal.end_date } : goalRange(defaultPeriod, today, prefs.week_starts_on);
  const [start, setStart] = useState(init.start);
  const [end, setEnd] = useState(init.end);
  const [err, setErr] = useState<string | null>(null);

  const changePeriod = (p: GoalPeriod) => {
    setPeriod(p);
    const r = goalRange(p, today, prefs.week_starts_on);
    setStart(r.start);
    setEnd(r.end);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = Number(target);
    if (!title.trim()) return setErr('Give the goal a title.');
    if (!Number.isFinite(t) || t <= 0) return setErr('The target must be a number above zero.');
    if (!start || !end || end < start) return setErr('The end date must be on or after the start date.');
    const input = { title, description, period, metric, target_value: t, subject_id: metric === 'manual' ? null : subjectId || null, start_date: start, end_date: end };
    if (goal) actions.updateGoal(goal.id, input);
    else actions.addGoal(input);
    onClose();
  };

  return (
    <Modal title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid" noValidate>
        <div className="full"><Field label="Goal" error={err}>{(id) => <input id={id} className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 5 hours of organic chemistry" />}</Field></div>
        <Field label="Period">{(id) => (
          <select id={id} className="input" value={period} onChange={(e) => changePeriod(e.target.value as GoalPeriod)}>
            {PERIODS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        )}</Field>
        <Field label="Measured by" hint={metric === 'manual' ? 'You update the count yourself.' : 'Calculated from your real sessions and tasks.'}>{(id) => (
          <select id={id} className="input" value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
            {(Object.keys(METRIC_LABEL) as GoalMetric[]).map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
          </select>
        )}</Field>
        <Field label={`Target${metric === 'minutes' ? ' (minutes)' : ''}`}>{(id) => <input id={id} className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />}</Field>
        {metric !== 'manual' && (
          <Field label="Only count subject" hint="Optional">{(id) => (
            <select id={id} className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Any subject</option>
              {sync.lists.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}</Field>
        )}
        <Field label="Starts">{(id) => <input id={id} className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Ends">{(id) => <input id={id} className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        <div className="full"><Field label="Notes (optional)">{(id) => <textarea id={id} className="input" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />}</Field></div>
        <div className="full modal-actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit">{goal ? 'Save changes' : 'Create goal'}</button>
        </div>
      </form>
    </Modal>
  );
}

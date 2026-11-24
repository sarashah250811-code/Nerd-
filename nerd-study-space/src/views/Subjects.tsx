import { useMemo, useState, type FormEvent } from 'react';
import { useData } from '../data/DataProvider';
import { SUBJECT_COLORS } from '../data/actions';
import type { Subject } from '../lib/types';
import { EmptyState, Field, Modal, PageHead, ProgressBar, useConfirm } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatMinutes, plural } from '../lib/format';
import { addDays } from '../lib/dates';
import { isStudy, minutesByDay, sumRange } from '../lib/analytics';

export function Subjects() {
  return (
    <>
      <PageHead title="Subjects" sub="What you study, and how it is going." />
      <SubjectsManager />
    </>
  );
}

/** Used by the Subjects page and by Settings → Subjects. */
export function SubjectsManager({ compact = false }: { compact?: boolean }) {
  const { sync, actions, today } = useData();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const { subjects, tasks, study_sessions } = sync.lists;
  const sorted = useMemo(() => [...subjects].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [subjects]);
  const study = useMemo(() => study_sessions.filter(isStudy), [study_sessions]);

  const stats = (id: string) => {
    const mine = tasks.filter((t) => t.subject_id === id);
    const done = mine.filter((t) => t.completed_at).length;
    const sessions = study.filter((s) => s.subject_id === id);
    const total = sessions.reduce((a, s) => a + s.duration_seconds / 60, 0);
    const week = sumRange(minutesByDay(sessions), addDays(today, -6), today);
    return { all: mine.length, done, total, week };
  };

  const remove = async (s: Subject) => {
    const st = stats(s.id);
    const ok = await confirm({
      title: `Delete “${s.name}”?`,
      body: `Its ${plural(st.all, 'task')} and ${formatMinutes(st.total)} of study history stay in your account but will show as “No subject”.`,
      confirmLabel: 'Delete subject',
      danger: true,
    });
    if (ok) actions.deleteSubject(s.id);
  };

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        {!compact && <span className="muted small">{plural(sorted.length, 'subject')}</span>}
        <button className="btn primary" onClick={() => setEditing('new')} style={{ marginLeft: 'auto' }}><Icon name="plus" /> Add subject</button>
      </div>
      {sorted.length === 0 ? (
        <section className="card"><EmptyState title="No subjects yet" action={<button className="btn primary" onClick={() => setEditing('new')}>Add a subject</button>}>Subjects group your tasks and study time.</EmptyState></section>
      ) : (
        <div className={`grid ${compact ? '' : 'cols-3'}`}>
          {sorted.map((s) => {
            const st = stats(s.id);
            return (
              <section className="card" key={s.id} aria-label={s.name}>
                <div className="row between">
                  <h3 className="row"><span className="dot" style={{ background: s.color }} aria-hidden="true" />{s.name}</h3>
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn ghost icon sm" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Icon name="edit" /></button>
                    <button className="btn ghost icon sm" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}><Icon name="trash" /></button>
                  </div>
                </div>
                {!compact && (
                  <>
                    <div className="small muted" style={{ margin: '6px 0 8px' }}>{formatMinutes(st.total)} total · {formatMinutes(st.week)} this week</div>
                    <ProgressBar value={st.done} total={st.all} label={`${s.name} task progress`} done={st.all > 0 && st.done === st.all} />
                    <div className="row between small muted" style={{ marginTop: 6 }}>
                      <span>{st.done} of {plural(st.all, 'task')} done</span>
                      <a href={`#/tasks?subject=${s.id}`}>View tasks</a>
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
      {editing && <SubjectForm subject={editing === 'new' ? null : editing} count={subjects.length} onClose={() => setEditing(null)} />}
    </>
  );
}

function SubjectForm({ subject, count, onClose }: { subject: Subject | null; count: number; onClose: () => void }) {
  const { actions, sync } = useData();
  const [name, setName] = useState(subject?.name ?? '');
  const [color, setColor] = useState(subject?.color ?? SUBJECT_COLORS[count % SUBJECT_COLORS.length]);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr('Please enter a name.');
    if (sync.lists.subjects.some((s) => s.id !== subject?.id && s.name.toLowerCase() === n.toLowerCase())) return setErr('You already have a subject with that name.');
    if (subject) actions.updateSubject(subject.id, { name: n, color });
    else actions.addSubject(n, color, count);
    onClose();
  };
  return (
    <Modal title={subject ? 'Edit subject' : 'New subject'} onClose={onClose}>
      <form onSubmit={submit} className="stack" noValidate>
        <Field label="Name" error={err}>{(id) => <input id={id} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="field">
          <span className="label" id="color-label">Colour</span>
          <div className="row wrap" role="radiogroup" aria-labelledby="color-label">
            {SUBJECT_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)}
                style={{ width: 34, height: 34, borderRadius: '50%', background: c, border: color === c ? '3px solid var(--text)' : '2px solid var(--border)', cursor: 'pointer' }} />
            ))}
            <input type="color" aria-label="Custom colour" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, height: 34, border: 0, background: 'none' }} />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit">{subject ? 'Save' : 'Add subject'}</button>
        </div>
      </form>
    </Modal>
  );
}

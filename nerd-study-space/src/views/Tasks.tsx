import { useMemo, useState, type FormEvent } from 'react';
import { useData } from '../data/DataProvider';
import type { Priority, Task } from '../lib/types';
import { formatDay } from '../lib/dates';
import { EmptyState, Field, Modal, PageHead, SubjectDot, useConfirm } from '../components/ui';
import { Icon } from '../components/Icon';

type Filter = 'pending' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'all';
type Sort = 'due' | 'priority' | 'created' | 'subject' | 'title';
const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

function initialSubject(): string {
  const q = window.location.hash.split('?')[1];
  return new URLSearchParams(q ?? '').get('subject') ?? '';
}

export function Tasks() {
  const { sync, actions, today } = useData();
  const confirm = useConfirm();
  const subjects = sync.lists.subjects;
  const tasks = sync.lists.tasks;
  const subjMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const [filter, setFilter] = useState<Filter>('pending');
  const [sort, setSort] = useState<Sort>('due');
  const [subject, setSubject] = useState(initialSubject);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);

  const cat = (t: Task): Exclude<Filter, 'pending' | 'all'> | 'none' => {
    if (t.completed_at) return 'completed';
    if (!t.due_date) return 'none';
    return t.due_date < today ? 'overdue' : t.due_date === today ? 'today' : 'upcoming';
  };
  const counts = useMemo(() => {
    const c = { pending: 0, today: 0, upcoming: 0, overdue: 0, completed: 0, all: tasks.length };
    for (const t of tasks) {
      const k = cat(t);
      if (k === 'completed') c.completed++;
      else {
        c.pending++;
        if (k === 'today') c.today++;
        if (k === 'upcoming') c.upcoming++;
        if (k === 'overdue') c.overdue++;
      }
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, today]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tasks.filter((t) => {
      const k = cat(t);
      if (filter === 'pending' && k === 'completed') return false;
      if (['today', 'upcoming', 'overdue', 'completed'].includes(filter) && k !== filter) return false;
      if (subject && (subject === 'none' ? t.subject_id : t.subject_id !== subject)) return false;
      if (q && !(`${t.title} ${t.description}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const due = (t: Task) => t.due_date ?? '9999-99-99';
    list.sort((a, b) => {
      switch (sort) {
        case 'priority': return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (due(a) < due(b) ? -1 : 1);
        case 'created': return a.created_at < b.created_at ? 1 : -1;
        case 'subject': return (subjMap.get(a.subject_id ?? '')?.name ?? '~').localeCompare(subjMap.get(b.subject_id ?? '')?.name ?? '~');
        case 'title': return a.title.localeCompare(b.title);
        default: return due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      }
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, filter, sort, subject, query, today, subjMap]);

  const remove = async (t: Task) => {
    if (await confirm({ title: 'Delete this task?', body: `“${t.title}” will be removed from all your devices.`, confirmLabel: 'Delete', danger: true })) actions.deleteTask(t.id);
  };

  const tabs: [Filter, string][] = [['pending', 'Pending'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['completed', 'Completed'], ['all', 'All']];

  return (
    <>
      <PageHead title="Tasks" sub="One step at a time." actions={<button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" /> Add task</button>} />
      <div className="tabs" role="tablist" aria-label="Task categories">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={filter === id} className="tab" onClick={() => setFilter(id)}>
            {label} <span className="muted">({counts[id]})</span>
          </button>
        ))}
      </div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 240 }} type="search" placeholder="Search tasks" aria-label="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input" style={{ maxWidth: 200 }} aria-label="Filter by subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">All subjects</option>
          <option value="none">No subject</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 190 }} aria-label="Sort tasks" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="due">Sort: due date</option>
          <option value="priority">Sort: priority</option>
          <option value="created">Sort: newest</option>
          <option value="subject">Sort: subject</option>
          <option value="title">Sort: title</option>
        </select>
      </div>

      <section className="card">
        {shown.length === 0 ? (
          <EmptyState title={tasks.length === 0 ? 'No tasks yet' : 'Nothing here'} action={tasks.length === 0 ? <button className="btn primary" onClick={() => setEditing('new')}>Add your first task</button> : undefined}>
            {tasks.length === 0 ? 'Small, realistic goals. Add the first thing you want to finish.' : 'No tasks match this view.'}
          </EmptyState>
        ) : (
          <ul className="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {shown.map((t) => {
              const s = t.subject_id ? subjMap.get(t.subject_id) : undefined;
              const k = cat(t);
              return (
                <li key={t.id} className={`list-item ${t.completed_at ? 'done' : ''}`}>
                  <input type="checkbox" className="check" style={{ width: 22, height: 22, marginTop: 2, accentColor: 'var(--accent)' }} checked={!!t.completed_at} onChange={(e) => actions.setTaskDone(t.id, e.target.checked)} aria-label={t.completed_at ? `Reopen ${t.title}` : `Complete ${t.title}`} />
                  <div className="grow">
                    <div className="title">{t.title}</div>
                    {t.description && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{t.description}</div>}
                    <div className="small row wrap" style={{ gap: 10, marginTop: 4 }}>
                      {s && <SubjectDot color={s.color} name={s.name} />}
                      {t.priority !== 'normal' && <span className={`chip ${t.priority === 'high' ? 'pill-high' : 'pill-low'}`}>{t.priority} priority</span>}
                      {t.due_date && <span className={k === 'overdue' ? 'pill-overdue' : 'muted'}>{k === 'overdue' ? 'Overdue · ' : 'Due '}{formatDay(t.due_date)}</span>}
                    </div>
                  </div>
                  <button className="btn ghost icon sm" aria-label={`Edit ${t.title}`} onClick={() => setEditing(t)}><Icon name="edit" /></button>
                  <button className="btn ghost icon sm" aria-label={`Delete ${t.title}`} onClick={() => void remove(t)}><Icon name="trash" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing && <TaskForm task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TaskForm({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { sync, actions } = useData();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [subjectId, setSubjectId] = useState(task?.subject_id ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'normal');
  const [due, setDue] = useState(task?.due_date ?? '');
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Give the task a title.');
    const input = { title, description, subject_id: subjectId || null, priority, due_date: due || null };
    if (task) actions.updateTask(task.id, input);
    else actions.addTask(input);
    onClose();
  };

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid" noValidate>
        <div className="full"><Field label="Title" error={err}>{(id) => <input id={id} className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field></div>
        <div className="full"><Field label="Description (optional)">{(id) => <textarea id={id} className="input" value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />}</Field></div>
        <Field label="Subject">{(id) => (
          <select id={id} className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">No subject</option>
            {sync.lists.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}</Field>
        <Field label="Priority">{(id) => (
          <select id={id} className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
          </select>
        )}</Field>
        <Field label="Deadline">{(id) => <input id={id} className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        <div className="full modal-actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit">{task ? 'Save changes' : 'Add task'}</button>
        </div>
      </form>
    </Modal>
  );
}

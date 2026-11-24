import { useMemo, useState, type FormEvent } from 'react';
import { useData } from '../data/DataProvider';
import type { Reflection } from '../lib/types';
import { formatDay } from '../lib/dates';
import { EmptyState, Field, Modal, PageHead, useConfirm } from '../components/ui';
import { Icon } from '../components/Icon';

type Filter = 'all' | 'reflection' | 'note';

export function Reflections() {
  const { sync, actions, today } = useData();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Reflection | 'new' | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sync.lists.reflections
      .filter((r) => (filter === 'all' || r.kind === filter) && (!date || r.entry_date === date) && (!q || `${r.title} ${r.body}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.entry_date === b.entry_date ? (a.created_at < b.created_at ? 1 : -1) : a.entry_date < b.entry_date ? 1 : -1));
  }, [sync.lists.reflections, filter, query, date]);

  const groups = useMemo(() => {
    const m = new Map<string, Reflection[]>();
    for (const r of entries) m.set(r.entry_date, [...(m.get(r.entry_date) ?? []), r]);
    return [...m.entries()];
  }, [entries]);

  const remove = async (r: Reflection) => {
    if (await confirm({ title: 'Delete this entry?', body: `“${r.title || formatDay(r.entry_date)}” will be removed from your account on every device.`, confirmLabel: 'Delete', danger: true })) actions.deleteReflection(r.id);
  };

  const total = sync.lists.reflections.length;
  const filtering = filter !== 'all' || query || date;

  return (
    <>
      <PageHead
        title="Reflections"
        sub="One win, one thing to carry forward. Private to your account."
        actions={<button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" /> New entry</button>}
      />

      {total > 0 && (
        <div className="row wrap" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
          <div className="seg" role="group" aria-label="Entry type">
            {(['all', 'reflection', 'note'] as Filter[]).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'reflection' ? 'Reflections' : 'Notes'}</button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Field label="Search">{(id) => <input id={id} className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your entries" />}</Field>
          </div>
          <Field label="Jump to date">{(id) => <input id={id} className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />}</Field>
          {filtering && <button className="btn ghost" onClick={() => { setFilter('all'); setQuery(''); setDate(''); }}>Clear</button>}
        </div>
      )}

      {groups.length === 0 ? (
        <section className="card">
          <EmptyState title={total === 0 ? 'No entries yet' : 'No entries match'} action={total === 0 ? <button className="btn primary" onClick={() => setEditing('new')}>Write today’s reflection</button> : undefined}>
            {total === 0 ? 'A few honest lines at the end of the day is plenty.' : 'Try clearing the filters.'}
          </EmptyState>
        </section>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          {groups.map(([d, list]) => (
            <section key={d} aria-label={formatDay(d)}>
              <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>{formatDay(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}{d === today ? ' · Today' : ''}</h2>
              <div className="stack">
                {list.map((r) => (
                  <article key={r.id} className="card">
                    <div className="row between" style={{ alignItems: 'flex-start' }}>
                      <div>
                        <span className="chip">{r.kind === 'note' ? 'Note' : 'Reflection'}</span>
                        {r.title && <h3 style={{ marginTop: 8 }}>{r.title}</h3>}
                      </div>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="btn ghost icon sm" aria-label="Edit entry" onClick={() => setEditing(r)}><Icon name="edit" /></button>
                        <button className="btn ghost icon sm" aria-label="Delete entry" onClick={() => void remove(r)}><Icon name="trash" /></button>
                      </div>
                    </div>
                    {r.body && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>{r.body}</p>}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {editing && <EntryForm entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EntryForm({ entry, onClose }: { entry: Reflection | null; onClose: () => void }) {
  const { actions, today } = useData();
  const [entryDate, setEntryDate] = useState(entry?.entry_date ?? today);
  const [kind, setKind] = useState<'reflection' | 'note'>(entry?.kind ?? 'reflection');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [body, setBody] = useState(entry?.body ?? '');
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() && !title.trim()) return setErr('Write something first.');
    if (!entryDate) return setErr('Pick a date.');
    actions.saveReflection({ id: entry?.id, entry_date: entryDate, kind, title, body });
    onClose();
  };

  return (
    <Modal title={entry ? 'Edit entry' : 'New entry'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid" noValidate>
        <Field label="Date">{(id) => <input id={id} className="input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />}</Field>
        <Field label="Type">{(id) => (
          <select id={id} className="input" value={kind} onChange={(e) => setKind(e.target.value as 'reflection' | 'note')}>
            <option value="reflection">Daily reflection</option>
            <option value="note">Note</option>
          </select>
        )}</Field>
        <div className="full"><Field label="Title (optional)">{(id) => <input id={id} className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field></div>
        <div className="full">
          <Field label={kind === 'reflection' ? 'What worked? What will you carry forward?' : 'Note'} error={err}>
            {(id) => <textarea id={id} className="input" style={{ minHeight: 160 }} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />}
          </Field>
        </div>
        <div className="full modal-actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit">{entry ? 'Save changes' : 'Save entry'}</button>
        </div>
      </form>
    </Modal>
  );
}

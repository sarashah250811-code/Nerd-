import { useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { buildBackup, downloadJson, findLegacyData, mapLegacy } from '../lib/backup';
import { Icon } from './Icon';
import { COLLECTION_ORDER, type Collection } from '../lib/types';

const flag = (userId: string) => `nerd.v2.legacy-handled.${userId}`;

/**
 * Offers to move data from the older, browser-only version into the signed-in account.
 * Steps: detect -> offer backup -> migrate (never overwriting existing cloud rows) -> verify in the cloud.
 */
export function MigrationPrompt() {
  const { userId, engine, sync, tz, profile } = useData();
  const [handled, setHandled] = useState(() => {
    try {
      return localStorage.getItem(flag(userId)) === '1';
    } catch {
      return false;
    }
  });
  const candidate = useMemo(() => (handled ? null : findLegacyData()), [handled]);
  const [state, setState] = useState<{ kind: 'idle' | 'working' | 'done' | 'error'; msg?: string }>({ kind: 'idle' });

  if (!candidate || !sync.ready) return null;

  const markHandled = () => {
    try {
      localStorage.setItem(flag(userId), '1');
    } catch {
      /* ignore */
    }
    setHandled(true);
  };

  const backup = () =>
    downloadJson(`nerd-legacy-backup-${new Date().toISOString().slice(0, 10)}.json`, { source_key: candidate.key, raw: candidate.data });

  const migrate = async () => {
    setState({ kind: 'working' });
    try {
      const { bundle } = mapLegacy(candidate, tz);
      const added: Partial<Record<Collection, string[]>> = {};
      for (const c of COLLECTION_ORDER) {
        const rows = (bundle as any)[c] as any[] | undefined;
        if (!rows?.length) continue;
        const before = new Set(sync.lists[c].map((r) => r.id));
        const res = engine.bulkAdd(c, rows);
        added[c] = rows.filter((r) => !before.has(r.id)).map((r) => r.id);
        void res;
      }
      await engine.flush();
      if (engine.getState().pending > 0) throw new Error('Some records are still waiting to upload. Check your connection and try again; nothing was lost.');
      let expected = 0;
      let found = 0;
      for (const c of COLLECTION_ORDER) {
        const ids = added[c] ?? [];
        if (!ids.length) continue;
        expected += ids.length;
        found += await engine.countOnServer(c, ids);
      }
      if (found !== expected) throw new Error(`Verification failed: ${found} of ${expected} records were found in the cloud. Your local copy is untouched; try again.`);
      setState({ kind: 'done', msg: `Moved and verified ${expected} record${expected === 1 ? '' : 's'} in your account. Your original browser data was left untouched.` });
      markHandled();
      setTimeout(() => setState({ kind: 'idle' }), 8000);
    } catch (e) {
      setState({ kind: 'error', msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const { subjects, tasks, sessions } = candidate.counts;
  return (
    <section className="banner" aria-labelledby="mig-title" style={{ marginBottom: 18 }}>
      <h3 id="mig-title">Study data found in this browser</h3>
      <p className="small muted" style={{ margin: '4px 0 10px' }}>
        We found {subjects} subject{subjects === 1 ? '' : 's'}, {tasks} task{tasks === 1 ? '' : 's'} and {sessions} study log{sessions === 1 ? '' : 's'} saved here by the earlier version. You can move them into your account{profile ? ` (${profile.nerd_id})` : ''} so they sync everywhere. Existing cloud data is never overwritten, and importing twice will not create duplicates.
      </p>
      {state.kind === 'error' && <p className="error-text" role="alert">{state.msg}</p>}
      {state.kind === 'done' && <p role="status">{state.msg}</p>}
      <div className="row wrap">
        <button className="btn sm" onClick={backup}><Icon name="copy" /> Download a backup first</button>
        <button className="btn primary sm" onClick={() => void migrate()} disabled={state.kind === 'working'}>
          {state.kind === 'working' ? 'Moving…' : 'Move into my account'}
        </button>
        <button className="btn ghost sm" onClick={markHandled}>Not now</button>
      </div>
    </section>
  );
}

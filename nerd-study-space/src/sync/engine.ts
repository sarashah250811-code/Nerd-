import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import {
  COLLECTION_ORDER,
  DOC_TABLES,
  type Collection,
  type CollectionMap,
  type DocMap,
  type DocTable,
  type SyncStatus,
} from '../lib/types';
import { uuid } from '../lib/ids';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any> & { client_updated_at: string };
type TableName = Collection | DocTable;

export interface Notice {
  id: string;
  text: string;
  at: string;
}
export interface ConflictBackup {
  id: string;
  table: TableName;
  row: Row;
  at: string;
  reason: string;
}
export interface FailedWrite {
  key: string;
  table: TableName;
  id: string;
  label: string;
  message: string;
}

export interface SyncState {
  ready: boolean;
  status: SyncStatus;
  error: string | null;
  pending: number;
  lastSyncedAt: string | null;
  lists: { [K in Collection]: CollectionMap[K][] };
  docs: Partial<DocMap>;
  notices: Notice[];
  backups: ConflictBackup[];
  failed: FailedWrite[];
}

interface Cache {
  v: 1;
  userId: string;
  rows: Record<Collection, Row[]>;
  docs: Partial<Record<DocTable, Row>>;
  dirtyRows: Record<Collection, string[]>;
  dirtyDocs: DocTable[];
  cursors: Partial<Record<TableName, string>>;
  lastSyncedAt: string | null;
  backups: ConflictBackup[];
  failed: FailedWrite[];
}

const CACHE_PREFIX = 'nerd.v2.cache.';
export const cacheKey = (userId: string) => CACHE_PREFIX + userId;
const PAGE = 1000;
const PUSH_BATCH = 50;
const PULL_OVERLAP_MS = 60_000; // re-read a minute before the cursor: commit-order safety
const RETRY_DELAYS = [2000, 5000, 15000, 30000, 60000];
const MAX_BACKUPS = 50;

const docKey = (t: DocTable) => (t === 'profiles' ? 'id' : 'user_id');
const ts = (s: string | undefined | null) => (s ? Date.parse(s) : 0);

class NetworkError extends Error {}
class AuthExpiredError extends Error {}
class RowRejected extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

function looksLikeNetwork(err: any): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(err?.message ?? err ?? '');
  return (
    err?.name === 'TypeError' ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|ECONN|ENOTFOUND/i.test(msg) ||
    err?.status === 0
  );
}
const looksLikeAuth = (err: any) =>
  err?.status === 401 || err?.code === 'PGRST301' || /jwt (is )?expired|invalid jwt|not authenticated/i.test(String(err?.message ?? ''));

/** Errors where retrying the same payload can never succeed. */
const isPermanent = (err: any) => /^(22|23|42)/.test(String(err?.code ?? '')) || /^PGRST1\d\d$/.test(String(err?.code ?? ''));

function labelFor(table: TableName, row: Row): string {
  const base = row.title || row.name || row.entry_date || row.display_name || row.id;
  return `${table.replace('_', ' ')}: ${String(base).slice(0, 40)}`;
}

/**
 * Local-first sync engine.
 *
 *  - Every edit is applied to the local cache immediately and queued ("dirty").
 *  - Dirty rows are pushed to Supabase with idempotent upserts (client-made UUIDs).
 *  - Conflicts: last-writer-wins on `client_updated_at`. The database refuses stale
 *    writes, and when a newer remote version replaces an unsent local edit the local
 *    copy is kept in `backups` and the user is told. Nothing is dropped silently.
 *  - Offline: edits stay in the cache + queue, and flush on reconnect.
 *  - Realtime pushes remote changes instantly; polling/focus pulls are the fallback.
 */
export class SyncEngine {
  private rows: Record<Collection, Map<string, Row>> = {
    subjects: new Map(),
    goals: new Map(),
    tasks: new Map(),
    study_sessions: new Map(),
    reflections: new Map(),
  };
  private docs: Partial<Record<DocTable, Row>> = {};
  private dirtyRows: Record<Collection, Set<string>> = {
    subjects: new Set(),
    goals: new Set(),
    tasks: new Set(),
    study_sessions: new Set(),
    reflections: new Set(),
  };
  private dirtyDocs = new Set<DocTable>();
  private cursors: Partial<Record<TableName, string>> = {};
  private failed = new Map<string, FailedWrite>();
  private backups: ConflictBackup[] = [];
  private notices: Notice[] = [];
  private lastSyncedAt: string | null = null;

  private ready = false;
  private flushing = false;
  private flushAgain = false;
  private pulling = false;
  private lastError: string | null = null;
  private offline = false;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private channel: RealtimeChannel | null = null;
  private stopped = false;
  private quotaWarned = false;

  private listeners = new Set<() => void>();
  private snapshot: SyncState;

  constructor(private client: SupabaseClient, readonly userId: string) {
    this.snapshot = this.buildState();
  }

  /* ------------------------------------------------------------------ */
  /* external-store plumbing                                            */
  /* ------------------------------------------------------------------ */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.snapshot;

  private emit() {
    this.snapshot = this.buildState();
    this.listeners.forEach((l) => l());
    this.schedulePersist();
  }

  private pendingCount() {
    let n = this.dirtyDocs.size;
    for (const c of COLLECTION_ORDER) n += this.dirtyRows[c].size;
    return n;
  }

  private computeStatus(): SyncStatus {
    if (this.offline || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'offline';
    if (this.lastError || this.failed.size > 0) return 'error';
    if (this.pendingCount() > 0 || this.flushing || this.pulling) return 'saving';
    return 'synced';
  }

  private buildState(): SyncState {
    const lists = {} as SyncState['lists'];
    for (const c of COLLECTION_ORDER) {
      (lists as any)[c] = [...this.rows[c].values()].filter((r) => !r.deleted_at);
    }
    return {
      ready: this.ready,
      status: this.computeStatus(),
      error: this.lastError ?? (this.failed.size ? `${this.failed.size} change(s) could not be saved` : null),
      pending: this.pendingCount(),
      lastSyncedAt: this.lastSyncedAt,
      lists,
      docs: { ...this.docs } as Partial<DocMap>,
      notices: [...this.notices],
      backups: [...this.backups],
      failed: [...this.failed.values()],
    };
  }

  /* ------------------------------------------------------------------ */
  /* local cache                                                         */
  /* ------------------------------------------------------------------ */
  private loadCache(): boolean {
    try {
      const raw = localStorage.getItem(cacheKey(this.userId));
      if (!raw) return false;
      const c = JSON.parse(raw) as Cache;
      if (c.v !== 1 || c.userId !== this.userId) return false;
      for (const k of COLLECTION_ORDER) {
        for (const r of c.rows?.[k] ?? []) this.rows[k].set(r.id, r);
        for (const id of c.dirtyRows?.[k] ?? []) if (this.rows[k].has(id)) this.dirtyRows[k].add(id);
      }
      this.docs = c.docs ?? {};
      for (const t of c.dirtyDocs ?? []) if (this.docs[t]) this.dirtyDocs.add(t);
      this.cursors = c.cursors ?? {};
      this.lastSyncedAt = c.lastSyncedAt ?? null;
      this.backups = c.backups ?? [];
      for (const f of c.failed ?? []) this.failed.set(f.key, f);
      return true;
    } catch {
      return false; // corrupt cache: fall back to a full cloud pull
    }
  }

  private schedulePersist() {
    if (this.persistTimer || this.stopped) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 150);
  }

  private persistNow() {
    const rows = {} as Cache['rows'];
    const dirtyRows = {} as Cache['dirtyRows'];
    for (const c of COLLECTION_ORDER) {
      rows[c] = [...this.rows[c].values()];
      dirtyRows[c] = [...this.dirtyRows[c]];
    }
    const cache: Cache = {
      v: 1,
      userId: this.userId,
      rows,
      docs: this.docs,
      dirtyRows,
      dirtyDocs: [...this.dirtyDocs],
      cursors: this.cursors,
      lastSyncedAt: this.lastSyncedAt,
      backups: this.backups,
      failed: [...this.failed.values()],
    };
    try {
      localStorage.setItem(cacheKey(this.userId), JSON.stringify(cache));
    } catch {
      if (!this.quotaWarned) {
        this.quotaWarned = true;
        this.notify('Your browser could not save the offline copy (storage full). Changes still sync while you are online.');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */
  async start() {
    const hadCache = this.loadCache();
    if (hadCache) {
      this.ready = true;
      this.emit();
    }
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, 45_000);

    await this.refresh();
    if (!this.ready) {
      this.ready = true; // offline first run: let the app open with empty data
      this.emit();
    }
    this.subscribeRealtime();
  }

  /** Stop all activity. If `clear` is true the offline cache is wiped (only when nothing is unsynced). */
  stop(clear = false) {
    if (this.stopped) return;
    this.stopped = true;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.channel) void this.client.removeChannel(this.channel);
    if (clear && this.pendingCount() === 0 && this.failed.size === 0) {
      try {
        localStorage.removeItem(cacheKey(this.userId));
      } catch {
        /* ignore */
      }
    } else {
      this.persistNow(); // keep unsynced work on this device for the next sign-in
    }
  }

  private onOnline = () => {
    this.offline = false;
    this.retryAttempt = 0;
    void this.refresh();
  };
  private onOffline = () => {
    this.offline = true;
    this.emit();
  };
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  /** Pull remote changes, then push local ones. Safe to call at any time. */
  async refresh() {
    if (this.stopped) return;
    try {
      this.pulling = true;
      this.emit();
      await this.pullAll();
      this.pulling = false;
      await this.flush();
    } catch (e) {
      this.pulling = false;
      this.handleError(e);
    }
  }

  /* ------------------------------------------------------------------ */
  /* pulling                                                             */
  /* ------------------------------------------------------------------ */
  private async pullAll() {
    for (const t of [...DOC_TABLES, ...COLLECTION_ORDER] as TableName[]) await this.pullTable(t);
    this.ready = true;
    this.markSynced();
  }

  private async pullTable(table: TableName) {
    const cursor = this.cursors[table];
    const since = cursor ? new Date(Math.max(0, ts(cursor) - PULL_OVERLAP_MS)).toISOString() : null;
    const order = (DOC_TABLES as string[]).includes(table) ? docKey(table as DocTable) : 'id';
    let from = 0;
    let maxSeen = cursor ?? '';
    for (;;) {
      let q = this.client.from(table).select('*').order('updated_at', { ascending: true }).order(order, { ascending: true });
      if (since) q = q.gte('updated_at', since);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data ?? []) {
        this.applyRemote(table, r as Row);
        if ((r as Row).updated_at && String((r as Row).updated_at) > maxSeen) maxSeen = String((r as Row).updated_at);
      }
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    if (maxSeen) this.cursors[table] = maxSeen;
  }

  /** Merge one row received from the server (pull, realtime, or post-push check). */
  private applyRemote(table: TableName, remote: Row) {
    if ((DOC_TABLES as string[]).includes(table)) {
      const t = table as DocTable;
      const local = this.docs[t];
      if (!local) {
        this.docs[t] = remote;
      } else if (this.dirtyDocs.has(t)) {
        const lc = ts(local.client_updated_at);
        const rc = ts(remote.client_updated_at);
        if (lc > rc) {
          // keep ours; it will be pushed
        } else if (lc === rc) {
          this.docs[t] = remote;
          this.dirtyDocs.delete(t);
        } else {
          this.keepBackup(t, local, 'A newer version of this setting from another device replaced an unsent change on this one.');
          this.docs[t] = remote;
          this.dirtyDocs.delete(t);
          this.notify('A newer change to your settings from another device replaced an unsent edit here. The older edit is saved under Sync & data → Recovery.');
        }
      } else if (ts(remote.client_updated_at) >= ts(local.client_updated_at)) {
        this.docs[t] = remote;
      }
      this.emit();
      return;
    }

    const c = table as Collection;
    const local = this.rows[c].get(remote.id);
    if (!local) {
      this.rows[c].set(remote.id, remote);
    } else if (this.dirtyRows[c].has(remote.id)) {
      const lc = ts(local.client_updated_at);
      const rc = ts(remote.client_updated_at);
      if (lc > rc) {
        // keep ours
      } else if (lc === rc) {
        this.rows[c].set(remote.id, remote);
        this.dirtyRows[c].delete(remote.id);
      } else {
        this.keepBackup(c, local, 'A newer version from another device replaced an unsent edit on this device.');
        this.rows[c].set(remote.id, remote);
        this.dirtyRows[c].delete(remote.id);
        this.failed.delete(`${c}:${remote.id}`);
        this.notify(`"${String(remote.title ?? remote.name ?? 'An item')}" was changed on another device more recently, so that version was kept. Your older edit is saved under Sync & data → Recovery.`);
      }
    } else if (ts(remote.client_updated_at) >= ts(local.client_updated_at)) {
      this.rows[c].set(remote.id, remote);
    }
    this.emit();
  }

  private applyRemoteDelete(table: TableName, id: string) {
    if ((DOC_TABLES as string[]).includes(table)) return;
    const c = table as Collection;
    if (this.rows[c].has(id) && !this.dirtyRows[c].has(id)) {
      this.rows[c].delete(id);
      this.emit();
    }
  }

  private keepBackup(table: TableName, row: Row, reason: string) {
    this.backups.unshift({ id: uuid(), table, row, at: new Date().toISOString(), reason });
    this.backups = this.backups.slice(0, MAX_BACKUPS);
  }

  /* ------------------------------------------------------------------ */
  /* realtime                                                            */
  /* ------------------------------------------------------------------ */
  private subscribeRealtime() {
    if (this.stopped) return;
    try {
      const ch = this.client.channel(`nerd-sync-${this.userId}`);
      for (const table of [...DOC_TABLES, ...COLLECTION_ORDER] as TableName[]) {
        const filter = table === 'profiles' ? `id=eq.${this.userId}` : `user_id=eq.${this.userId}`;
        ch.on('postgres_changes' as any, { event: '*', schema: 'public', table, filter } as any, (payload: any) => {
          if (payload.eventType === 'DELETE') this.applyRemoteDelete(table, payload.old?.id);
          else if (payload.new) this.applyRemote(table, payload.new as Row);
        });
      }
      ch.subscribe();
      this.channel = ch;
    } catch {
      /* realtime is an optimisation; polling still works */
    }
  }

  /* ------------------------------------------------------------------ */
  /* local mutations                                                     */
  /* ------------------------------------------------------------------ */
  private stamp(prev?: string) {
    const now = Date.now();
    return new Date(Math.max(now, ts(prev) + 1)).toISOString();
  }

  /** Create or fully replace a record. */
  put<K extends Collection>(table: K, row: CollectionMap[K]) {
    const prev = this.rows[table].get(row.id);
    const next = { ...row, client_updated_at: this.stamp(prev?.client_updated_at) } as unknown as Row;
    this.rows[table].set(row.id, next);
    this.dirtyRows[table].add(row.id);
    this.failed.delete(`${table}:${row.id}`);
    this.afterLocalWrite();
  }

  /** Merge changes into an existing record. */
  patch<K extends Collection>(table: K, id: string, changes: Partial<CollectionMap[K]>) {
    const prev = this.rows[table].get(id);
    if (!prev) return;
    this.put(table, { ...(prev as any), ...changes } as CollectionMap[K]);
  }

  /** Soft delete so the deletion syncs to other devices. */
  remove(table: Collection, id: string) {
    const prev = this.rows[table].get(id);
    if (!prev) return;
    const now = new Date().toISOString();
    this.put(table, { ...(prev as any), deleted_at: now } as any);
  }

  /** Bulk insert for import/migration. Existing ids are skipped, never overwritten. */
  bulkAdd<K extends Collection>(table: K, rows: CollectionMap[K][]): { added: number; skipped: number } {
    let added = 0;
    let skipped = 0;
    for (const r of rows) {
      if (this.rows[table].has(r.id)) {
        skipped++;
        continue;
      }
      this.rows[table].set(r.id, { ...(r as any) });
      this.dirtyRows[table].add(r.id);
      added++;
    }
    this.afterLocalWrite();
    return { added, skipped };
  }

  updateDoc<T extends DocTable>(table: T, changes: Partial<DocMap[T]>, fallback?: DocMap[T]) {
    const prev = (this.docs[table] ?? fallback) as Row | undefined;
    if (!prev) return;
    this.docs[table] = { ...prev, ...(changes as any), client_updated_at: this.stamp(prev.client_updated_at) };
    this.dirtyDocs.add(table);
    this.afterLocalWrite();
  }

  private afterLocalWrite() {
    this.emit();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 400);
  }

  /* ------------------------------------------------------------------ */
  /* pushing                                                             */
  /* ------------------------------------------------------------------ */
  async flush() {
    if (this.stopped) return;
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.offline = true;
      this.emit();
      return;
    }
    this.flushing = true;
    this.emit();
    try {
      for (const t of COLLECTION_ORDER) await this.pushCollection(t);
      await this.pushDocs();
      this.lastError = null;
      this.offline = false;
      this.retryAttempt = 0;
      this.markSynced();
    } catch (e) {
      this.handleError(e);
    } finally {
      this.flushing = false;
      if (this.flushAgain && !this.stopped) {
        this.flushAgain = false;
        void this.flush();
      } else {
        this.emit();
      }
    }
  }

  private markSynced() {
    if (this.pendingCount() === 0) this.lastSyncedAt = new Date().toISOString();
    if (!this.failed.size) this.lastError = null;
    this.offline = false;
    this.emit();
  }

  private pending(table: Collection): Row[] {
    return [...this.dirtyRows[table]]
      .filter((id) => !this.failed.has(`${table}:${id}`))
      .map((id) => this.rows[table].get(id))
      .filter(Boolean) as Row[];
  }

  private async pushCollection(table: Collection) {
    const rows = this.pending(table);
    for (let i = 0; i < rows.length; i += PUSH_BATCH) {
      const chunk = rows.slice(i, i + PUSH_BATCH);
      try {
        await this.pushChunk(table, chunk);
      } catch (e) {
        if (e instanceof NetworkError || e instanceof AuthExpiredError) throw e;
        // A bad row must not block the rest of the queue: isolate it.
        if (chunk.length > 1) {
          for (const r of chunk) {
            try {
              await this.pushChunk(table, [r]);
            } catch (e2) {
              if (e2 instanceof NetworkError || e2 instanceof AuthExpiredError) throw e2;
              this.rejectRow(table, r, e2);
            }
          }
        } else {
          this.rejectRow(table, chunk[0], e);
        }
      }
    }
  }

  private rejectRow(table: TableName, row: Row, e: any) {
    const id = row.id ?? row.user_id;
    const key = `${table}:${id}`;
    this.failed.set(key, { key, table, id, label: labelFor(table, row), message: String(e?.message ?? e) });
    this.emit();
  }

  private async pushChunk(table: Collection, chunk: Row[]) {
    const payload = chunk.map(({ user_id: _u, updated_at: _s, ...rest }) => rest);
    const { data, error } = await this.client.from(table).upsert(payload, { onConflict: 'id' }).select('id, updated_at, client_updated_at');
    if (error) await this.raise(error);
    const accepted = new Map<string, Row>((data ?? []).map((r: any) => [r.id, r]));
    const rejectedStale: string[] = [];
    for (const sent of chunk) {
      const ack = accepted.get(sent.id);
      if (!ack) {
        rejectedStale.push(sent.id);
        continue;
      }
      const cur = this.rows[table].get(sent.id);
      if (cur) {
        cur.updated_at = ack.updated_at;
        if (cur.client_updated_at === sent.client_updated_at) this.dirtyRows[table].delete(sent.id);
      }
    }
    if (rejectedStale.length) await this.reconcileStale(table, rejectedStale);
    this.emit();
  }

  /** The server skipped these rows (a newer version exists). Fetch it and let the merge rules decide. */
  private async reconcileStale(table: Collection, ids: string[]) {
    const { data, error } = await this.client.from(table).select('*').in('id', ids);
    if (error) await this.raise(error);
    const found = new Set<string>();
    for (const r of data ?? []) {
      found.add((r as Row).id);
      this.applyRemote(table, r as Row);
    }
    for (const id of ids) {
      if (!found.has(id) && this.dirtyRows[table].has(id)) {
        const row = this.rows[table].get(id)!;
        this.rejectRow(table, row, new Error('The server did not accept this change.'));
      }
    }
  }

  private async pushDocs() {
    for (const t of [...this.dirtyDocs]) {
      const doc = this.docs[t];
      if (!doc) {
        this.dirtyDocs.delete(t);
        continue;
      }
      let res: { data: any[] | null; error: any };
      if (t === 'profiles') {
        res = (await this.client
          .from('profiles')
          .update({ display_name: doc.display_name, client_updated_at: doc.client_updated_at })
          .eq('id', this.userId)
          .select('id, updated_at, client_updated_at')) as any;
      } else {
        const { updated_at: _s, created_at: _c, ...rest } = doc;
        res = (await this.client
          .from(t)
          .upsert({ ...rest, user_id: this.userId }, { onConflict: 'user_id' })
          .select('user_id, updated_at, client_updated_at')) as any;
      }
      if (res.error) {
        try {
          await this.raise(res.error);
        } catch (e) {
          if (e instanceof NetworkError || e instanceof AuthExpiredError) throw e;
          this.rejectRow(t, doc, e);
          this.dirtyDocs.delete(t);
          continue;
        }
      }
      if (!res.data || res.data.length === 0) {
        // stale: the server holds a newer copy
        const { data, error } = await this.client.from(t).select('*').eq(docKey(t), this.userId);
        if (error) await this.raise(error);
        for (const r of data ?? []) this.applyRemote(t, r as Row);
      } else {
        const cur = this.docs[t];
        if (cur && cur.client_updated_at === doc.client_updated_at) {
          cur.updated_at = res.data[0].updated_at;
          this.dirtyDocs.delete(t);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* errors & retry                                                      */
  /* ------------------------------------------------------------------ */
  private async raise(error: any): Promise<never> {
    if (looksLikeAuth(error)) {
      const { error: refreshErr } = await this.client.auth.refreshSession();
      if (refreshErr) throw new AuthExpiredError('Your session expired. Please sign in again.');
      throw new NetworkError('Session refreshed, retrying'); // retried by the backoff timer
    }
    if (looksLikeNetwork(error)) throw new NetworkError(String(error?.message ?? 'Network unavailable'));
    if (isPermanent(error)) throw new RowRejected(String(error?.message ?? error), error?.code);
    throw error;
  }

  private handleError(e: any) {
    if (this.stopped) return;
    if (e instanceof AuthExpiredError) {
      this.lastError = e.message;
    } else if (e instanceof NetworkError || looksLikeNetwork(e)) {
      this.offline = true;
      this.lastError = null;
    } else {
      this.lastError = String(e?.message ?? e ?? 'Unknown sync error');
    }
    this.emit();
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.retryTimer || this.stopped) return;
    const delay = RETRY_DELAYS[Math.min(this.retryAttempt, RETRY_DELAYS.length - 1)];
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.refresh();
    }, delay);
  }

  /* ------------------------------------------------------------------ */
  /* recovery & utilities                                                */
  /* ------------------------------------------------------------------ */
  retryNow() {
    this.lastError = null;
    this.retryAttempt = 0;
    this.failed.clear();
    this.emit();
    return this.refresh();
  }

  discardFailed(key: string) {
    const f = this.failed.get(key);
    if (!f) return;
    this.failed.delete(key);
    if ((COLLECTION_ORDER as string[]).includes(f.table)) this.dirtyRows[f.table as Collection].delete(f.id);
    else this.dirtyDocs.delete(f.table as DocTable);
    this.emit();
  }

  /** Re-apply a conflict backup as a fresh edit (newer timestamp, so it wins). */
  restoreBackup(id: string) {
    const b = this.backups.find((x) => x.id === id);
    if (!b) return;
    if ((COLLECTION_ORDER as string[]).includes(b.table)) {
      this.put(b.table as Collection, { ...(b.row as any), deleted_at: null });
    } else {
      this.updateDoc(b.table as DocTable, b.row as any);
    }
    this.backups = this.backups.filter((x) => x.id !== id);
    this.emit();
  }
  dropBackup(id: string) {
    this.backups = this.backups.filter((x) => x.id !== id);
    this.emit();
  }

  /** How many of these ids are actually stored in the cloud (used to verify a migration). */
  async countOnServer(table: Collection, ids: string[]): Promise<number> {
    let n = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await this.client.from(table).select('id').in('id', ids.slice(i, i + 200));
      if (error) throw error;
      n += data?.length ?? 0;
    }
    return n;
  }

  notify(text: string) {
    this.notices = [...this.notices, { id: uuid(), text, at: new Date().toISOString() }].slice(-5);
    this.emit();
  }
  dismissNotice(id: string) {
    this.notices = this.notices.filter((n) => n.id !== id);
    this.emit();
  }

  /** Every live record, for export. */
  exportAll() {
    const out: Record<string, unknown> = {};
    for (const c of COLLECTION_ORDER) out[c] = [...this.rows[c].values()].filter((r) => !r.deleted_at);
    return { collections: out, docs: this.docs };
  }
}

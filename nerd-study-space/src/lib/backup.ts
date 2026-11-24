import type { Goal, Preferences, Reflection, StudySession, Subject, Task, TimerSettings } from './types';
import { isThemeId } from './themes';
import { isUuid, stableId, uuid } from './ids';
import { dayKey, isValidDayKey } from './dates';

/** ------------------------------------------------------------------
 * JSON backup format
 * { app: "nerd", format: 1, exported_at, nerd_id, data: { subjects, tasks, goals,
 *   study_sessions, reflections, user_preferences, timer_settings } }
 * ------------------------------------------------------------------ */
export const BACKUP_FORMAT = 1;

export interface ImportBundle {
  subjects: Subject[];
  tasks: Task[];
  goals: Goal[];
  study_sessions: StudySession[];
  reflections: Reflection[];
  user_preferences?: Partial<Preferences>;
  timer_settings?: Partial<TimerSettings>;
}
export interface ImportResult {
  bundle: ImportBundle;
  warnings: string[];
  counts: Record<string, number>;
}

const NOW = () => new Date().toISOString();
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const iso = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
const color = (v: unknown, fallback = '#8a5a2b') => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);

function base(raw: Record<string, any>, nsKey: string, idx: number) {
  const created = iso(raw.created_at) ?? NOW();
  return {
    id: isUuid(raw.id) ? raw.id : stableId(nsKey, `${idx}:${JSON.stringify(raw).slice(0, 400)}`),
    created_at: created,
    client_updated_at: NOW(),
    deleted_at: null,
  };
}

/** Validate + normalise an imported file. Invalid rows are dropped and reported. */
export function parseBackup(text: string, tz: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isObj(json) || json.app !== 'nerd' || !isObj(json.data)) {
    throw new Error('This does not look like a Nerd backup (missing "app": "nerd" or "data").');
  }
  if (typeof json.format === 'number' && json.format > BACKUP_FORMAT) {
    throw new Error('This backup was made by a newer version of Nerd.');
  }
  return normaliseBundle(json.data as Record<string, unknown>, tz, 'nerd-import');
}

export function normaliseBundle(data: Record<string, unknown>, tz: string, ns: string): ImportResult {
  const warnings: string[] = [];
  const arr = (k: string): any[] => (Array.isArray(data[k]) ? (data[k] as any[]) : []);
  let dropped = 0;

  const subjects: Subject[] = [];
  arr('subjects').forEach((r, i) => {
    if (!isObj(r) || !str(r.name, 60).trim()) return void dropped++;
    subjects.push({ ...base(r, ns + ':subject', i), name: str(r.name, 60).trim(), color: color(r.color), sort_order: Math.round(num(r.sort_order, -1e6, 1e6, i)) });
  });
  const subjectIds = new Set(subjects.map((s) => s.id));
  const subjRef = (v: unknown) => (isUuid(v) && subjectIds.has(v) ? v : null);

  const tasks: Task[] = [];
  arr('tasks').forEach((r, i) => {
    if (!isObj(r) || !str(r.title, 200).trim()) return void dropped++;
    tasks.push({
      ...base(r, ns + ':task', i),
      title: str(r.title, 200).trim(),
      description: str(r.description, 5000),
      subject_id: subjRef(r.subject_id),
      priority: ['low', 'normal', 'high'].includes(r.priority) ? r.priority : 'normal',
      due_date: isValidDayKey(r.due_date) ? r.due_date : null,
      completed_at: iso(r.completed_at),
    });
  });

  const goals: Goal[] = [];
  arr('goals').forEach((r, i) => {
    if (!isObj(r) || !str(r.title, 200).trim() || !isValidDayKey(r.start_date) || !isValidDayKey(r.end_date) || r.end_date < r.start_date) return void dropped++;
    goals.push({
      ...base(r, ns + ':goal', i),
      title: str(r.title, 200).trim(),
      description: str(r.description, 2000),
      period: ['daily', 'weekly', 'monthly'].includes(r.period) ? r.period : 'weekly',
      metric: ['minutes', 'sessions', 'tasks', 'manual'].includes(r.metric) ? r.metric : 'minutes',
      target_value: num(r.target_value, 0.01, 1e6, 1),
      current_value: num(r.current_value, 0, 1e6, 0),
      subject_id: subjRef(r.subject_id),
      start_date: r.start_date,
      end_date: r.end_date,
      completed_at: iso(r.completed_at),
    });
  });

  const study_sessions: StudySession[] = [];
  arr('study_sessions').forEach((r, i) => {
    if (!isObj(r)) return void dropped++;
    const started = iso(r.started_at);
    const ended = iso(r.ended_at);
    const dur = Math.round(num(r.duration_seconds, 0, 86400, 0));
    if (!started || !ended || dur < 1 || ended < started) return void dropped++;
    study_sessions.push({
      ...base(r, ns + ':session', i),
      subject_id: subjRef(r.subject_id),
      session_type: ['focus', 'short_break', 'long_break', 'manual'].includes(r.session_type) ? r.session_type : 'focus',
      started_at: started,
      ended_at: ended,
      duration_seconds: dur,
      planned_seconds: r.planned_seconds == null ? null : Math.round(num(r.planned_seconds, 1, 86400, dur)),
      local_date: isValidDayKey(r.local_date) ? r.local_date : dayKey(started, tz),
      completed: r.completed !== false,
      note: str(r.note, 1000),
    });
  });

  const reflections: Reflection[] = [];
  arr('reflections').forEach((r, i) => {
    if (!isObj(r) || !isValidDayKey(r.entry_date) || !(str(r.body, 20000).trim() || str(r.title, 200).trim())) return void dropped++;
    reflections.push({
      ...base(r, ns + ':reflection', i),
      entry_date: r.entry_date,
      kind: r.kind === 'note' ? 'note' : 'reflection',
      title: str(r.title, 200),
      body: str(r.body, 20000),
    });
  });

  const out: ImportBundle = { subjects, tasks, goals, study_sessions, reflections };

  if (isObj(data.user_preferences)) {
    const p = data.user_preferences;
    out.user_preferences = {
      ...(isThemeId(p.theme) ? { theme: p.theme } : {}),
      daily_target_minutes: Math.round(num(p.daily_target_minutes, 0, 1440, 120)),
      sound_enabled: p.sound_enabled !== false,
    };
  }
  if (isObj(data.timer_settings)) {
    const t = data.timer_settings;
    out.timer_settings = {
      focus_minutes: Math.round(num(t.focus_minutes, 1, 180, 25)),
      short_break_minutes: Math.round(num(t.short_break_minutes, 1, 60, 5)),
      long_break_minutes: Math.round(num(t.long_break_minutes, 1, 120, 15)),
      sessions_until_long_break: Math.round(num(t.sessions_until_long_break, 2, 12, 4)),
    };
  }
  if (dropped) warnings.push(`${dropped} invalid record(s) were skipped.`);
  const counts = {
    subjects: subjects.length,
    tasks: tasks.length,
    goals: goals.length,
    study_sessions: study_sessions.length,
    reflections: reflections.length,
  };
  return { bundle: out, warnings, counts };
}

export function buildBackup(nerdId: string | undefined, all: { collections: Record<string, unknown>; docs: Record<string, unknown> }) {
  const prefs = all.docs.user_preferences as Record<string, unknown> | undefined;
  const timer = all.docs.timer_settings as Record<string, unknown> | undefined;
  const strip = (o?: Record<string, unknown>) => {
    if (!o) return undefined;
    const { user_id: _u, updated_at: _s, created_at: _c, client_updated_at: _k, ...rest } = o;
    return rest;
  };
  const cleanRows = (rows: unknown) =>
    (Array.isArray(rows) ? rows : []).map((r: any) => {
      const { user_id: _u, updated_at: _s, ...rest } = r;
      return rest;
    });
  return {
    app: 'nerd',
    format: BACKUP_FORMAT,
    exported_at: NOW(),
    nerd_id: nerdId ?? null,
    data: {
      subjects: cleanRows(all.collections.subjects),
      tasks: cleanRows(all.collections.tasks),
      goals: cleanRows(all.collections.goals),
      study_sessions: cleanRows(all.collections.study_sessions),
      reflections: cleanRows(all.collections.reflections),
      user_preferences: strip(prefs),
      timer_settings: strip(timer),
    },
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** ------------------------------------------------------------------
 * Legacy (pre-account) browser data detection
 *
 * The earlier standalone version stored everything in this browser's
 * localStorage. We do not know its exact key names, so we look for any
 * non-Nerd-v2 key holding JSON with recognisable tasks / sessions / subjects
 * arrays and map them tolerantly. The user always sees a preview and can
 * download a backup before anything is migrated.
 * ------------------------------------------------------------------ */
export interface LegacyCandidate {
  key: string;
  counts: { subjects: number; tasks: number; sessions: number };
  data: Record<string, any>;
}

export function findLegacyData(): LegacyCandidate | null {
  let best: LegacyCandidate | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.startsWith('nerd.v2.') || key.startsWith('sb-')) continue;
      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 20 || (raw[0] !== '{' && raw[0] !== '[')) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const o = Array.isArray(parsed) ? null : parsed;
      if (!o || typeof o !== 'object') continue;
      const pick = (...names: string[]) => names.map((n) => o[n]).find((v) => Array.isArray(v)) ?? [];
      const subjects = pick('subjects', 'subjectList');
      const tasks = pick('tasks', 'todos', 'todoList');
      const sessions = pick('sessions', 'studySessions', 'logs', 'studyLogs');
      const total = subjects.length + tasks.length + sessions.length;
      if (total === 0) continue;
      if (!best || total > best.counts.subjects + best.counts.tasks + best.counts.sessions) {
        best = { key, counts: { subjects: subjects.length, tasks: tasks.length, sessions: sessions.length }, data: { subjects, tasks, sessions } };
      }
    }
  } catch {
    return null;
  }
  return best;
}

export function mapLegacy(c: LegacyCandidate, tz: string): ImportResult {
  const ns = `legacy:${c.key}`;
  const subjectNames = new Map<string, string>();
  const subjects = (c.data.subjects as any[])
    .map((s, i) => {
      const name = typeof s === 'string' ? s : s?.name ?? s?.title;
      if (typeof name !== 'string' || !name.trim()) return null;
      const id = stableId(ns + ':subject', name.trim().toLowerCase());
      subjectNames.set(name.trim().toLowerCase(), id);
      return { id, name: name.trim(), color: color(s?.color), sort_order: i, created_at: NOW() };
    })
    .filter(Boolean);
  const subjectOf = (v: unknown) => {
    const n = typeof v === 'string' ? v : (v as any)?.name;
    return typeof n === 'string' ? subjectNames.get(n.trim().toLowerCase()) ?? null : null;
  };
  const tasks = (c.data.tasks as any[]).map((t, i) => {
    const title = typeof t === 'string' ? t : t?.title ?? t?.text ?? t?.name ?? t?.task;
    const done = !!(t?.done ?? t?.completed ?? t?.checked);
    const due = t?.due_date ?? t?.due ?? t?.deadline ?? t?.date;
    return {
      id: stableId(ns + ':task', `${i}:${title}`),
      title,
      description: t?.description ?? t?.notes ?? '',
      subject_id: subjectOf(t?.subject),
      priority: String(t?.priority ?? 'normal').toLowerCase(),
      due_date: typeof due === 'string' ? due.slice(0, 10) : null,
      completed_at: done ? iso(t?.completed_at ?? t?.completedAt ?? t?.doneAt) ?? NOW() : null,
      created_at: iso(t?.created_at ?? t?.createdAt),
    };
  });
  const sessions = (c.data.sessions as any[]).map((s, i) => {
    const minutes = Number(s?.minutes ?? s?.duration ?? s?.mins ?? (s?.duration_seconds ? s.duration_seconds / 60 : 0));
    const when = iso(s?.ended_at ?? s?.timestamp ?? s?.ts ?? s?.date ?? s?.createdAt) ?? NOW();
    const end = new Date(when);
    const start = new Date(end.getTime() - Math.max(0, minutes) * 60000);
    return {
      id: stableId(ns + ':session', `${i}:${when}:${minutes}`),
      subject_id: subjectOf(s?.subject),
      session_type: 'manual',
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      duration_seconds: Math.round(minutes * 60),
      planned_seconds: null,
      local_date: dayKey(end, tz),
      completed: true,
      note: String(s?.note ?? ''),
    };
  });
  return normaliseBundle({ subjects, tasks, study_sessions: sessions }, tz, ns);
}

export const newId = uuid;

import type { Goal, StudySession, Task, GoalPeriod } from './types';
import { addDays, dayKey, diffDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from './dates';

/**
 * Everything here is derived from the user's real records. Only sessions that
 * were completed (a full timer run or a manual log) count as study time;
 * breaks and abandoned timers never do.
 */
export const isStudy = (s: StudySession) =>
  !s.deleted_at && s.completed && (s.session_type === 'focus' || s.session_type === 'manual');

export const studySessions = (all: StudySession[]) => all.filter(isStudy);

export function minutesByDay(sessions: StudySession[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) m.set(s.local_date, (m.get(s.local_date) ?? 0) + s.duration_seconds / 60);
  return m;
}

export function sumRange(byDay: Map<string, number>, start: string, end: string): number {
  let t = 0;
  for (const [k, v] of byDay) if (k >= start && k <= end) t += v;
  return t;
}

export function focusSessionCount(sessions: StudySession[], start?: string, end?: string): number {
  return sessions.filter(
    (s) => s.session_type === 'focus' && (!start || s.local_date >= start) && (!end || s.local_date <= end),
  ).length;
}

export interface SubjectTotal {
  subjectId: string | null;
  minutes: number;
}
export function subjectTotals(sessions: StudySession[], start?: string, end?: string): SubjectTotal[] {
  const m = new Map<string | null, number>();
  for (const s of sessions) {
    if (start && s.local_date < start) continue;
    if (end && s.local_date > end) continue;
    m.set(s.subject_id, (m.get(s.subject_id) ?? 0) + s.duration_seconds / 60);
  }
  return [...m.entries()].map(([subjectId, minutes]) => ({ subjectId, minutes })).sort((a, b) => b.minutes - a.minutes);
}

export function completedTaskDay(t: Task, tz: string): string | null {
  return t.completed_at && !t.deleted_at ? dayKey(t.completed_at, tz) : null;
}

/** Days with at least one completed study session or completed task. */
export function activeDays(sessions: StudySession[], tasks: Task[], tz: string): Set<string> {
  const s = new Set<string>();
  for (const x of sessions) if (x.duration_seconds > 0) s.add(x.local_date);
  for (const t of tasks) {
    const d = completedTaskDay(t, tz);
    if (d) s.add(d);
  }
  return s;
}

export function streaks(active: Set<string>, today: string): { current: number; best: number } {
  let current = 0;
  // A streak is still alive if you have not yet studied today but did yesterday.
  let k = active.has(today) ? today : addDays(today, -1);
  while (active.has(k)) {
    current++;
    k = addDays(k, -1);
  }
  const days = [...active].sort();
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && diffDays(days[i], days[i - 1]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { current, best };
}

export function lastNDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

export function goalRange(period: GoalPeriod, today: string, weekStartsOn: number): { start: string; end: string } {
  if (period === 'daily') return { start: today, end: today };
  if (period === 'weekly') return { start: startOfWeek(today, weekStartsOn), end: endOfWeek(today, weekStartsOn) };
  return { start: startOfMonth(today), end: endOfMonth(today) };
}

export interface GoalProgress {
  value: number;
  target: number;
  ratio: number; // 0..1 (capped)
  reached: boolean;
  unit: string;
}

export function goalProgress(g: Goal, sessions: StudySession[], tasks: Task[], tz: string): GoalProgress {
  let value = 0;
  let unit = '';
  const inRange = (d: string) => d >= g.start_date && d <= g.end_date;
  const subj = (id: string | null) => !g.subject_id || id === g.subject_id;
  switch (g.metric) {
    case 'minutes':
      value = sessions.filter((s) => isStudy(s) && inRange(s.local_date) && subj(s.subject_id)).reduce((a, s) => a + s.duration_seconds / 60, 0);
      unit = 'min';
      break;
    case 'sessions':
      value = sessions.filter((s) => isStudy(s) && inRange(s.local_date) && subj(s.subject_id)).length;
      unit = 'sessions';
      break;
    case 'tasks':
      value = tasks.filter((t) => {
        const d = completedTaskDay(t, tz);
        return d !== null && inRange(d) && subj(t.subject_id);
      }).length;
      unit = 'tasks';
      break;
    case 'manual':
      value = g.current_value;
      unit = '';
      break;
  }
  const ratio = g.target_value > 0 ? Math.min(1, value / g.target_value) : 0;
  return { value, target: g.target_value, ratio, reached: value >= g.target_value, unit };
}

export interface WeekCompare {
  thisWeek: number;
  lastWeekSamePoint: number;
  lastWeekTotal: number;
}
/** This week so far vs the same number of days last week. */
export function weekCompare(byDay: Map<string, number>, today: string, weekStartsOn: number): WeekCompare {
  const ws = startOfWeek(today, weekStartsOn);
  const elapsed = diffDays(today, ws);
  const lastStart = addDays(ws, -7);
  return {
    thisWeek: sumRange(byDay, ws, today),
    lastWeekSamePoint: sumRange(byDay, lastStart, addDays(lastStart, elapsed)),
    lastWeekTotal: sumRange(byDay, lastStart, addDays(lastStart, 6)),
  };
}

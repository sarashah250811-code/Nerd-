import type { SyncEngine } from '../sync/engine';
import type { Goal, GoalMetric, GoalPeriod, Priority, Reflection, SessionType, StudySession, Subject, Task } from '../lib/types';
import { uuid } from '../lib/ids';
import { dayKey } from '../lib/dates';

const now = () => new Date().toISOString();
const baseRow = () => ({ id: uuid(), created_at: now(), client_updated_at: now(), deleted_at: null });

export const SUBJECT_COLORS = ['#8a5a2b', '#2b62d9', '#2f7d5b', '#b4533c', '#7a5cc4', '#c08a1e', '#2a8a9a', '#a14a7c', '#5b6b7f', '#6b8e23'];

export interface TaskInput {
  title: string;
  description?: string;
  subject_id?: string | null;
  priority?: Priority;
  due_date?: string | null;
}
export interface GoalInput {
  title: string;
  description?: string;
  period: GoalPeriod;
  metric: GoalMetric;
  target_value: number;
  current_value?: number;
  subject_id?: string | null;
  start_date: string;
  end_date: string;
}
export interface SessionInput {
  subject_id?: string | null;
  session_type: SessionType;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  planned_seconds?: number | null;
  note?: string;
  id?: string;
}

/** Thin, typed wrappers so views never build raw rows themselves. */
export function makeActions(engine: SyncEngine, tz: () => string) {
  return {
    addSubject(name: string, color: string, sortOrder: number) {
      const s: Subject = { ...baseRow(), name: name.trim(), color, sort_order: sortOrder };
      engine.put('subjects', s);
      return s.id;
    },
    updateSubject(id: string, ch: Partial<Pick<Subject, 'name' | 'color' | 'sort_order'>>) {
      engine.patch('subjects', id, ch);
    },
    deleteSubject(id: string) {
      engine.remove('subjects', id);
    },

    addTask(input: TaskInput) {
      const t: Task = {
        ...baseRow(),
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        subject_id: input.subject_id ?? null,
        priority: input.priority ?? 'normal',
        due_date: input.due_date || null,
        completed_at: null,
      };
      engine.put('tasks', t);
      return t.id;
    },
    updateTask(id: string, ch: Partial<TaskInput>) {
      const patch: Partial<Task> = {};
      if (ch.title !== undefined) patch.title = ch.title.trim();
      if (ch.description !== undefined) patch.description = ch.description.trim();
      if (ch.subject_id !== undefined) patch.subject_id = ch.subject_id;
      if (ch.priority !== undefined) patch.priority = ch.priority;
      if (ch.due_date !== undefined) patch.due_date = ch.due_date || null;
      engine.patch('tasks', id, patch);
    },
    setTaskDone(id: string, done: boolean) {
      engine.patch('tasks', id, { completed_at: done ? now() : null });
    },
    deleteTask(id: string) {
      engine.remove('tasks', id);
    },

    addGoal(input: GoalInput) {
      const g: Goal = {
        ...baseRow(),
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        period: input.period,
        metric: input.metric,
        target_value: input.target_value,
        current_value: input.current_value ?? 0,
        subject_id: input.subject_id ?? null,
        start_date: input.start_date,
        end_date: input.end_date,
        completed_at: null,
      };
      engine.put('goals', g);
      return g.id;
    },
    updateGoal(id: string, ch: Partial<GoalInput>) {
      engine.patch('goals', id, ch as Partial<Goal>);
    },
    setGoalDone(id: string, done: boolean) {
      engine.patch('goals', id, { completed_at: done ? now() : null });
    },
    deleteGoal(id: string) {
      engine.remove('goals', id);
    },

    /** Record a finished timer run, break, or manual log. The id may be supplied so retries cannot duplicate. */
    addSession(input: SessionInput) {
      const s: StudySession = {
        ...baseRow(),
        ...(input.id ? { id: input.id } : {}),
        subject_id: input.subject_id ?? null,
        session_type: input.session_type,
        started_at: input.started_at,
        ended_at: input.ended_at,
        duration_seconds: Math.max(1, Math.round(input.duration_seconds)),
        planned_seconds: input.planned_seconds ?? null,
        local_date: dayKey(input.ended_at, tz()),
        completed: true,
        note: input.note?.trim() ?? '',
      };
      engine.put('study_sessions', s);
      return s.id;
    },
    deleteSession(id: string) {
      engine.remove('study_sessions', id);
    },

    saveReflection(input: { id?: string; entry_date: string; kind: 'reflection' | 'note'; title: string; body: string }) {
      if (input.id) {
        engine.patch('reflections', input.id, { entry_date: input.entry_date, kind: input.kind, title: input.title.trim(), body: input.body });
        return input.id;
      }
      const r: Reflection = { ...baseRow(), entry_date: input.entry_date, kind: input.kind, title: input.title.trim(), body: input.body };
      engine.put('reflections', r);
      return r.id;
    },
    deleteReflection(id: string) {
      engine.remove('reflections', id);
    },
  };
}
export type Actions = ReturnType<typeof makeActions>;

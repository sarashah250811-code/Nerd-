export type ThemeId = 'warm' | 'light' | 'midnight' | 'star' | 'dark' | 'starry-evening';

/** Fields shared by every synced collection record. */
export interface BaseRow {
  id: string;
  user_id?: string;
  created_at: string;
  client_updated_at: string;
  updated_at?: string;
  deleted_at: string | null;
}

export interface Subject extends BaseRow {
  name: string;
  color: string;
  sort_order: number;
}

export type Priority = 'low' | 'normal' | 'high';

export interface Task extends BaseRow {
  title: string;
  description: string;
  subject_id: string | null;
  priority: Priority;
  due_date: string | null; // YYYY-MM-DD
  completed_at: string | null;
}

export type GoalPeriod = 'daily' | 'weekly' | 'monthly';
export type GoalMetric = 'minutes' | 'sessions' | 'tasks' | 'manual';

export interface Goal extends BaseRow {
  title: string;
  description: string;
  period: GoalPeriod;
  metric: GoalMetric;
  target_value: number;
  current_value: number;
  subject_id: string | null;
  start_date: string;
  end_date: string;
  completed_at: string | null;
}

export type SessionType = 'focus' | 'short_break' | 'long_break' | 'manual';

export interface StudySession extends BaseRow {
  subject_id: string | null;
  session_type: SessionType;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  planned_seconds: number | null;
  local_date: string;
  completed: boolean;
  note: string;
}

export interface Reflection extends BaseRow {
  entry_date: string;
  kind: 'reflection' | 'note';
  title: string;
  body: string;
}

/** Single-row-per-user documents. */
export interface DocBase {
  created_at?: string;
  client_updated_at: string;
  updated_at?: string;
}

export interface Profile extends DocBase {
  id: string;
  nerd_id: string;
  display_name: string;
}

export interface Preferences extends DocBase {
  user_id: string;
  theme: ThemeId;
  daily_target_minutes: number;
  timezone: string;
  week_starts_on: number;
  notifications_enabled: boolean;
  sound_enabled: boolean;
}

export interface TimerSettings extends DocBase {
  user_id: string;
  focus_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  sessions_until_long_break: number;
  auto_start_breaks: boolean;
  auto_start_focus: boolean;
}

export type Collection = 'subjects' | 'goals' | 'tasks' | 'study_sessions' | 'reflections';
export type DocTable = 'profiles' | 'user_preferences' | 'timer_settings';

export interface CollectionMap {
  subjects: Subject;
  goals: Goal;
  tasks: Task;
  study_sessions: StudySession;
  reflections: Reflection;
}

export interface DocMap {
  profiles: Profile;
  user_preferences: Preferences;
  timer_settings: TimerSettings;
}

/** Parent tables first, so foreign keys always resolve when flushing. */
export const COLLECTION_ORDER: Collection[] = ['subjects', 'goals', 'tasks', 'study_sessions', 'reflections'];
export const DOC_TABLES: DocTable[] = ['profiles', 'user_preferences', 'timer_settings'];

export type SyncStatus = 'synced' | 'saving' | 'offline' | 'error';

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { SyncEngine, type SyncState } from '../sync/engine';
import { makeActions, type Actions } from './actions';
import type { Preferences, Profile, ThemeId, TimerSettings } from '../lib/types';
import { applyTheme, storedTheme } from '../lib/themes';
import { browserTimezone, todayKey } from '../lib/dates';
import { useNow } from '../lib/hooks';

const EPOCH = new Date(0).toISOString();

export const defaultPrefs = (userId: string): Preferences => ({
  user_id: userId,
  theme: storedTheme() ?? 'warm',
  daily_target_minutes: 120,
  timezone: browserTimezone(),
  week_starts_on: 1,
  notifications_enabled: false,
  sound_enabled: true,
  client_updated_at: EPOCH,
});
export const defaultTimer = (userId: string): TimerSettings => ({
  user_id: userId,
  focus_minutes: 25,
  short_break_minutes: 5,
  long_break_minutes: 15,
  sessions_until_long_break: 4,
  auto_start_breaks: false,
  auto_start_focus: false,
  client_updated_at: EPOCH,
});

const emptyState: SyncState = {
  ready: false,
  status: 'synced',
  error: null,
  pending: 0,
  lastSyncedAt: null,
  lists: { subjects: [], goals: [], tasks: [], study_sessions: [], reflections: [] },
  docs: {},
  notices: [],
  backups: [],
  failed: [],
};
const noopSubscribe = () => () => {};
const emptySnapshot = () => emptyState;

export interface DataContextValue {
  userId: string;
  email: string;
  engine: SyncEngine;
  sync: SyncState;
  profile: Profile | undefined;
  prefs: Preferences;
  timer: TimerSettings;
  tz: string;
  today: string;
  actions: Actions;
  setTheme(id: ThemeId): void;
  updatePrefs(ch: Partial<Preferences>): void;
  updateTimer(ch: Partial<TimerSettings>): void;
  setDisplayName(name: string): void;
  /** Sign out, warning first if edits have not reached the cloud yet. Returns false if cancelled. */
  signOutSafely(confirmFn: (pending: number) => Promise<boolean>): Promise<boolean>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [engine, setEngine] = useState<SyncEngine | null>(null);

  useEffect(() => {
    if (!supabase || !user) return;
    const e = new SyncEngine(supabase, user.id);
    setEngine(e);
    void e.start();
    return () => {
      e.stop(false); // keep the cache; sign-out clears it explicitly when safe
      setEngine(null);
    };
  }, [user?.id]);

  const sync = useSyncExternalStore(engine ? engine.subscribe : noopSubscribe, engine ? engine.getState : emptySnapshot);

  const userId = user?.id ?? '';
  const profile = sync.docs.profiles;
  const prefs = useMemo(() => sync.docs.user_preferences ?? defaultPrefs(userId), [sync.docs.user_preferences, userId]);
  const timer = useMemo(() => sync.docs.timer_settings ?? defaultTimer(userId), [sync.docs.timer_settings, userId]);
  const tz = prefs.timezone || browserTimezone();
  const now = useNow(30_000);
  const today = useMemo(() => todayKey(tz), [tz, now]);

  // Apply the account's theme whenever it arrives or changes.
  useEffect(() => {
    if (sync.docs.user_preferences) applyTheme(sync.docs.user_preferences.theme);
  }, [sync.docs.user_preferences?.theme]);

  // First run: the server default timezone is UTC. Replace it with this device's zone, once,
  // only if the user has never edited preferences (client_updated_at still equals created_at).
  useEffect(() => {
    const p = sync.docs.user_preferences;
    if (!engine || !p || !sync.ready) return;
    const untouched = p.created_at && p.client_updated_at === p.created_at;
    if (untouched && p.timezone === 'UTC' && browserTimezone() !== 'UTC') {
      engine.updateDoc('user_preferences', { timezone: browserTimezone() });
    }
  }, [engine, sync.ready, sync.docs.user_preferences?.client_updated_at]);

  const tzRef = useMemo(() => ({ current: tz }), []);
  tzRef.current = tz;
  const actions = useMemo(() => (engine ? makeActions(engine, () => tzRef.current) : null), [engine, tzRef]);

  const value = useMemo<DataContextValue | null>(() => {
    if (!engine || !actions || !user) return null;
    return {
      userId: user.id,
      email: user.email ?? '',
      engine,
      sync,
      profile,
      prefs,
      timer,
      tz,
      today,
      actions,
      setTheme(id) {
        applyTheme(id);
        engine.updateDoc('user_preferences', { theme: id }, defaultPrefs(user.id));
      },
      updatePrefs(ch) {
        engine.updateDoc('user_preferences', ch, defaultPrefs(user.id));
      },
      updateTimer(ch) {
        engine.updateDoc('timer_settings', ch, defaultTimer(user.id));
      },
      setDisplayName(name) {
        engine.updateDoc('profiles', { display_name: name.trim().slice(0, 60) || 'Student' });
      },
      async signOutSafely(confirmFn) {
        await engine.flush();
        const pending = engine.getState().pending;
        if (pending > 0 && !(await confirmFn(pending))) return false;
        engine.stop(true);
        await signOut();
        return true;
      },
    };
  }, [engine, actions, user, sync, profile, prefs, timer, tz, today, signOut]);

  if (!value) return <div className="boot" role="status">Loading your study space…</div>;
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const v = useContext(DataContext);
  if (!v) throw new Error('useData must be used inside <DataProvider>');
  return v;
}

export const useSubjectMap = () => {
  const { sync } = useData();
  return useMemo(() => new Map(sync.lists.subjects.map((s) => [s.id, s])), [sync.lists.subjects]);
};

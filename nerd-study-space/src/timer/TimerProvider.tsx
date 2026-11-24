import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useData } from '../data/DataProvider';
import { uuid } from '../lib/ids';
import { formatClock } from '../lib/format';

export type Phase = 'focus' | 'short_break' | 'long_break';
type Status = 'idle' | 'running' | 'paused';

interface Persisted {
  v: 1;
  phase: Phase;
  status: Status;
  plannedSec: number;
  startedAt: number | null; // wall-clock ms when this phase first started
  endsAt: number | null; // wall-clock ms when it will finish (running)
  remainingMs: number | null; // frozen remaining time (paused)
  subjectId: string | null;
  focusDone: number; // focus sessions completed in the current cycle
  sessionId: string | null;
}

const key = (userId: string) => `nerd.v2.timer.${userId}`;
const initial: Persisted = { v: 1, phase: 'focus', status: 'idle', plannedSec: 0, startedAt: null, endsAt: null, remainingMs: null, subjectId: null, focusDone: 0, sessionId: null };

interface TimerContextValue {
  phase: Phase;
  status: Status;
  remainingSec: number;
  plannedSec: number;
  subjectId: string | null;
  focusDone: number;
  todayFocusCount: number;
  focusMode: boolean;
  setFocusMode(v: boolean): void;
  setSubject(id: string | null): void;
  choosePhase(p: Phase): void;
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  skip(): void;
  notice: string | null;
  clearNotice(): void;
}
const TimerContext = createContext<TimerContextValue | null>(null);

function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 660 + i * 110;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.25);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* audio is optional */
  }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { userId, timer: settings, prefs, actions, sync, today } = useData();
  const [st, setSt] = useState<Persisted>(() => {
    try {
      const raw = localStorage.getItem(key(userId));
      if (raw) {
        const p = JSON.parse(raw) as Persisted;
        if (p.v === 1) return p;
      }
    } catch {
      /* ignore */
    }
    return initial;
  });
  const [tick, setTick] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const stRef = useRef(st);
  stRef.current = st;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const persist = useCallback(
    (s: Persisted) => {
      try {
        localStorage.setItem(key(userId), JSON.stringify(s));
      } catch {
        /* ignore */
      }
    },
    [userId],
  );
  const update = useCallback(
    (fn: (s: Persisted) => Persisted) => {
      const next = fn(stRef.current);
      stRef.current = next;
      persist(next);
      setSt(next);
    },
    [persist],
  );

  const durationFor = (p: Phase) => {
    const s = settingsRef.current;
    const minutes = p === 'focus' ? s.focus_minutes : p === 'short_break' ? s.short_break_minutes : s.long_break_minutes;
    return minutes * 60;
  };

  const alertDone = useCallback((phase: Phase, late: boolean) => {
    const p = prefsRef.current;
    const text = phase === 'focus' ? 'Focus session complete. Take a break.' : 'Break over. Ready to focus?';
    if (late) {
      setNotice('A timer finished while you were away. Your session was saved.');
      return;
    }
    setNotice(text);
    if (p.sound_enabled) beep();
    if (p.notifications_enabled && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Nerd', { body: text, tag: 'nerd-timer' });
      } catch {
        /* some mobile browsers only allow service-worker notifications */
      }
    }
  }, []);

  const begin = useCallback(
    (phase: Phase, base: Persisted): Persisted => {
      const sec = durationFor(phase);
      const now = Date.now();
      return { ...base, phase, status: 'running', plannedSec: sec, startedAt: now, endsAt: now + sec * 1000, remainingMs: null, sessionId: uuid() };
    },
    [],
  );

  const complete = useCallback(
    (late: boolean) => {
      const s = stRef.current;
      if (s.status !== 'running' || !s.endsAt || !s.startedAt) return;
      const ended = Math.min(s.endsAt, Date.now());
      actionsRef.current.addSession({
        id: s.sessionId ?? undefined,
        subject_id: s.phase === 'focus' ? s.subjectId : null,
        session_type: s.phase,
        started_at: new Date(Math.min(s.startedAt, ended)).toISOString(),
        ended_at: new Date(ended).toISOString(),
        duration_seconds: s.plannedSec,
        planned_seconds: s.plannedSec,
      });
      alertDone(s.phase, late);
      const cfg = settingsRef.current;
      let next: Persisted;
      if (s.phase === 'focus') {
        const done = s.focusDone + 1;
        const nextPhase: Phase = done % cfg.sessions_until_long_break === 0 ? 'long_break' : 'short_break';
        const base = { ...s, focusDone: done, status: 'idle' as Status, startedAt: null, endsAt: null, remainingMs: null, sessionId: null, phase: nextPhase, plannedSec: 0 };
        next = cfg.auto_start_breaks && !late ? begin(nextPhase, base) : base;
      } else {
        const base = { ...s, status: 'idle' as Status, startedAt: null, endsAt: null, remainingMs: null, sessionId: null, phase: 'focus' as Phase, plannedSec: 0 };
        next = cfg.auto_start_focus && !late ? begin('focus', base) : base;
      }
      stRef.current = next;
      persist(next);
      setSt(next);
    },
    [alertDone, begin, persist],
  );

  // Heartbeat while running. Remaining time always comes from timestamps, never from counting ticks.
  useEffect(() => {
    if (st.status !== 'running') return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
      const s = stRef.current;
      if (s.status === 'running' && s.endsAt && Date.now() >= s.endsAt) complete(false);
    }, 250);
    const check = () => {
      const s = stRef.current;
      if (s.status === 'running' && s.endsAt && Date.now() >= s.endsAt) complete(Date.now() - s.endsAt > 60_000);
    };
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [st.status, complete]);

  // Recover after a refresh: if the timer ran out while the page was closed, record it now.
  useEffect(() => {
    const s = stRef.current;
    if (s.status === 'running' && s.endsAt && Date.now() >= s.endsAt) complete(Date.now() - s.endsAt > 60_000);
  }, [complete]);

  const idlePlanned = durationFor(st.phase);
  const remainingSec = useMemo(() => {
    void tick;
    if (st.status === 'running' && st.endsAt) return Math.max(0, (st.endsAt - Date.now()) / 1000);
    if (st.status === 'paused' && st.remainingMs != null) return st.remainingMs / 1000;
    return idlePlanned;
  }, [st, tick, idlePlanned]);
  const plannedSec = st.status === 'idle' ? idlePlanned : st.plannedSec;

  useEffect(() => {
    document.title = st.status === 'idle' ? 'Nerd — Your Study Space' : `${formatClock(remainingSec)} · ${st.phase === 'focus' ? 'Focus' : 'Break'} · Nerd`;
    return () => {
      document.title = 'Nerd — Your Study Space';
    };
  }, [remainingSec, st.status, st.phase]);

  const todayFocusCount = useMemo(
    () => sync.lists.study_sessions.filter((x) => x.session_type === 'focus' && x.local_date === today && x.completed).length,
    [sync.lists.study_sessions, today],
  );

  const value: TimerContextValue = {
    phase: st.phase,
    status: st.status,
    remainingSec,
    plannedSec,
    subjectId: st.subjectId,
    focusDone: st.focusDone,
    todayFocusCount,
    focusMode,
    setFocusMode,
    notice,
    clearNotice: () => setNotice(null),
    setSubject: (id) => update((s) => ({ ...s, subjectId: id })),
    choosePhase: (p) => update((s) => (s.status === 'idle' ? { ...s, phase: p } : s)),
    start: () => update((s) => (s.status === 'idle' ? begin(s.phase, s) : s)),
    pause: () =>
      update((s) => (s.status === 'running' && s.endsAt ? { ...s, status: 'paused', remainingMs: Math.max(0, s.endsAt - Date.now()), endsAt: null } : s)),
    resume: () =>
      update((s) => (s.status === 'paused' && s.remainingMs != null ? { ...s, status: 'running', endsAt: Date.now() + s.remainingMs, remainingMs: null } : s)),
    reset: () => update((s) => ({ ...s, status: 'idle', startedAt: null, endsAt: null, remainingMs: null, sessionId: null, plannedSec: 0 })),
    skip: () =>
      update((s) => {
        const nextPhase: Phase = s.phase === 'focus' ? (( s.focusDone + 1) % settingsRef.current.sessions_until_long_break === 0 ? 'long_break' : 'short_break') : 'focus';
        return { ...s, phase: nextPhase, status: 'idle', startedAt: null, endsAt: null, remainingMs: null, sessionId: null, plannedSec: 0 };
      }),
  };

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer(): TimerContextValue {
  const v = useContext(TimerContext);
  if (!v) throw new Error('useTimer must be used inside <TimerProvider>');
  return v;
}

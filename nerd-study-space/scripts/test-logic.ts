/**
 * Offline tests for the pure logic: dates/timezones, analytics rules and backup import.
 * Run: npm test   (no network, no Supabase needed)
 *
 * What this does NOT cover: anything that needs a real Supabase project (auth, RLS,
 * cross-device sync). Those are checked by hand using TESTING.md.
 */
import {
  addDays, addMonths, dayKey, diffDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek, weekday,
} from '../src/lib/dates';
import { activeDays, goalProgress, goalRange, isStudy, minutesByDay, streaks, subjectTotals, weekCompare } from '../src/lib/analytics';
import { buildBackup, mapLegacy, parseBackup } from '../src/lib/backup';
import { isUuid, stableId } from '../src/lib/ids';
import { formatClock, formatMinutes, pct } from '../src/lib/format';
import type { Goal, StudySession, Task } from '../src/lib/types';

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e instanceof Error ? e.message : e}`);
  }
}
const eq = (a: unknown, b: unknown, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (v: unknown, msg = 'expected truthy') => {
  if (!v) throw new Error(msg);
};
const throws = (fn: () => void, re: RegExp) => {
  try {
    fn();
  } catch (e) {
    if (re.test(String(e instanceof Error ? e.message : e))) return;
    throw new Error(`threw the wrong error: ${e}`);
  }
  throw new Error('expected an error');
};

const TZ = 'Asia/Kolkata';
const sess = (over: Partial<StudySession>): StudySession => ({
  id: stableId('t', JSON.stringify(over)),
  created_at: '2026-01-01T00:00:00Z',
  client_updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  subject_id: null,
  session_type: 'focus',
  started_at: '2026-01-01T00:00:00Z',
  ended_at: '2026-01-01T00:25:00Z',
  duration_seconds: 1500,
  planned_seconds: 1500,
  local_date: '2026-01-01',
  completed: true,
  note: '',
  ...over,
});
const task = (over: Partial<Task>): Task => ({
  id: stableId('task', JSON.stringify(over)),
  created_at: '2026-01-01T00:00:00Z',
  client_updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  title: 'x',
  description: '',
  subject_id: null,
  priority: 'normal',
  due_date: null,
  completed_at: null,
  ...over,
});

/* ---------------- dates ---------------- */
test('dayKey uses the user timezone, not UTC', () => {
  // 23:30 UTC on Nov 23 is already Nov 24 in India (UTC+5:30).
  eq(dayKey('2026-11-23T23:30:00Z', TZ), '2026-11-24');
  eq(dayKey('2026-11-23T23:30:00Z', 'UTC'), '2026-11-23');
  eq(dayKey('2026-11-23T23:30:00Z', 'America/Los_Angeles'), '2026-11-23');
});
test('day arithmetic crosses month, year and leap boundaries', () => {
  eq(addDays('2026-12-31', 1), '2027-01-01');
  eq(addDays('2028-02-28', 1), '2028-02-29');
  eq(addDays('2026-03-01', -1), '2026-02-28');
  eq(diffDays('2026-03-01', '2026-02-01'), 28);
});
test('day arithmetic is DST-safe', () => {
  eq(addDays('2026-03-07', 2), '2026-03-09'); // US DST starts Mar 8 2026
  eq(diffDays('2026-11-02', '2026-10-31'), 2);
});
test('week and month boundaries respect week start', () => {
  eq(weekday('2026-11-23'), 1); // Monday
  eq(startOfWeek('2026-11-26', 1), '2026-11-23');
  eq(startOfWeek('2026-11-26', 0), '2026-11-22');
  eq(endOfWeek('2026-11-26', 1), '2026-11-29');
  eq(startOfMonth('2026-02-17'), '2026-02-01');
  eq(endOfMonth('2028-02-10'), '2028-02-29');
  eq(addMonths('2026-12-01', 1), '2027-01-01');
  eq(addMonths('2026-01-01', -1), '2025-12-01');
});

/* ---------------- analytics ---------------- */
test('only completed focus/manual sessions count as study time', () => {
  ok(isStudy(sess({})));
  ok(isStudy(sess({ session_type: 'manual' })));
  ok(!isStudy(sess({ session_type: 'short_break' })));
  ok(!isStudy(sess({ session_type: 'long_break' })));
  ok(!isStudy(sess({ completed: false })), 'incomplete session counted');
  ok(!isStudy(sess({ deleted_at: '2026-01-02T00:00:00Z' })), 'deleted session counted');
});
test('minutesByDay and subjectTotals aggregate real durations', () => {
  const a = stableId('s', 'a');
  const s = [
    sess({ local_date: '2026-11-23', duration_seconds: 1500, subject_id: a }),
    sess({ local_date: '2026-11-23', duration_seconds: 600, subject_id: null }),
    sess({ local_date: '2026-11-24', duration_seconds: 3000, subject_id: a }),
  ];
  const m = minutesByDay(s);
  eq(m.get('2026-11-23'), 35);
  eq(m.get('2026-11-24'), 50);
  const t = subjectTotals(s);
  eq(t[0], { subjectId: a, minutes: 75 });
  eq(subjectTotals(s, '2026-11-24', '2026-11-24'), [{ subjectId: a, minutes: 50 }]);
});
test('a completed task counts as an active day even with no minutes', () => {
  const days = activeDays([], [task({ completed_at: '2026-11-23T20:00:00Z' })], TZ);
  ok(days.has('2026-11-24'), 'task completed at 01:30 IST Nov 24 should be Nov 24');
});
test('streaks: alive until a whole day is missed', () => {
  const act = new Set(['2026-11-20', '2026-11-21', '2026-11-22']);
  eq(streaks(act, '2026-11-23'), { current: 3, best: 3 }, 'yesterday-only streak is still alive');
  eq(streaks(act, '2026-11-24'), { current: 0, best: 3 }, 'two idle days break it');
  eq(streaks(new Set([...act, '2026-11-23']), '2026-11-23'), { current: 4, best: 4 });
  eq(streaks(new Set(['2026-01-01', '2026-01-02', '2026-01-10']), '2026-02-01'), { current: 0, best: 2 });
  eq(streaks(new Set(), '2026-11-23'), { current: 0, best: 0 });
});
test('weekCompare compares like with like', () => {
  const m = new Map<string, number>([
    ['2026-11-16', 30], ['2026-11-17', 30], ['2026-11-18', 30], ['2026-11-22', 100], // last week (Mon-Sun)
    ['2026-11-23', 40], ['2026-11-24', 20], // this week, today = Tue
  ]);
  eq(weekCompare(m, '2026-11-24', 1), { thisWeek: 60, lastWeekSamePoint: 60, lastWeekTotal: 190 });
});
test('goal progress: minutes, tasks, sessions, subject filter, manual', () => {
  const subj = stableId('g', 'chem');
  const base: Goal = {
    id: stableId('g', '1'), created_at: '', client_updated_at: '', deleted_at: null,
    title: 'g', description: '', period: 'weekly', metric: 'minutes', target_value: 100, current_value: 0,
    subject_id: null, start_date: '2026-11-23', end_date: '2026-11-29', completed_at: null,
  };
  const sessions = [
    sess({ local_date: '2026-11-23', duration_seconds: 3600, subject_id: subj }),
    sess({ local_date: '2026-11-24', duration_seconds: 1800 }),
    sess({ local_date: '2026-11-22', duration_seconds: 6000 }), // before the range
    sess({ local_date: '2026-11-25', duration_seconds: 6000, completed: false }), // abandoned
    sess({ local_date: '2026-11-25', duration_seconds: 900, session_type: 'short_break' }),
  ];
  const tasks = [task({ completed_at: '2026-11-24T05:00:00Z' }), task({ completed_at: null })];
  const minutes = goalProgress(base, sessions, tasks, TZ);
  eq(minutes.value, 90);
  eq(minutes.reached, false);
  eq(goalProgress({ ...base, subject_id: subj }, sessions, tasks, TZ).value, 60);
  eq(goalProgress({ ...base, metric: 'sessions', target_value: 2 }, sessions, tasks, TZ).reached, true);
  eq(goalProgress({ ...base, metric: 'tasks', target_value: 1 }, sessions, tasks, TZ).value, 1);
  eq(goalProgress({ ...base, metric: 'manual', current_value: 3, target_value: 4 }, sessions, tasks, TZ).ratio, 0.75);
  eq(goalProgress({ ...base, target_value: 30 }, sessions, tasks, TZ).ratio, 1, 'ratio is capped at 1');
});
test('goalRange', () => {
  eq(goalRange('daily', '2026-11-24', 1), { start: '2026-11-24', end: '2026-11-24' });
  eq(goalRange('weekly', '2026-11-24', 1), { start: '2026-11-23', end: '2026-11-29' });
  eq(goalRange('monthly', '2026-11-24', 1), { start: '2026-11-01', end: '2026-11-30' });
});

/* ---------------- ids ---------------- */
test('stableId is deterministic and UUID-shaped', () => {
  eq(stableId('ns', 'a'), stableId('ns', 'a'));
  ok(stableId('ns', 'a') !== stableId('ns', 'b'));
  ok(stableId('ns', 'a') !== stableId('other', 'a'));
  ok(isUuid(stableId('ns', 'a')), 'not a uuid');
});

/* ---------------- backup / import ---------------- */
const goodBackup = () => ({
  app: 'nerd',
  format: 1,
  data: {
    subjects: [{ id: stableId('x', 's1'), name: ' Maths ', color: '#2b62d9' }, { name: '' }],
    tasks: [
      { id: stableId('x', 't1'), title: 'Past paper', priority: 'high', due_date: '2026-12-01', subject_id: stableId('x', 's1') },
      { title: 'Orphan ref', subject_id: stableId('x', 'missing'), due_date: 'not-a-date' },
      { title: '' },
    ],
    goals: [
      { title: 'Bad dates', start_date: '2026-12-05', end_date: '2026-12-01' },
      { title: 'Good', period: 'weekly', metric: 'minutes', target_value: 300, start_date: '2026-11-23', end_date: '2026-11-29' },
    ],
    study_sessions: [
      { started_at: '2026-11-24T10:00:00Z', ended_at: '2026-11-24T10:25:00Z', duration_seconds: 1500, session_type: 'focus' },
      { started_at: '2026-11-24T10:00:00Z', ended_at: '2026-11-24T09:00:00Z', duration_seconds: 1500 }, // ends before it starts
      { started_at: 'garbage', ended_at: 'x', duration_seconds: 5 },
      { started_at: '2026-11-24T10:00:00Z', ended_at: '2026-11-24T10:00:00Z', duration_seconds: 0 },
    ],
    reflections: [{ entry_date: '2026-11-24', body: 'Good day' }, { entry_date: 'nope', body: 'x' }],
    user_preferences: { theme: 'star', daily_target_minutes: 99999 },
    timer_settings: { focus_minutes: 9999 },
  },
});

test('parseBackup validates and normalises, dropping bad rows', () => {
  const r = parseBackup(JSON.stringify(goodBackup()), TZ);
  eq(r.counts, { subjects: 1, tasks: 2, goals: 1, study_sessions: 1, reflections: 1 });
  eq(r.bundle.subjects[0].name, 'Maths');
  const orphan = r.bundle.tasks.find((t) => t.title === 'Orphan ref')!;
  eq(orphan.subject_id, null, 'dangling subject ref must be cleared');
  eq(orphan.due_date, null, 'invalid date must be cleared');
  eq(r.bundle.user_preferences?.theme, 'star');
  eq(r.bundle.user_preferences?.daily_target_minutes, 1440, 'target clamped');
  eq(r.bundle.timer_settings?.focus_minutes, 180, 'focus clamped');
  ok(r.warnings.length > 0, 'dropped rows should be reported');
});
test('importing the same file twice produces identical ids (no duplicates)', () => {
  const a = parseBackup(JSON.stringify(goodBackup()), TZ).bundle;
  const b = parseBackup(JSON.stringify(goodBackup()), TZ).bundle;
  eq(a.tasks.map((t) => t.id), b.tasks.map((t) => t.id));
  eq(a.study_sessions.map((t) => t.id), b.study_sessions.map((t) => t.id), 'sessions without ids must be stable');
  eq(a.goals.map((t) => t.id), b.goals.map((t) => t.id));
  eq(a.reflections.map((t) => t.id), b.reflections.map((t) => t.id));
});
test('session local_date follows the timezone when missing', () => {
  // 10:00Z is 00:00 on the 25th at UTC+14, but still the 24th in UTC.
  eq(parseBackup(JSON.stringify(goodBackup()), 'Pacific/Kiritimati').bundle.study_sessions[0].local_date, '2026-11-25');
  eq(parseBackup(JSON.stringify(goodBackup()), 'UTC').bundle.study_sessions[0].local_date, '2026-11-24');
});
test('parseBackup rejects things that are not Nerd backups', () => {
  throws(() => parseBackup('not json', TZ), /not valid JSON/);
  throws(() => parseBackup('{"hello":1}', TZ), /does not look like a Nerd backup/);
  throws(() => parseBackup('[1,2]', TZ), /does not look like a Nerd backup/);
  throws(() => parseBackup(JSON.stringify({ app: 'nerd', format: 99, data: {} }), TZ), /newer version/);
});
test('export then import round-trips', () => {
  const imported = parseBackup(JSON.stringify(goodBackup()), TZ).bundle;
  const exported = buildBackup('NERD-TEST', {
    collections: { subjects: imported.subjects, tasks: imported.tasks, goals: imported.goals, study_sessions: imported.study_sessions, reflections: imported.reflections },
    docs: {},
  });
  eq(exported.nerd_id, 'NERD-TEST');
  const again = parseBackup(JSON.stringify(exported), TZ);
  eq(again.counts, { subjects: 1, tasks: 2, goals: 1, study_sessions: 1, reflections: 1 });
  eq(again.bundle.tasks.map((t) => t.id), imported.tasks.map((t) => t.id));
  ok(!JSON.stringify(exported).includes('user_id'), 'export must not leak user_id');
});
test('legacy browser data maps without losing task completion', () => {
  const r = mapLegacy(
    {
      key: 'old-nerd',
      counts: { subjects: 1, tasks: 2, sessions: 1 },
      data: {
        subjects: ['Physics'],
        tasks: [{ text: 'Read ch 3', done: true, subject: 'Physics' }, 'Revise notes'],
        sessions: [{ minutes: 45, subject: 'Physics', date: '2026-11-20T10:00:00Z' }],
      },
    },
    TZ,
  );
  eq(r.counts, { subjects: 1, tasks: 2, goals: 0, study_sessions: 1, reflections: 0 });
  ok(r.bundle.tasks.find((t) => t.title === 'Read ch 3')?.completed_at, 'done task must stay done');
  eq(r.bundle.tasks.find((t) => t.title === 'Read ch 3')?.subject_id, r.bundle.subjects[0].id);
  eq(r.bundle.study_sessions[0].duration_seconds, 2700);
  const r2 = mapLegacy({ key: 'old-nerd', counts: { subjects: 1, tasks: 2, sessions: 1 }, data: { subjects: ['Physics'], tasks: [{ text: 'Read ch 3', done: true, subject: 'Physics' }, 'Revise notes'], sessions: [{ minutes: 45, subject: 'Physics', date: '2026-11-20T10:00:00Z' }] } }, TZ);
  eq(r.bundle.tasks.map((t) => t.id), r2.bundle.tasks.map((t) => t.id), 'migrating twice must not duplicate');
});

/* ---------------- format ---------------- */
test('formatting helpers', () => {
  eq(formatMinutes(0), '0m');
  eq(formatMinutes(59.6), '1h');
  eq(formatMinutes(125), '2h 5m');
  eq(formatClock(1500), '25:00');
  eq(formatClock(0.2), '00:01', 'rounds partial seconds up so the timer never shows 00:00 early');
  eq(pct(5, 0), 0);
  eq(pct(150, 100), 100);
});

if (failures.length) {
  console.error(`\n${failures.length} test(s) FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`${passed} passed`);
  process.exit(1);
}
console.log(`All ${passed} logic tests passed.`);

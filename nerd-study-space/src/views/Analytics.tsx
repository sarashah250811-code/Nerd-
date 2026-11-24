import { useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { addDays, diffDays, formatDay, startOfMonth, startOfWeek, weekdayLabels } from '../lib/dates';
import { formatMinutes, plural } from '../lib/format';
import {
  activeDays,
  focusSessionCount,
  goalProgress,
  isStudy,
  lastNDays,
  minutesByDay,
  streaks,
  subjectTotals,
  sumRange,
  weekCompare,
} from '../lib/analytics';
import { BarChart, Donut, type BarDatum } from '../components/charts';
import { EmptyState, PageHead } from '../components/ui';

type Range = 7 | 30 | 90;
const HEAT_WEEKS = 20;

export function Analytics() {
  const { sync, prefs, tz, today } = useData();
  const [range, setRange] = useState<Range>(7);
  const { subjects, tasks, goals, study_sessions } = sync.lists;
  const ws = prefs.week_starts_on;

  const study = useMemo(() => study_sessions.filter(isStudy), [study_sessions]);
  const byDay = useMemo(() => minutesByDay(study), [study]);
  const subjMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const active = useMemo(() => activeDays(study, tasks, tz), [study, tasks, tz]);
  const { current, best } = useMemo(() => streaks(active, today), [active, today]);

  const totalMin = useMemo(() => study.reduce((a, s) => a + s.duration_seconds / 60, 0), [study]);
  const todayMin = byDay.get(today) ?? 0;
  const yesterdayMin = byDay.get(addDays(today, -1)) ?? 0;
  const last7 = lastNDays(today, 7);
  const avg7 = last7.reduce((a, d) => a + (byDay.get(d) ?? 0), 0) / 7;
  const monthMin = sumRange(byDay, startOfMonth(today), today);
  const wc = weekCompare(byDay, today, ws);
  const focusTotal = focusSessionCount(study);
  const focusInRange = focusSessionCount(study, addDays(today, -(range - 1)), today);
  const activeLast30 = lastNDays(today, 30).filter((d) => active.has(d)).length;

  // Goals whose period is over (or that were marked complete): how many hit their target.
  const finishedGoals = goals.filter((g) => g.completed_at || g.end_date < today);
  const reachedGoals = finishedGoals.filter((g) => goalProgress(g, study_sessions, tasks, tz).reached || g.completed_at).length;

  const daily: BarDatum[] = lastNDays(today, range).map((d) => ({
    label: range === 7 ? formatDay(d, { weekday: 'short' }) : formatDay(d, { month: 'short', day: 'numeric' }),
    value: byDay.get(d) ?? 0,
    title: `${formatDay(d)}: ${formatMinutes(byDay.get(d) ?? 0)}`,
  }));

  const weekly: BarDatum[] = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(startOfWeek(today, ws), (i - 7) * 7);
    const end = addDays(start, 6);
    const v = sumRange(byDay, start, end);
    return { label: formatDay(start, { month: 'short', day: 'numeric' }), value: v, alt: i < 7, title: `Week of ${formatDay(start)}: ${formatMinutes(v)}` };
  });

  const totals = subjectTotals(study, addDays(today, -(range - 1)), today);
  const slices = totals.map((t, i) => {
    const s = t.subjectId ? subjMap.get(t.subjectId) : undefined;
    return { label: s?.name ?? 'No subject', value: t.minutes, color: s?.color ?? `hsl(${(i * 47) % 360} 10% 50%)` };
  });
  const rangeTotal = slices.reduce((a, s) => a + s.value, 0);

  const diffLabel = (a: number, b: number) => {
    const d = Math.round(a - b);
    if (d === 0) return 'same as';
    return `${formatMinutes(Math.abs(d))} ${d > 0 ? 'more than' : 'less than'}`;
  };

  if (study.length === 0 && tasks.every((t) => !t.completed_at)) {
    return (
      <>
        <PageHead title="Analytics" sub="Built only from what you actually record." />
        <section className="card">
          <EmptyState title="Nothing to analyse yet">Finish a focus session or log study time and your numbers will appear here. Nothing is estimated or pre-filled.</EmptyState>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Analytics"
        sub="Built only from completed sessions and tasks. Abandoned timers and breaks never count."
        actions={
          <div className="seg" role="group" aria-label="Range">
            {([7, 30, 90] as Range[]).map((r) => (
              <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r} days</button>
            ))}
          </div>
        }
      />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Total study time" value={formatMinutes(totalMin)} />
        <Stat label="Today" value={formatMinutes(todayMin)} />
        <Stat label="This week" value={formatMinutes(wc.thisWeek)} />
        <Stat label="This month" value={formatMinutes(monthMin)} />
        <Stat label="Focus sessions completed" value={String(focusTotal)} sub={`${focusInRange} in the last ${range} days`} />
        <Stat label="Consistency" value={`${activeLast30}/30`} sub="active days, last 30" />
        <Stat label="Current streak" value={plural(current, 'day')} sub={`Best: ${plural(best, 'day')}`} />
        <Stat label="Goals reached" value={finishedGoals.length ? `${reachedGoals}/${finishedGoals.length}` : '—'} sub={finishedGoals.length ? 'of finished goals' : 'no finished goals yet'} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <section className="card span-2" aria-labelledby="an-daily">
          <h2 id="an-daily">Daily study time</h2>
          <p className="card-sub">Last {range} days. Your daily target is {formatMinutes(prefs.daily_target_minutes)}.</p>
          <BarChart data={daily} ariaLabel={`Daily study time, last ${range} days`} />
        </section>

        <section className="card" aria-labelledby="an-compare">
          <h2 id="an-compare">Comparisons</h2>
          <p className="card-sub">Plain differences, no scoring.</p>
          <div className="stack">
            <p>Today is <b>{diffLabel(todayMin, yesterdayMin)}</b> yesterday ({formatMinutes(yesterdayMin)}).</p>
            <p>Today is <b>{diffLabel(todayMin, avg7)}</b> your 7-day daily average ({formatMinutes(avg7)}).</p>
            <p>
              This week so far is <b>{diffLabel(wc.thisWeek, wc.lastWeekSamePoint)}</b> the same point last week. Last week finished at {formatMinutes(wc.lastWeekTotal)}.
            </p>
          </div>
        </section>

        <section className="card" aria-labelledby="an-weekly">
          <h2 id="an-weekly">Weekly totals</h2>
          <p className="card-sub">Eight weeks. The lighter bars are complete weeks.</p>
          <BarChart data={weekly} height={170} ariaLabel="Weekly study totals, last eight weeks" />
        </section>

        <section className="card span-2" aria-labelledby="an-subj">
          <h2 id="an-subj">By subject</h2>
          <p className="card-sub">Last {range} days.</p>
          {slices.length === 0 ? (
            <EmptyState title="No study time in this range" />
          ) : (
            <div className="row wrap" style={{ gap: 28, alignItems: 'center' }}>
              <Donut slices={slices} ariaLabel="Study time by subject" centre={formatMinutes(rangeTotal)} />
              <ul className="list" style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1, minWidth: 220 }}>
                {slices.map((s) => (
                  <li key={s.label} className="list-item" style={{ alignItems: 'center' }}>
                    <span className="dot" style={{ background: s.color }} aria-hidden="true" />
                    <span className="grow">{s.label}</span>
                    <span className="num">{formatMinutes(s.value)}</span>
                    <span className="muted small num" style={{ width: 44, textAlign: 'right' }}>{Math.round((s.value / rangeTotal) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card span-2" aria-labelledby="an-heat">
          <h2 id="an-heat">Activity calendar</h2>
          <p className="card-sub">Darker means more study time relative to your daily target. A completed task alone shows as the lightest shade.</p>
          <Heatmap byDay={byDay} active={active} today={today} ws={ws} target={prefs.daily_target_minutes} />
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card stat">
      <span className="stat-value num">{value}</span>
      <span className="stat-label">{label}</span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

function Heatmap({ byDay, active, today, ws, target }: { byDay: Map<string, number>; active: Set<string>; today: string; ws: number; target: number }) {
  const start = addDays(startOfWeek(today, ws), -(HEAT_WEEKS - 1) * 7);
  const cells: { key: string; level: number; future: boolean }[] = [];
  const t = Math.max(1, target);
  for (let i = 0; i < HEAT_WEEKS * 7; i++) {
    const key = addDays(start, i);
    const future = diffDays(key, today) > 0;
    const m = byDay.get(key) ?? 0;
    let level = 0;
    if (!future) {
      if (m >= t) level = 4;
      else if (m >= t * 0.6) level = 3;
      else if (m >= t * 0.3) level = 2;
      else if (m > 0 || active.has(key)) level = 1;
    }
    cells.push({ key, level, future });
  }
  const labels = weekdayLabels(ws);
  const activeCount = cells.filter((c) => c.level > 0).length;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
      <div className="small muted" aria-hidden="true" style={{ display: 'grid', gridTemplateRows: 'repeat(7, 14px)', gap: 3, paddingTop: 0 }}>
        {labels.map((l, i) => <span key={i} style={{ lineHeight: '14px', fontSize: 10 }}>{i % 2 === 0 ? l.slice(0, 3) : ''}</span>)}
      </div>
      <div className="heat" role="img" aria-label={`Activity over the last ${HEAT_WEEKS} weeks: ${activeCount} active days`}>
        {cells.map((c) => (
          <i key={c.key} data-l={c.level} style={c.future ? { visibility: 'hidden' } : undefined} title={`${formatDay(c.key)}: ${formatMinutes(byDay.get(c.key) ?? 0)}`} />
        ))}
      </div>
    </div>
  );
}

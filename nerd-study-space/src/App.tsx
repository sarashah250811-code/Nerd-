import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthScreen, Brand, RecoveryScreen, SetupRequired } from './auth/AuthScreens';
import { DataProvider, useData } from './data/DataProvider';
import { TimerProvider, useTimer } from './timer/TimerProvider';
import { ConfirmProvider, SyncBadge, Toasts, useConfirm } from './components/ui';
import { Icon, type IconName } from './components/Icon';
import { MigrationPrompt } from './components/MigrationPrompt';
import { supabaseConfigured } from './lib/supabase';
import { useRoute } from './lib/hooks';
import { formatClock } from './lib/format';
import { Dashboard } from './views/Dashboard';
import { Tasks } from './views/Tasks';
import { Subjects } from './views/Subjects';
import { Goals } from './views/Goals';
import { TimerView } from './views/TimerView';
import { Analytics } from './views/Analytics';
import { CalendarView } from './views/CalendarView';
import { Reflections } from './views/Reflections';
import { Settings } from './views/Settings';

interface NavItem {
  id: string;
  label: string;
  icon: IconName;
}
const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'timer', label: 'Timer', icon: 'timer' },
  { id: 'goals', label: 'Goals', icon: 'goals' },
  { id: 'subjects', label: 'Subjects', icon: 'subjects' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'reflections', label: 'Reflections', icon: 'reflections' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
const PRIMARY_MOBILE = ['dashboard', 'tasks', 'timer', 'analytics'];

function Shell() {
  const { user } = useAuth();
  const data = useData();
  const timer = useTimer();
  const confirm = useConfirm();
  const [route, go] = useRoute('dashboard');
  const [sheet, setSheet] = useState(false);
  const [view, sub] = route.split('/');

  useEffect(() => {
    setSheet(false);
    window.scrollTo(0, 0);
  }, [route]);

  const signOut = () =>
    data.signOutSafely((pending) =>
      confirm({
        title: 'Sign out with unsynced changes?',
        body: `${pending} change${pending === 1 ? '' : 's'} have not reached the cloud yet. They stay safely stored on this device and will sync the next time you sign in to this account here. Sign out anyway?`,
        confirmLabel: 'Sign out',
        danger: true,
      }),
    );

  const name = data.profile?.display_name ?? user?.email?.split('@')[0] ?? 'Student';
  const running = timer.status !== 'idle';

  const renderView = () => {
    switch (view) {
      case 'tasks': return <Tasks />;
      case 'subjects': return <Subjects />;
      case 'goals': return <Goals />;
      case 'timer': return <TimerView />;
      case 'analytics': return <Analytics />;
      case 'calendar': return <CalendarView />;
      case 'reflections': return <Reflections />;
      case 'settings': return <Settings tab={sub} onSignOut={signOut} />;
      default: return <Dashboard name={name} go={go} />;
    }
  };

  const link = (n: NavItem) => (
    <a key={n.id} href={`#/${n.id}`} aria-current={view === n.id || (n.id === 'dashboard' && !NAV.some((x) => x.id === view)) ? 'page' : undefined}>
      <Icon name={n.icon} />
      <span>{n.label}</span>
      {n.id === 'timer' && running && <span className="chip num" style={{ marginLeft: 'auto' }}>{formatClock(timer.remainingSec)}</span>}
    </a>
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main">
        <Brand />
        <nav className="nav" aria-label="Sections">{NAV.map(link)}</nav>
        <div className="sidebar-foot">
          <SyncBadge />
          <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{name}</div>
          <button className="btn sm" onClick={() => void signOut()}><Icon name="logout" /> Sign out</button>
        </div>
      </aside>

      <div>
        <header className="topbar">
          <div className="row"><div className="brand-mark" style={{ width: 28, height: 28, fontSize: '0.95rem' }} aria-hidden="true">N</div><strong style={{ fontFamily: 'Fraunces, serif' }}>Nerd</strong></div>
          <SyncBadge />
        </header>
        <main className="main" id="main">
          <MigrationPrompt />
          {renderView()}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {NAV.filter((n) => PRIMARY_MOBILE.includes(n.id)).map((n) => (
          <a key={n.id} href={`#/${n.id}`} aria-current={view === n.id ? 'page' : undefined}>
            <Icon name={n.icon} />
            {n.id === 'timer' && running ? <span className="num">{formatClock(timer.remainingSec)}</span> : n.label}
          </a>
        ))}
        <button onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet}>
          <Icon name="more" />More
        </button>
      </nav>

      {sheet && (
        <div className="overlay" style={{ alignItems: 'end' }} onMouseDown={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="More sections" style={{ borderRadius: '18px 18px 0 0' }}>
            <nav className="nav" aria-label="More sections">
              {NAV.filter((n) => !PRIMARY_MOBILE.includes(n.id)).map(link)}
              <button onClick={() => void signOut()}><Icon name="logout" /> Sign out</button>
            </nav>
          </div>
        </div>
      )}

      <Toasts extra={timer.notice} onClearExtra={timer.clearNotice} />
    </div>
  );
}

function Gate() {
  const { status, recovering } = useAuth();
  if (status === 'loading') return <div className="boot" role="status">Loading…</div>;
  if (recovering) return <RecoveryScreen />;
  if (status === 'signed-out') return <AuthScreen />;
  return (
    <DataProvider>
      <TimerProvider>
        <Shell />
      </TimerProvider>
    </DataProvider>
  );
}

export default function App() {
  if (!supabaseConfigured) return <SetupRequired />;
  return (
    <AuthProvider>
      <ConfirmProvider>
        <Gate />
      </ConfirmProvider>
    </AuthProvider>
  );
}

import { useEffect, useState } from 'react';

/** Re-render on an interval and return the current Date. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Tiny hash router: '#/tasks' -> 'tasks'. */
export function useRoute(defaultRoute: string): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || defaultRoute;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [route, (r) => (window.location.hash = `#/${r}`)];
}

export function useEscape(handler: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && handler();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [handler, active]);
}

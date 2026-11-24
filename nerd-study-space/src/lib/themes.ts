import type { ThemeId } from './types';

/**
 * Theme metadata only. The actual colours live in src/styles/themes.css as CSS
 * variables under [data-theme="…"], so previews can simply render a small
 * element with that data-theme attribute and automatically stay in sync.
 */
export interface ThemeMeta {
  id: ThemeId;
  name: string;
  blurb: string;
  mode: 'light' | 'dark';
}

export const THEMES: ThemeMeta[] = [
  { id: 'warm', name: 'Warm Parchment', blurb: 'Cream, parchment and muted brown. The original.', mode: 'light' },
  { id: 'light', name: 'Light', blurb: 'Soft white, pale blue-grey and clean blue.', mode: 'light' },
  { id: 'midnight', name: 'Midnight', blurb: 'Deep navy with muted periwinkle and faint stars.', mode: 'dark' },
  { id: 'star', name: 'Star', blurb: 'Midnight violet, constellations and vintage-book details.', mode: 'dark' },
  { id: 'dark', name: 'Dark', blurb: 'Black and graphite. Quiet contrast.', mode: 'dark' },
  { id: 'starry-evening', name: 'Starry Evening', blurb: 'Cream yellow and muted blue, a painterly evening.', mode: 'light' },
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as string[]).includes(v);

const THEME_KEY = 'nerd.v2.theme';

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute('data-theme', id);
  const mode = THEMES.find((t) => t.id === id)?.mode ?? 'light';
  document.documentElement.style.colorScheme = mode;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* storage unavailable: theme still applies for this session */
  }
}

export function storedTheme(): ThemeId | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemeId(v) ? v : null;
  } catch {
    return null;
  }
}

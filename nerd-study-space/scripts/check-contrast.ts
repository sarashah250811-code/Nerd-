/**
 * Fails if any theme drops below WCAG AA (4.5:1) for text pairs the UI really uses.
 * Run: npm test
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/themes.css', import.meta.url), 'utf8');
const themes: Record<string, Record<string, string>> = {};
const re = /([^{}]+)\{([^{}]*)\}/g;
let m: RegExpExecArray | null;
while ((m = re.exec(css))) {
  const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const ids = [...sels.matchAll(/\[data-theme='([^']+)'\]/g)].map((x) => x[1]);
  if (!ids.length) continue;
  const vars: Record<string, string> = {};
  for (const v of m[2].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[v[1]] = v[2];
  for (const id of ids) themes[id] = { ...(themes[id] ?? {}), ...vars };
}
// :root shares the warm theme
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const pairs: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'accent-soft'], ['text', 'sidebar'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['muted', 'sidebar'],
  ['on-accent', 'accent'], ['accent', 'surface'], ['accent', 'bg'], ['accent', 'sidebar'],
  ['danger', 'surface'], ['danger', 'bg'], ['success', 'surface'],
];
let failures = 0;
const required = ['warm', 'light', 'midnight', 'star', 'dark', 'starry-evening'];
for (const id of required) {
  const t = themes[id];
  if (!t) {
    console.error(`MISSING theme: ${id}`);
    failures++;
    continue;
  }
  let worst = 99;
  for (const [fg, bg] of pairs) {
    const r = ratio(t[fg], t[bg]);
    worst = Math.min(worst, r);
    if (r < 4.5) {
      console.error(`FAIL ${id}: ${fg} on ${bg} = ${r.toFixed(2)}:1`);
      failures++;
    }
  }
  console.log(`${id.padEnd(15)} lowest ratio ${worst.toFixed(2)}:1`);
}
if (failures) {
  console.error(`\n${failures} contrast failure(s)`);
  process.exit(1);
}
console.log('\nAll six themes meet WCAG AA (4.5:1) for every checked pair.');

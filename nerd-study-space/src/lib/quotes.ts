// A small rotating set of quiet, non-gimmicky reminders. These are display text,
// not statistics, so showing them does not violate the "no fabricated data" rule.
const QUOTES: { text: string; by: string }[] = [
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', by: 'Will Durant' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', by: 'Confucius' },
  { text: 'The expert in anything was once a beginner.', by: 'Helen Hayes' },
  { text: 'You do not rise to the level of your goals. You fall to the level of your systems.', by: 'James Clear' },
  { text: 'Well begun is half done.', by: 'Aristotle' },
  { text: 'The secret of getting ahead is getting started.', by: 'Mark Twain' },
  { text: 'Small deeds done are better than great deeds planned.', by: 'Peter Marshall' },
  { text: 'Learning never exhausts the mind.', by: 'Leonardo da Vinci' },
  { text: 'Success is the sum of small efforts, repeated day in and day out.', by: 'Robert Collier' },
  { text: 'An investment in knowledge pays the best interest.', by: 'Benjamin Franklin' },
  { text: 'The beautiful thing about learning is that no one can take it away from you.', by: 'B. B. King' },
  { text: 'Focus on being productive instead of busy.', by: 'Tim Ferriss' },
];

export function quoteForDay(dayKey: string) {
  let h = 0;
  for (const c of dayKey) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return QUOTES[h % QUOTES.length];
}

export const sizes = [
  { label: 'XS', points: 1 },
  { label: 'S', points: 2 },
  { label: 'M', points: 3 },
  { label: 'L', points: 5 },
  { label: 'XL', points: 8 },
];
/** Display an observed duration while preserving unknown values as a question mark. */
export const durationText = (days: number | null): string =>
  Number.isFinite(days) ? `${days} ${days === 1 ? 'day' : 'days'}` : '?';

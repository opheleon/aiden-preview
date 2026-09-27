/** Fail at the fixture boundary when a test's required array entry is absent. */
export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required fixture value is missing.');
  return value;
}

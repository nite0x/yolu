// Preserve unchanged JSON-shaped state branches so unrelated subscribers and
// memoized message conversion do not repeat work for identical server snapshots.
export function reuseValue<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) return next;
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let equal = keys.length === Object.keys(before).length;
  const result = Array.isArray(next) ? [] : {};
  for (const key of keys) {
    const value = reuseValue(before[key], after[key]);
    (result as Record<string, unknown>)[key] = value;
    if (!Object.prototype.hasOwnProperty.call(before, key) || value !== before[key]) equal = false;
  }
  return equal ? previous : result as T;
}

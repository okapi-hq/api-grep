/**
 * Keys a report record cannot hold, though scanned code can produce them as property, query or host names:
 * `__proto__` sets an object's prototype instead of adding a property, and the report schema rejects a record with an
 * own `constructor`. They are dropped or read as unknown keys instead.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor"]);

export function isSafeKey(key: string): boolean {
  return !UNSAFE_KEYS.has(key);
}

// the web app's own `@/lib/db`: an in-memory cache with the same method names, no SDK
const rows = new Map<string, unknown[]>();

export const db = {
  from(table: string) {
    return { select: (_cols: string) => Promise.resolve(rows.get(table) ?? []) };
  },
};

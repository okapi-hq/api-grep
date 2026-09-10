declare const db: { query(sql: string): Promise<unknown> };

function fetch(sql: string) {
  return db.query(sql);
}

export const rows = () => fetch("SELECT * FROM users");

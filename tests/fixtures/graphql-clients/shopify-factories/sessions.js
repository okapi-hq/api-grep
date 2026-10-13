const sessions = new Map();

export async function loadSession(shop) {
  return sessions.get(shop);
}

/** Not a client: a plain object a factory returns, whose property is called like one. */
export function makeLogger() {
  const logger = { request: (msg) => console.log(msg) };
  return { logger };
}

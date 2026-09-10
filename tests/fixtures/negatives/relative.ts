export const createUser = (name: string) => fetch("/api/users", { method: "POST", body: JSON.stringify({ name }) });

import { apiFetch } from "@/lib/api";

// the admin package maps `@/` to its own src/, through the config its tsconfig.json references
export const removeUser = (id: string) => apiFetch(`/users/${id}`, { method: "DELETE" });

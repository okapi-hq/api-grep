import { apiFetch } from "@/lib/api";

// `@/` is the web package's own alias, in web/tsconfig.json
export const loadCart = () => apiFetch("/v1/cart");

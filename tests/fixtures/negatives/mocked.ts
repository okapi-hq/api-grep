import { vi } from "vitest";

export const axios = { post: vi.fn() };
axios.post("https://api.stripe.com/v1/customers", {});

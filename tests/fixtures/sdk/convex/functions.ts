import { query } from "convex/server";

// defines a Convex function: not a call
export const list = query({ args: {}, handler: async () => [] });

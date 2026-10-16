import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const schema = z.object({
  CHAT_MODEL: z.string().min(1).default("gpt-4o-mini"),
  EMBED_MODEL: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export const env = schema.parse(process.env);

export const t3 = createEnv({
  server: {
    SUMMARY_MODEL: z.string().default("gpt-4.1-mini"),
    VISION_MODEL: z.string(),
  },
  runtimeEnv: {
    SUMMARY_MODEL: process.env.SUMMARY_MODEL,
    VISION_MODEL: process.env.NOTES_VISION_MODEL,
  },
});

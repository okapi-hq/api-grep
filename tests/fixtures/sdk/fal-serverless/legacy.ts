import * as fal from "@fal-ai/serverless-client";

fal.config({ credentials: process.env.FAL_KEY });

export const paint = (prompt: string) => fal.run("fal-ai/fast-sdxl", { input: { prompt } });

export const paintQueued = (prompt: string) => fal.subscribe("fal-ai/fast-sdxl", { input: { prompt }, pollInterval: 1000 });

export const check = (requestId: string) => fal.queue.status("fal-ai/fast-sdxl", { requestId, logs: false });

export const share = (file: Blob) => fal.storage.upload(file);

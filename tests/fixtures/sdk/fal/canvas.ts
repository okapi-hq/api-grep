import { createFalClient, fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });

export const paint = (prompt: string) => fal.run("fal-ai/flux/dev", { input: { prompt, num_images: 1 } });

export const paintQueued = (prompt: string) => fal.subscribe("fal-ai/flux/schnell", { input: { prompt }, logs: true, onQueueUpdate: (u) => console.log(u.status) });

export const enqueue = (imageUrl: string) => fal.queue.submit("acme-studio/upscaler", { input: { image_url: imageUrl }, webhookUrl: "https://hooks.example.com/fal" });

export const check = (requestId: string) => fal.queue.status("acme-studio/upscaler", { requestId, logs: true });

export const fetchResult = (requestId: string) => fal.queue.result("acme-studio/upscaler", { requestId });

export const stop = (requestId: string) => fal.queue.cancel("acme-studio/upscaler", { requestId });

export const tokens = (prompt: string) => fal.stream("acme-studio/storyteller", { input: { prompt } });

export const share = (file: File) => fal.storage.upload(file);

const studio = createFalClient({ credentials: () => process.env.FAL_KEY });

export const later = (appId: string, prompt: string) => studio.run(appId, { input: { prompt } });

export const live = () => fal.realtime.connect("fal-ai/lcm-sd15-i2i", { onResult: (r) => console.log(r) });

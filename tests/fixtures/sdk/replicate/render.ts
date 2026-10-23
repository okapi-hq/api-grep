import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export const sketch = (prompt: string) => replicate.run("acme-labs/sketchy:5f1b2c3d4e5f60718293a4b5c6d7e8f9", { input: { prompt, steps: 20 }, wait: { mode: "poll", interval: 1000 } });

export const poster = (prompt: string) => replicate.run("acme-labs/poster-maker", { input: { prompt } });

export async function queued(prompt: string) {
  return replicate.predictions.create({ model: "acme-labs/poster-maker", input: { prompt }, webhook: "https://hooks.example.com/done", wait: 30, signal: AbortSignal.timeout(60000) });
}

export const byVersion = (prompt: string) => replicate.predictions.create({ version: "5f1b2c3d4e5f60718293a4b5c6d7e8f9", input: { prompt } });

export const check = (id: string) => replicate.predictions.get(id);

export const onDeployment = (text: string) => replicate.deployments.predictions.create("acme-labs", "tuned-captioner", { input: { text }, wait: true });

export const model = () => replicate.models.get("acme-labs", "sketchy");

export const tune = (images: string) =>
  replicate.trainings.create("acme-labs", "sketchy", "5f1b2c3d4e5f60718293a4b5c6d7e8f9", { destination: "acme-labs/sketchy-tuned", input: { images } });

export async function* live(ref: string, prompt: string) {
  yield* replicate.stream(ref, { input: { prompt }, signal: AbortSignal.timeout(60000), useFileOutput: false });
}

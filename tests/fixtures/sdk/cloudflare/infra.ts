import Cloudflare from "cloudflare";

const cf = new Cloudflare({ apiToken: process.env.CLOUDFLARE_API_TOKEN });
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID!;

export const zonesFor = (name: string) => cf.zones.list({ name });

export const zone = (zoneId: string) => cf.zones.get({ zone_id: zoneId });

export const addRecord = (zoneId: string, name: string, ip: string) =>
  cf.dns.records.create({ zone_id: zoneId, type: "A", name, content: ip, ttl: 300, proxied: true });

export const records = (zoneId: string) => cf.dns.records.list({ zone_id: zoneId, type: "CNAME", per_page: 100 });

export const moveRecord = (zoneId: string, recordId: string, ip: string) => cf.dns.records.update(recordId, { zone_id: zoneId, type: "A", name: "edge", content: ip });

export const dropRecord = (zoneId: string, recordId: string) => cf.dns.records.delete(recordId, { zone_id: zoneId });

export const purge = (zoneId: string, urls: string[]) => cf.cache.purge({ zone_id: zoneId, files: urls });

export const caption = (image: number[]) => cf.ai.run("@cf/llava-hf/llava-1.5-7b-hf", { account_id: ACCOUNT, image, prompt: "Describe the picture" });

export const legacyRun = (prompt: string) => cf.workers.ai.run("@cf/meta/llama-3-8b-instruct", { account_id: ACCOUNT, prompt });

export const remember = (namespaceId: string, key: string, value: string) =>
  cf.kv.namespaces.values.update(namespaceId, key, { account_id: ACCOUNT, value, metadata: "{}" });

export const recall = (namespaceId: string, key: string) => cf.kv.namespaces.values.get(namespaceId, key, { account_id: ACCOUNT });

export const recallV7 = (namespaceId: string, key: string) => cf.kv.namespaces.values.get(key, { account_id: ACCOUNT, namespace_id: namespaceId });

export const sql = (databaseId: string, userId: string) => cf.d1.database.query(databaseId, { account_id: ACCOUNT, sql: "SELECT * FROM notes WHERE owner = ?", params: [userId] });

export const buckets = () => cf.r2.buckets.list({ account_id: ACCOUNT });

export const scripts = () => cf.workers.scripts.list({ account_id: ACCOUNT });

export const project = (name: string) => cf.pages.projects.get(name, { account_id: ACCOUNT });

export const rename = (zoneId: string) => cf.zones.edit({ zone_id: zoneId, paused: true });

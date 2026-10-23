import { argAt, propOf } from "../ir/args.js";
import { loadedConfigExpr } from "../ir/config-load.js";
import type { Scoped } from "../ir/language.js";
import type { IrCtx, IrRaw, Seg } from "../ir/raw.js";
import { instanceIndex } from "../ir/sdk.js";
import { pathOf } from "./config-load.js";

const PACKAGE = "google-auth-oauthlib";

/** Where each construction takes the client configuration (`Flow(session, client_type, client_config)`). */
const CONFIG_ARG: Record<string, string> = {
  from_client_config: "kw:client_config|0",
  Flow: "kw:client_config|2",
  InstalledAppFlow: "kw:client_config|2",
};

/** The client configuration a flow was built with: a dict of the code, or the client secrets file a literal path names. */
function clientConfig(seg: Seg, raw: IrRaw, ctx: IrCtx): Scoped | undefined {
  if (seg.name !== "from_client_secrets_file") return CONFIG_ARG[seg.name] ? argAt(seg, CONFIG_ARG[seg.name]!, ctx) : undefined;
  const file = argAt(seg, "kw:client_secrets_file|0", ctx);
  const literal = file ? pathOf(file.expr, file.fn, ctx) : undefined;
  const fn = seg.fn ?? raw.fn;
  const expr = literal ? loadedConfigExpr(literal, fn, ctx) : undefined;
  return expr ? { expr, fn } : undefined;
}

/**
 * google-auth-oauthlib (`google-auth-oauthlib.json`): a flow's token exchange goes to the `token_uri` of the client
 * configuration it was built with, under `web` or `installed` as the library reads it. Unread, the host stays unknown.
 */
export function refineOauthlib(raw: IrRaw, ctx: IrCtx): IrRaw {
  const m = raw.sdk;
  if (m?.entry.package !== PACKAGE || m.spec.host) return raw;
  const inst = instanceIndex(m.entry, m.segs);
  const config = inst >= 0 ? clientConfig(m.segs[inst]!, raw, ctx) : undefined;
  const app = config ? (propOf(config, "web", ctx) ?? propOf(config, "installed", ctx)) : undefined;
  const url = propOf(app, "token_uri", ctx);
  return url ? { ...raw, url } : raw;
}

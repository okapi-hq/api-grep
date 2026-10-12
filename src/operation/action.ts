import type { ResolvedCall } from "../assemble.js";
import { operationParamOf, resolveProvider } from "../normalize/provider.js";
import type { Operation } from "../report/schema.js";
import type { Shape } from "../types.js";
import { namesOf } from "./names.js";

/**
 * Action-style APIs (#36): one URL, and a query or form parameter that names the operation (AWS Query
 * `Action=DescribeInstances`, Flickr `method=flickr.photos.search`). Which parameter is data: the provider's
 * `operationParam` in `providers.json`; a provider without one has no action operation.
 */

function own(record: Record<string, Shape> | undefined, key: string): Shape | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function operationOf(value: Shape, from: Operation["from"]): Operation {
  const { names, dynamic } = namesOf(value);
  return { protocol: "action", name: names[0] ?? null, ...(names.length > 1 ? { alternatives: names } : {}), dynamic, from };
}

export function actionOperations(r: ResolvedCall): Operation[] {
  const { provider } = resolveProvider({ hostKind: r.url.hostKind, host: r.url.host, envName: r.url.envName });
  const param = operationParamOf(provider);
  if (!param) return [];
  const query = own(r.query.shape, param) ?? own(r.url.queryShape, param);
  if (query) return [operationOf(query, "query")];
  const body = r.body.shape;
  const field = r.body.encoding === "form" && body?.type === "object" ? own(body.properties, param) : undefined;
  return field ? [operationOf(field, "body")] : [];
}

/**
 * Ports the TypeScript Stripe registry (generated from Stripe's OpenAPI spec, see gen-registry.ts) to the Stripe SDKs of
 * the other languages, which expose the same services under their own naming:
 *
 *   stripe-python  StripeClient services in snake_case (`client.payment_intents.create(params={...})`, also under
 *                  `client.v1`), and the classic resource API (`stripe.PaymentIntent.create(amount=...)`); every
 *                  method also has its `*_async` twin.
 *   stripe-php     StripeClient services, camelCase like TypeScript (`$stripe->paymentIntents->create([...])`, `all`
 *                  for `list`, `delete` for `del`), the static API (`\Stripe\Customer::create([...])`), and the
 *                  operations of a retrieved object (`\Stripe\PaymentIntent::retrieve($id)->confirm([...])`).
 *
 *   pnpm gen:stripe-ports
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IrMethodSpec, IrRegistryEntry } from "../src/lang/ir/language.js";
import type { MethodSpec, RegistryEntry } from "../src/types.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = JSON.parse(readFileSync(path.join(root, "src/detect/registry/stripe.json"), "utf8")) as RegistryEntry;

const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const pascal = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const CLASSES: Record<string, string> = { balance: "Balance", oauth: "OAuth" };

/** `checkout.sessions` -> `checkout.Session`, `paymentIntents` -> `PaymentIntent`. */
function resourceClass(service: string): string {
  const parts = service.split(".");
  const last = parts.pop()!;
  const cls = CLASSES[last] ?? pascal(last.replace(/s$/, ""));
  return [...parts.map(snake), cls].join(".");
}

/** StripeClient services take the parameters as `params` (positional after the path arguments, or keyword). */
function clientSpec(spec: MethodSpec): IrMethodSpec {
  const out: IrMethodSpec = { ...spec };
  if (spec.bodyArg !== undefined) out.bodyKw = "params";
  return out;
}

/** The classic API takes the parameters as keyword arguments: `stripe.Customer.modify("cus_1", name="Ada")`. */
function classicSpec(spec: MethodSpec): IrMethodSpec {
  const { bodyArg, queryArg, ...rest } = spec;
  const out: IrMethodSpec = { ...rest };
  if (bodyArg !== undefined) out.bodyKwargs = true;
  if (queryArg !== undefined) out.queryKwargs = true;
  return out;
}

const CLASSIC_VERBS: Record<string, string> = { update: "modify", del: "delete" };

function python(): IrRegistryEntry {
  const methods: Record<string, IrMethodSpec> = {};
  const classic: Record<string, IrMethodSpec> = {};
  for (const [key, spec] of Object.entries(ts.methods ?? {})) {
    const parts = key.split(".");
    const verb = parts.pop()!;
    const service = parts.join(".");
    const pyKey = [...parts.map(snake), verb === "del" ? "delete" : snake(verb)].join(".");
    const classicKey = `${resourceClass(service)}.${CLASSIC_VERBS[verb] ?? snake(verb)}`;
    for (const suffix of ["", "_async"]) {
      methods[`${pyKey}${suffix}`] = clientSpec(spec);
      methods[`v1.${pyKey}${suffix}`] = clientSpec(spec);
      classic[`${classicKey}${suffix}`] = classicSpec(spec);
    }
  }
  return {
    package: "stripe",
    imports: ["stripe"],
    provider: ts.provider,
    host: ts.host,
    auth: ts.auth,
    generatedFrom: "scripts/port-stripe.ts from src/detect/registry/stripe.json",
    instance: { names: ["StripeClient"] },
    methods: { ...methods, ...classic },
  };
}

const PHP_SKIP = new Set(["subscriptions.del", "subscriptionItems.createUsageRecord", "invoices.retrieveUpcoming"]);
const PHP_STATIC = new Set(["create", "retrieve", "update", "list", "search"]);

/** `list` -> `all`, `listLineItems` -> `allLineItems`, `del` -> `delete`. */
function phpVerb(verb: string): string {
  if (verb === "del") return "delete";
  return verb.startsWith("list") ? `all${verb.slice(4)}` : verb;
}

/** `checkout.sessions` -> `Checkout.Session` (`\Stripe\Checkout\Session`). */
function phpClass(service: string): string {
  const parts = service.split(".");
  const last = parts.pop()!;
  return [...parts.map(pascal), CLASSES[last] ?? pascal(last.replace(/s$/, ""))].join(".");
}

/** `$intent = PaymentIntent::retrieve($id); $intent->confirm($params)`: the id comes from `retrieve`. */
function instanceOp(spec: MethodSpec): IrMethodSpec {
  const { pathArgs, bodyArg, queryArg, ...rest } = spec;
  const id = /\{([^}]+)\}/.exec(spec.path)?.[1];
  const shift = (i: number): number => Math.max(0, i - (pathArgs?.length ?? 0));
  const out: IrMethodSpec = { ...rest, ...(id ? { params: { [id]: "seg:retrieve:0" } } : {}) };
  if (bodyArg !== undefined) out.bodyArg = shift(bodyArg);
  if (queryArg !== undefined) out.queryArg = shift(queryArg);
  return out;
}

function php(): IrRegistryEntry {
  const methods: Record<string, IrMethodSpec> = {};
  const statics: Record<string, IrMethodSpec> = {};
  for (const [key, spec] of Object.entries(ts.methods ?? {})) {
    if (PHP_SKIP.has(key)) continue;
    const parts = key.split(".");
    const verb = parts.pop()!;
    const cls = phpClass(parts.join("."));
    methods[[...parts, phpVerb(verb)].join(".")] = spec;
    if (PHP_STATIC.has(verb)) statics[`${cls}.${phpVerb(verb)}`] = spec;
    else if (spec.pathArgs?.length === 1) statics[`${cls}.retrieve.${phpVerb(verb)}`] = instanceOp(spec);
  }
  return {
    package: "stripe/stripe-php",
    imports: ["Stripe"],
    provider: ts.provider,
    host: ts.host,
    auth: ts.auth,
    generatedFrom: "scripts/port-stripe.ts from src/detect/registry/stripe.json",
    instance: { names: ["StripeClient"], urlArg: { StripeClient: "0.api_base" } },
    methods: { ...methods, ...statics },
  };
}

const JAVA_STATIC = new Set(["create", "retrieve", "list", "search"]);
/** StripeClient services that are sub-services in Java (`client.customers().paymentMethods().list(id)`). */
const JAVA_VERBS: Record<string, string> = { del: "delete", listPaymentMethods: "paymentMethods.list", listLineItems: "lineItems.list", createUsageRecord: "usageRecords.create", retrieveUpcoming: "upcoming" };

/** `checkout.sessions` -> `checkout.Session` (`com.stripe.model.checkout.Session`), `billingPortal.sessions` -> `billingportal.Session`. */
function javaClass(service: string): string {
  const parts = service.split(".");
  const last = parts.pop()!;
  return [...parts.map((p) => p.toLowerCase()), CLASSES[last] ?? pascal(last.replace(/s$/, ""))].join(".");
}

/**
 * stripe-java: StripeClient services (`client.customers().update(id, params)`, also under `client.v1()`), the static API
 * of the model classes (`Customer.create(params)`, `Customer.retrieve(id)`), and the operations of a retrieved object
 * (`Customer.retrieve(id).update(params)`, or `customer.update(params)` on a typed `Customer`).
 */
function java(): IrRegistryEntry {
  const methods: Record<string, IrMethodSpec> = {};
  const statics: Record<string, IrMethodSpec> = {};
  for (const [key, spec] of Object.entries(ts.methods ?? {})) {
    const parts = key.split(".");
    const verb = parts.pop()!;
    const service = parts.join(".");
    methods[[...parts, JAVA_VERBS[verb] ?? verb].join(".")] = spec;
    if (service === "oauth") statics[`OAuth.${verb}`] = spec;
    else if (JAVA_STATIC.has(verb)) statics[`${javaClass(service)}.${verb}`] = spec;
    else if (spec.pathArgs?.length === 1 && !JAVA_VERBS[verb]?.includes(".")) {
      const javaVerb = JAVA_VERBS[verb] ?? verb;
      const op = instanceOp(spec);
      statics[`${javaClass(service)}.retrieve.${javaVerb}`] = op;
      statics[`${javaClass(service)}.${javaVerb}`] = { ...op, params: undefined };
    }
  }
  return {
    $comment:
      "stripe-java (also used from Kotlin): parameters are builders of `com.stripe.param` (`CustomerCreateParams.builder().setEmail(e).build()`), read as the form fields they set (`setX` -> `x`, `addX` -> the list `xs`, `putMetadata` -> `metadata`); enum constants are their snake_case values. `{id}` of an operation on a typed model object (`customer.update(params)`) is not known.",
    package: "com.stripe:stripe-java",
    imports: ["com.stripe.model", "com.stripe.net", "com.stripe.StripeClient"],
    provider: ts.provider,
    host: ts.host,
    auth: ts.auth,
    generatedFrom: "scripts/port-stripe.ts from src/detect/registry/stripe.json",
    instance: { names: ["StripeClient", "builder"], build: "build" },
    builders: ["v1"],
    setters: { packages: ["com.stripe.param"], case: "snake", prefixes: ["set", "add", "put"], fields: { addExpand: "expand", addAllExpand: "expand", putExtraParam: "", putAllExtraParam: "" }, constants: { "*": "snake" } },
    methods: { ...methods, ...statics },
  } as IrRegistryEntry;
}

function write(file: string, entry: IrRegistryEntry): void {
  const { methods, ...head } = entry;
  const lines = Object.entries(methods).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const text = `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "methods": {\n${lines.join(",\n")}\n  }\n}\n`;
  writeFileSync(path.join(root, file), text);
  process.stdout.write(`${file}: ${lines.length} methods\n`);
}

write("src/lang/python/registry/stripe.json", python());
write("src/lang/php/registry/stripe-php.json", php());
write("src/lang/jvm/registry/stripe-java.json", java());

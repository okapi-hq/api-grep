import { Kind, type ArgumentNode, type ValueNode } from "graphql";
import { isSafeKey } from "../record-keys.js";
import { isCredentialKey } from "../secrets.js";

/**
 * The arguments of the fields an operation selects (#56), read from the document as written: a literal is kept as its
 * JSON value (an enum value as its name), a variable is `"$name"`. A string or number under a credential name
 * (`password: "x"`, `input: { token: "x" }`) is `<redacted>`, as a body's would lose its value; strings that look like
 * secrets are redacted with the rest of the report. Past a bound the operation's arguments are left out rather than cut short.
 */

export type ArgumentValue = null | boolean | number | string | ArgumentValue[] | { [name: string]: ArgumentValue };
export type ArgumentSet = Record<string, ArgumentValue>;
/** Field path to its arguments; several sets when aliases select one path with different arguments. */
export type FieldArguments = Record<string, ArgumentSet | ArgumentSet[]>;

/** Arguments of one operation, counted across its paths and argument sets. */
export const MAX_ARGUMENTS = 500;
/** Characters of the operation's arguments written as JSON. */
export const MAX_ARGUMENT_CHARS = 20_000;
/** Nesting of lists and input objects in one value. */
const MAX_VALUE_DEPTH = 16;

const REDACTED = "<redacted>";

/** A credential name; `key` alone is not one here: GraphQL APIs use it for a record's key (Shopify `metafield(key:)`). */
const isCredential = (name: string): boolean => name.toLowerCase() !== "key" && isCredentialKey(name);

class TooLarge extends Error {}

function objectValue(fields: readonly { name: { value: string }; value: ValueNode }[], depth: number, credential: boolean): ArgumentSet {
  const out: ArgumentSet = {};
  for (const f of fields) {
    const name = f.name.value;
    if (isSafeKey(name)) out[name] = valueOf(f.value, depth + 1, credential || isCredential(name));
  }
  return out;
}

/** An integer past 2^53 keeps its digits as written. */
function numberOf(text: string, integer: boolean): number | string {
  const n = Number(text);
  return Number.isFinite(n) && (!integer || Number.isSafeInteger(n)) ? n : text;
}

function valueOf(v: ValueNode, depth: number, credential: boolean): ArgumentValue {
  if (depth > MAX_VALUE_DEPTH) throw new TooLarge();
  switch (v.kind) {
    case Kind.VARIABLE:
      return `$${v.name.value}`;
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return v.values.map((x) => valueOf(x, depth + 1, credential));
    case Kind.OBJECT:
      return objectValue(v.fields, depth, credential);
    case Kind.ENUM:
    case Kind.BOOLEAN:
      // a name the schema defines (`sortKey: CREATED_AT`), never a credential
      return v.value;
    case Kind.STRING:
      return credential ? REDACTED : v.value;
    case Kind.INT:
    case Kind.FLOAT:
      return credential ? REDACTED : numberOf(v.value, v.kind === Kind.INT);
  }
}

interface Read {
  set: ArgumentSet;
  key: string;
}

/** The argument sets of each path an operation selects, deduplicated, within the bounds. */
export class ArgumentCollector {
  private readonly paths = new Map<string, Map<string, ArgumentSet>>();
  /** A fragment spread many times gives the same nodes: each argument list is read once. */
  private readonly read = new WeakMap<readonly ArgumentNode[], Read>();
  private count = 0;
  private chars = 0;
  private full = false;

  add(path: string, args: readonly ArgumentNode[] | undefined): void {
    if (this.full || !isSafeKey(path)) return;
    try {
      const { set, key } = args && args.length > 0 ? this.readArguments(args) : { set: {}, key: "{}" };
      let sets = this.paths.get(path);
      if (!sets) this.paths.set(path, (sets = new Map<string, ArgumentSet>()));
      if (sets.has(key)) return;
      this.count += Object.keys(set).length;
      this.chars += path.length + key.length;
      if (this.count > MAX_ARGUMENTS || this.chars > MAX_ARGUMENT_CHARS) throw new TooLarge();
      sets.set(key, set);
    } catch (err) {
      if (!(err instanceof TooLarge)) throw err;
      this.full = true;
    }
  }

  private readArguments(args: readonly ArgumentNode[]): Read {
    let r = this.read.get(args);
    if (!r) {
      const set = objectValue(args, -1, false);
      r = { set, key: JSON.stringify(set) };
      if (r.key.length > MAX_ARGUMENT_CHARS) throw new TooLarge();
      this.read.set(args, r);
    }
    return r;
  }

  /** Sorted by path; undefined past a bound or when no selected field has arguments. */
  result(): FieldArguments | undefined {
    if (this.full) return undefined;
    const out: FieldArguments = {};
    for (const path of [...this.paths.keys()].sort()) {
      const sets = [...this.paths.get(path)!.values()];
      // a path selected only without arguments is not listed; beside one with arguments, its `{}` is kept
      if (sets.every((s) => Object.keys(s).length === 0)) continue;
      out[path] = sets.length === 1 ? sets[0]! : sets;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

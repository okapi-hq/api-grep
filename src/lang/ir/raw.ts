import type { ClientFrom, ClientKind } from "../../report/schema.js";
import type { AuthScheme, BodyEncoding } from "../../types.js";
import type { IrMethodSpec, IrRegistryEntry, OptionRole, Scoped } from "./language.js";
import type { CallExpr, ClassDef, FunctionDef, Param } from "./model.js";
import type { ProjectIndex } from "./project.js";

/** Wrapper expansion: a wrapper's parameters stand for the caller's arguments. */
export type Subst = Map<Param, Scoped>;

export interface IrCtx {
  idx: ProjectIndex;
  subst?: Subst;
  envHints?: Record<string, string>;
  /** The class of the object a method runs on, when it extends the method's own (`self`, `$this`, `static::` bind late). */
  self?: ClassDef;
  /** Packages the manifests of a file's directories declare, as `normalizePackage` writes them. */
  declared?: (file: string) => Set<string>;
  /** Reading a caller's argument for a parameter's values (`param-values.ts`): its own parameters are not followed up. */
  callerLevel?: boolean;
  /** The scanned directory: configuration files the code does not name are read below it only. */
  rootDir?: string;
}

/** The context for code running on an object of class `cls`. */
export function withSelf(ctx: IrCtx, cls: ClassDef | undefined): IrCtx {
  return cls && cls !== ctx.self ? { ...ctx, self: cls } : ctx;
}

export type DetectCtx = IrCtx;

/** One member of a call chain: `client`, `chat`, `create(...)`; a call carries its arguments and their scope. */
export interface Seg {
  name: string;
  call?: CallExpr;
  fn?: FunctionDef;
  /** Substitutions in effect where the call is written (a factory's parameters). */
  subst?: Subst;
  /** An instance known from a declared type (`client: OpenAI`), not from a constructor call. */
  typed?: boolean;
}

/** Where a query parameter or header comes from when the client adds it to every request rather than the call. */
export type ClientPartFrom = "interceptor" | "default";

/**
 * One query parameter or header set by name (`header("X", v)`, `addQueryParameter("k", v)`), read where it is
 * written: an interceptor's values read with the interceptor's constructor arguments (`subst`) and class (`self`).
 */
export interface IrPair {
  where: "query" | "header";
  name: Scoped;
  value?: Scoped;
  /** Added by the client (an interceptor, a default of its builder) to every request it sends. */
  from?: ClientPartFrom;
  /** Set on some runs only of the code that adds it (a branch of an interceptor, `conditional.ts`). */
  optional?: boolean;
  subst?: Subst;
  self?: ClassDef;
}

export interface IrSdkMatch {
  entry: IrRegistryEntry;
  key: string;
  spec: IrMethodSpec;
  /** The chain after the import root: constructor, builders, method. */
  segs: Seg[];
  method: Seg;
}

/** A detected call, before resolution: where its URL, method, body, query and headers are. */
export interface IrRaw {
  call: CallExpr;
  fn: FunctionDef;
  client: ClientKind;
  url?: Scoped;
  baseUrl?: Scoped;
  /** `reference`: the URL is a reference resolved against the base by RFC 3986 (Retrofit), not appended to it. */
  urlJoin?: "reference";
  method?: Scoped;
  impliedMethod?: string;
  body?: Scoped;
  bodyRole?: OptionRole;
  encoding?: BodyEncoding;
  query?: Scoped;
  headers: Scoped[];
  /** Query parameters and headers set one at a time (builder steps, interceptors, annotated parameters). */
  pairs?: IrPair[];
  auth?: AuthScheme;
  sdk?: IrSdkMatch;
  /** Options present but not readable (a variable holding unknown options): method and body may be wrong. */
  optionsOpaque?: boolean;
  via?: string;
  subst?: Subst;
  /** The class of the object a wrapper ran on (`self._get(...)` in a subclass): what `self` reads binds to it. */
  self?: ClassDef;
  /** Expressions the request is built from: a wrapper is a function whose parameters flow into them. */
  inputs: Scoped[];
  /** The model when it is not a body property (an agent's, a routed library's). */
  model?: Scoped;
  /** The client is an untyped parameter: known from the callers, or from the one SDK the manifests declare with that method. */
  clientFrom?: ClientFrom;
  /**
   * Other requests the same call may send (a request factory with several returns, a request started in several
   * branches): each is a call of its own at the same place.
   */
  alternatives?: IrRaw[];
}

/** A detected call and the other requests it may send. */
export const withAlternatives = (raw: IrRaw): IrRaw[] => (raw.alternatives ? [{ ...raw, alternatives: undefined }, ...raw.alternatives] : [raw]);

export function withSubst(ctx: IrCtx, subst: Subst | undefined): IrCtx {
  if (!subst || subst.size === 0) return ctx;
  return { ...ctx, subst: ctx.subst ? new Map([...ctx.subst, ...subst]) : subst };
}

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
  method?: Scoped;
  impliedMethod?: string;
  body?: Scoped;
  bodyRole?: OptionRole;
  encoding?: BodyEncoding;
  query?: Scoped;
  headers: Scoped[];
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
}

export function withSubst(ctx: IrCtx, subst: Subst | undefined): IrCtx {
  if (!subst || subst.size === 0) return ctx;
  return { ...ctx, subst: ctx.subst ? new Map([...ctx.subst, ...subst]) : subst };
}

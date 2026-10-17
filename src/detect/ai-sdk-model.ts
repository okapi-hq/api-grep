import { Node, SyntaxKind, VariableDeclarationKind, type CallExpression, type Expression, type VariableDeclaration } from "ts-morph";
import { guardedValue, isStringLike } from "../ast/expr.js";
import { isFunctionLike, returnsOf } from "../ast/function.js";
import { declarationsOf, getProp, importedVariable, propertyValue, toObjectLiteral } from "../ast/object.js";
import { describeCallee, exportedChain, wrapperFunction } from "./callee.js";
import data from "./registry/ai-sdk.json" with { type: "json" };

export interface AiSdkProvider {
  package: string;
  provider: string;
  host: string;
  basePath?: string;
  auth: string;
  paths: Record<string, string>;
}

export const PROVIDERS = new Map<string, AiSdkProvider>((data.providers as unknown as AiSdkProvider[]).map((p) => [p.package, p]));
export const GATEWAY = data.gateway as unknown as AiSdkProvider;

export interface Model {
  entry: AiSdkProvider;
  member: string;
  modelId?: Expression;
  baseUrl?: Expression;
}

/** The models an expression may be, one per distinct reading; undefined when one of the ways it can go is not traced. */
export type Models = Model[] | undefined;

const MAX_DEPTH = 6;
/** Candidates kept per call, as for host tables (`resolve/choice.ts`). */
const MAX_MODELS = 20;
const WRAPPERS = new Set(["wrapLanguageModel", "experimental_wrapLanguageModel"]);
const CUSTOM_PROVIDERS = new Set(["customProvider", "experimental_customProvider"]);
/** Methods of a `customProvider`, each reading the map of its name plus `s` (`languageModel` -> `languageModels`). */
const MODEL_METHODS = new Set(["languageModel", "textEmbeddingModel", "imageModel", "transcriptionModel", "speechModel"]);

/**
 * `openai("gpt-4o")`, `openai.chat("gpt-4o")`, `myOpenAI("x")` with `myOpenAI = createOpenAI({ baseURL })`, `"openai/gpt-4o"`;
 * a model the app's `customProvider` maps a name to (`myProvider.languageModel("chat-model")`), a local function's
 * returns (`model: pickModel()`), a `let` given its model in branches, a constant imported from another file. A model
 * picked at run time among several is each of them.
 */
export function resolveModels(expr: Expression, depth = 0): Models {
  if (depth > MAX_DEPTH) return undefined;
  const u = guardedValue(expr);
  if (isStringLike(u)) return [{ entry: GATEWAY, member: "", modelId: u }];
  if (Node.isIdentifier(u)) return identifierModels(u, depth);
  if (Node.isConditionalExpression(u)) return branchModels([u.getWhenTrue(), u.getWhenFalse()].map((b) => resolveModels(b, depth + 1)));
  return Node.isCallExpression(u) ? callModels(u, depth) : undefined;
}

/**
 * The model of a call's options: `{ model }`, or the `model` of the object a local helper returns and the options
 * spread (`streamText({ ...modelOptions(id), messages })`).
 */
export function optionsModels(options: Expression | undefined): Models {
  const own = getProp(options, "model");
  if (own) return resolveModels(own);
  const spreads = toObjectLiteral(options)?.getProperties().filter((p) => Node.isSpreadAssignment(p)) ?? [];
  for (const spread of spreads.reverse()) {
    const u = guardedValue(spread.getExpression());
    const fn = Node.isCallExpression(u) ? wrapperFunction(describeCallee(u)) : undefined;
    const models = isFunctionLike(fn) ? returnsOf(fn).map((r) => getProp(r, "model")) : [];
    if (models.length > 0) return allOf(models.map((m) => (m ? resolveModels(m, 1) : undefined)));
  }
  return undefined;
}

/** A constant's value (imported ones too), a parameter's default, or what a `let` without one is given later. */
function identifierModels(id: Expression, depth: number): Models {
  const decl = declarationsOf(id)[0];
  const init = decl && (Node.isVariableDeclaration(decl) || Node.isParameterDeclaration(decl)) ? decl.getInitializer() : importedVariable(id)?.getInitializer();
  if (init) return resolveModels(init, depth + 1);
  const values = decl && Node.isVariableDeclaration(decl) ? assignedValues(decl) : [];
  return values.length > 0 ? allOf(values.map((v) => resolveModels(v, depth + 1))) : undefined;
}

/** `let model; if (a) model = openai(x); else model = anthropic(y)`: every value the file assigns the variable. */
function assignedValues(decl: VariableDeclaration): Expression[] {
  if (decl.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const || !Node.isIdentifier(decl.getNameNode())) return [];
  const name = decl.getName();
  const scope = decl.getFirstAncestor((a) => isFunctionLike(a)) ?? decl.getSourceFile();
  return scope.getDescendantsOfKind(SyntaxKind.BinaryExpression).flatMap((bin) => {
    const left = bin.getLeft();
    const assigns = bin.getOperatorToken().getKind() === SyntaxKind.EqualsToken && Node.isIdentifier(left) && left.getText() === name;
    return assigns && declarationsOf(left)[0] === decl ? [bin.getRight()] : [];
  });
}

function callModels(u: CallExpression, depth: number): Models {
  const fn = u.getExpression();
  if (Node.isPropertyAccessExpression(fn) && MODEL_METHODS.has(fn.getName())) {
    const custom = customModels(fn.getExpression(), fn.getName(), u.getArguments()[0] as Expression | undefined, depth + 1);
    if (custom) return custom;
  }
  const c = describeCallee(u);
  const name = exportedChain(c).join(".");
  if (c.package === "ai" && WRAPPERS.has(name)) {
    const inner = getProp(u.getArguments()[0] as Expression | undefined, "model");
    return inner ? resolveModels(inner, depth + 1) : undefined;
  }
  const entry = c.package ? PROVIDERS.get(c.package) : undefined;
  if (!entry) {
    const local = wrapperFunction(c);
    return isFunctionLike(local) && depth < MAX_DEPTH ? allOf(returnsOf(local).map((r) => resolveModels(r, depth + 1))) : undefined;
  }
  const member = c.instance ? c.chain.join(".") : exportedChain(c).slice(1).join(".");
  const baseUrl = c.instance ? getProp(c.instance.args[0], "baseURL") : undefined;
  return [{ entry, member, modelId: u.getArguments()[0] as Expression | undefined, baseUrl }];
}

/** `myProvider.languageModel(key)` on `customProvider({ languageModels: { [key]: model } })` from `ai`. */
function customModels(receiver: Expression, method: string, key: Expression | undefined, depth: number): Models {
  if (depth > MAX_DEPTH) return undefined;
  const u = guardedValue(receiver);
  if (Node.isIdentifier(u)) {
    const decl = declarationsOf(u)[0];
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : importedVariable(u)?.getInitializer();
    return init ? customModels(init, method, key, depth + 1) : undefined;
  }
  if (Node.isConditionalExpression(u)) return branchModels([u.getWhenTrue(), u.getWhenFalse()].map((b) => customModels(b, method, key, depth + 1)));
  if (!Node.isCallExpression(u)) return undefined;
  const c = describeCallee(u);
  if (c.package !== "ai" || !CUSTOM_PROVIDERS.has(exportedChain(c).join("."))) return undefined;
  const map = getProp(u.getArguments()[0] as Expression | undefined, `${method}s`);
  const k = key ? guardedValue(key) : undefined;
  if (k && (Node.isStringLiteral(k) || Node.isNoSubstitutionTemplateLiteral(k))) {
    const value = getProp(map, k.getLiteralValue());
    return value ? resolveModels(value, depth + 1) : undefined;
  }
  // a name chosen at run time: any of the entries
  const values = toObjectLiteral(map)?.getProperties().map((p) => propertyValue(p)) ?? [];
  return values.length > 0 ? allOf(values.map((v) => (v ? resolveModels(v, depth + 1) : undefined))) : undefined;
}

/** Ways that are all taken by some run: every one must be traced. */
function allOf(found: Models[]): Models {
  return found.some((m) => !m) ? undefined : distinct(found.flatMap((m) => m!));
}

/**
 * The branches of `isTest ? mockProvider : realProvider`: a branch that names no provider at all (a test double built
 * from local models) sends nothing, so the models are those of the other branches.
 */
function branchModels(found: Models[]): Models {
  const traced = found.filter((m): m is Model[] => !!m);
  return traced.length > 0 ? distinct(traced.flat()) : undefined;
}

/** One reading per provider, endpoint, base URL and model id written; over `MAX_MODELS`, none (the model is unknown). */
function distinct(models: Model[]): Models {
  const key = (m: Model): string => [m.entry.package, m.member, m.baseUrl?.getText() ?? "", m.modelId?.getText() ?? ""].join("\u0000");
  const out = new Map<string, Model>();
  for (const m of models) if (!out.has(key(m))) out.set(key(m), m);
  return out.size <= MAX_MODELS ? [...out.values()] : undefined;
}

import { Node, type CallExpression, type Expression, type ObjectLiteralExpression } from "ts-morph";
import { memberChain, unwrap } from "../ast/expr.js";
import { declarationsOf, importedVariable, propertyKey, propertyValue } from "../ast/object.js";
import { configAt, isInterpolated, loadConfig, type ConfigValue, type LoadedConfig } from "../model/config-files.js";
import { VALUE_SOURCES, type EvalCtx, type Shape } from "../types.js";
import { evaluate, staticText } from "./evaluate.js";
import { jsonToShape } from "./shape-utils.js";

/**
 * `config.llm.model` where `config` is a config file the code loads by a literal path (`import config from
 * "./config.json"`, `require("./config.json")`, `JSON.parse(readFileSync("settings.json", "utf8"))`, `yaml.parse(...)`),
 * or an env schema it parses `process.env` with (`schema.parse(process.env)` with zod, t3's `createEnv`): the value the
 * file gives, or the env var the schema reads with its `.default(...)`.
 */

const PARSERS = /^(JSON\.parse|ya?ml\.(parse|load|safeLoad)|YAML\.(parse|load)|jsyaml\.load|jsYaml\.load|toml\.parse|TOML\.parse)$/;
const READS = /^(fs\.)?(readFileSync|readFile)$|^fs\.promises\.readFile$|^fsp\.readFile$/;
const ENV = /^(process\.env|import\.meta\.env)$/;
const MAX_DEPTH = 4;

/** The literal path a file read names: `"x.json"`, `path.join(__dirname, "x.json")`, `new URL("./x.json", import.meta.url)`. */
function pathOf(e: Expression | undefined, ctx: EvalCtx): string | undefined {
  if (!e) return undefined;
  const u = unwrap(e);
  if (Node.isNewExpression(u) && u.getExpression().getText() === "URL") return pathOf(u.getArguments()[0] as Expression | undefined, ctx);
  if (Node.isCallExpression(u) && /^path\.(join|resolve)$/.test(u.getExpression().getText())) {
    const [first, ...rest] = u.getArguments() as Expression[];
    if (!first || !/^(__dirname|process\.cwd\(\)|import\.meta\.dirname)$/.test(first.getText())) return undefined;
    const parts = rest.map((a) => staticText(evaluate(a, ctx)));
    return parts.every((p) => p !== undefined) ? parts.join("/") : undefined;
  }
  return staticText(evaluate(u, ctx));
}

/** The literal path of the file a parsed value comes from (`JSON.parse(readFileSync(p))`, `require(p)`). */
function loadedPath(init: Expression, ctx: EvalCtx): string | undefined {
  const u = unwrap(init);
  if (!Node.isCallExpression(u)) return undefined;
  const callee = u.getExpression().getText();
  const arg = u.getArguments()[0] as Expression | undefined;
  if (callee === "require") return pathOf(arg, ctx);
  if (!PARSERS.test(callee) || !arg) return undefined;
  let read = unwrap(arg);
  // `readFileSync(p).toString()`, `(await readFile(p, "utf8"))`
  const toString = Node.isCallExpression(read) ? read.getExpression() : undefined;
  if (Node.isPropertyAccessExpression(toString) && toString.getName() === "toString") read = unwrap(toString.getExpression());
  return Node.isCallExpression(read) && READS.test(read.getExpression().getText()) ? pathOf(read.getArguments()[0] as Expression | undefined, ctx) : undefined;
}

/** A module specifier the identifier is imported from, and the export it names (`default` for a default or namespace import). */
function importOf(id: Expression): { spec: string; name: string } | undefined {
  for (const d of declarationsOf(id)) {
    const decl = d.getFirstAncestor((a) => Node.isImportDeclaration(a));
    if (!decl || !Node.isImportDeclaration(decl)) continue;
    const name = Node.isImportSpecifier(d) ? d.getNameNode().getText() : "default";
    return { spec: decl.getModuleSpecifierValue(), name };
  }
  return undefined;
}

type Source = { config: LoadedConfig; keys: string[] } | { schema: CallExpression; keys: string[] };

/** What the root of an access chain holds: a loaded config file, or an env schema's parse. */
function rootSource(root: Expression, ctx: EvalCtx, depth = 0): Source | undefined {
  if (depth > MAX_DEPTH || !Node.isIdentifier(root) || !ctx.rootDir) return undefined;
  const file = root.getSourceFile().getFilePath();
  const imported = importOf(root);
  if (imported && /\.json$/i.test(imported.spec)) {
    const config = loadConfig(imported.spec, file, ctx.rootDir);
    return config ? { config, keys: imported.name === "default" ? [] : [imported.name] } : undefined;
  }
  const decl = importedVariable(root) ?? declarationsOf(root).find((d) => Node.isVariableDeclaration(d));
  const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
  if (!init) return undefined;
  const literal = loadedPath(init, ctx);
  const config = literal ? loadConfig(literal, decl!.getSourceFile().getFilePath(), ctx.rootDir) : undefined;
  if (config) return { config, keys: [] };
  const u = unwrap(init);
  // `schema.safeParse(process.env).data`
  const call = Node.isPropertyAccessExpression(u) && u.getName() === "data" ? unwrap(u.getExpression()) : u;
  if (Node.isCallExpression(call)) return { schema: call, keys: [] };
  return Node.isIdentifier(u) ? rootSource(u, ctx, depth + 1) : undefined;
}

/** A config file's value as a shape: a string remembers the file and key path it comes from. */
function configShape(v: ConfigValue, config: LoadedConfig, keys: string[]): Shape {
  if (typeof v !== "string") return jsonToShape(v);
  if (isInterpolated(v)) return { type: "string", hint: keys[keys.length - 1] };
  return { type: "string", enum: [v], [VALUE_SOURCES]: new Map([[v, { from: "config_file" as const, file: config.file, key: keys.join(".") }]]) };
}

function objectArg(call: CallExpression): ObjectLiteralExpression | undefined {
  const arg = call.getArguments()[0];
  return arg && Node.isObjectLiteralExpression(arg) ? arg : undefined;
}

function prop(obj: ObjectLiteralExpression | undefined, key: string): Expression | undefined {
  const member = obj?.getProperties().find((p) => propertyKey(p) === key);
  return member ? propertyValue(member) : undefined;
}

/** The object literal of a zod schema (`z.object({...}).strict()`), through a variable holding it. */
function schemaObject(e: Expression | undefined, depth = 0): ObjectLiteralExpression | undefined {
  if (!e || depth > MAX_DEPTH) return undefined;
  const u = unwrap(e);
  if (Node.isIdentifier(u)) {
    const d = importedVariable(u) ?? declarationsOf(u).find((x) => Node.isVariableDeclaration(x));
    return d && Node.isVariableDeclaration(d) ? schemaObject(d.getInitializer(), depth + 1) : undefined;
  }
  if (!Node.isCallExpression(u)) return undefined;
  const callee = u.getExpression();
  if (callee.getText() === "z.object") return objectArg(u);
  return Node.isPropertyAccessExpression(callee) ? schemaObject(callee.getExpression(), depth + 1) : undefined;
}

/** `z.string().min(1).default("gpt-4o")`: the literal default along the chain. */
function zodDefault(e: Expression): string | undefined {
  let cur = unwrap(e);
  for (;;) {
    const callee = Node.isCallExpression(cur) ? cur.getExpression() : undefined;
    if (!Node.isCallExpression(cur) || !Node.isPropertyAccessExpression(callee)) return undefined;
    const arg = cur.getArguments()[0];
    if (callee.getName() === "default" && arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) return arg.getLiteralValue();
    cur = unwrap(callee.getExpression());
  }
}

/** The env var an env schema reads under `key`, and its default: `schema.parse(process.env)`, `createEnv({ server, runtimeEnv })`. */
function schemaShape(call: CallExpression, key: string): Shape | undefined {
  const callee = call.getExpression();
  let field: Expression | undefined;
  let env = key;
  if (callee.getText() === "createEnv") {
    const opts = objectArg(call);
    field = ["server", "client", "shared"].map((k) => { const o = prop(opts, k); return o && Node.isObjectLiteralExpression(o) ? prop(o, key) : undefined; }).find((f) => !!f);
    const runtime = prop(opts, "runtimeEnv");
    const mapped = runtime && Node.isObjectLiteralExpression(runtime) ? prop(runtime, key) : undefined;
    const named = mapped ? /^(?:process\.env|import\.meta\.env)\.([A-Za-z_]\w*)$/.exec(unwrap(mapped).getText()) : undefined;
    if (named) env = named[1]!;
  } else if (Node.isPropertyAccessExpression(callee) && /^(parse|safeParse)$/.test(callee.getName()) && ENV.test(call.getArguments()[0]?.getText() ?? "")) {
    field = prop(schemaObject(callee.getExpression()), key);
  }
  if (!field) return undefined;
  const dflt = zodDefault(field);
  return { type: "string", env, ...(dflt !== undefined ? { enum: [dflt] } : {}) };
}

/** The shape of `config.llm.model` / `env.OPENAI_MODEL`, when its root is a loaded config file or a parsed env schema. */
export function loadedValueShape(u: Expression, ctx: EvalCtx): Shape | undefined {
  if (!Node.isPropertyAccessExpression(u) && !Node.isElementAccessExpression(u)) return undefined;
  const { root, chain } = memberChain(u);
  if (chain.length === 0) return undefined;
  const src = rootSource(root, ctx);
  if (!src) return undefined;
  const keys = [...src.keys, ...chain];
  if ("config" in src) {
    const v = configAt(src.config.data, keys);
    return v === undefined ? undefined : configShape(v, src.config, keys);
  }
  return keys.length === 1 ? schemaShape(src.schema, keys[0]!) : undefined;
}


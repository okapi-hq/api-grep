import path from "node:path";
import { Node, SyntaxKind, type CallExpression, type Expression, type Project } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { identifierOrigin } from "../ast/origin.js";
import { declarationsOf } from "../ast/object.js";
import { readConfigFile } from "../files.js";
import { MAX_DOCUMENT_CHARS, operationDocument } from "../operation/graphql-document.js";
import type { EvalCtx, Part } from "../types.js";
import { staticText } from "./parts.js";

/**
 * GraphQL documents written in TypeScript and JavaScript (#35): `gql` / `graphql` tagged templates (graphql-tag, Apollo,
 * urql, graphql-request), `graphql("...", [Fragment])` calls (gql.tada, the codegen client preset) and `.graphql` /
 * `.gql` files imported through a bundler loader. Each reads as the text of the document, `${Fragment}` included.
 */

type Evaluate = (e: Expression, ctx: EvalCtx, depth: number) => Part[];

const TAGS = new Set(["gql", "graphql"]);
const DOCUMENT_FILE = /\.(?:graphql|gql)$/;
/** `#import "./fragments.graphql"` lines of graphql-tag/loader, followed this many files deep. */
const MAX_IMPORT_DEPTH = 4;
const IMPORT_LINE = /^#import\s+["']([^"']+)["']\s*$/gm;

/** Imported documents are read only inside the scanned directory, which the scan registers for its project. */
const roots = new WeakMap<Project, string>();

export function setDocumentRoot(project: Project, rootDir: string): void {
  roots.set(project, rootDir);
}

/** The scanned directory files the code imports are read within (JSON ABIs too, #85). */
export const documentRoot = (project: Project): string | undefined => roots.get(project);

function tagName(e: Expression): string | undefined {
  const u = unwrap(e);
  if (Node.isIdentifier(u)) return u.getText();
  if (Node.isPropertyAccessExpression(u)) return u.getName();
  return undefined;
}

/** `graphql(doc)` / `graphql(doc, [Fragment])`; Octokit's `graphql(query, { owner })` sends a request instead. */
function isDocumentCall(u: Expression): u is CallExpression {
  if (!Node.isCallExpression(u) || !TAGS.has(tagName(u.getExpression()) ?? "")) return false;
  const [doc, fragments, ...rest] = u.getArguments();
  return !!doc && rest.length === 0 && (!fragments || Node.isArrayLiteralExpression(fragments));
}

/** A tagged template or a call that builds a document. */
export function isDocumentExpression(u: Expression): boolean {
  return (Node.isTaggedTemplateExpression(u) && TAGS.has(tagName(u.getTag()) ?? "")) || isDocumentCall(u);
}

/** Packages exporting graphql-js's `print` (Apollo re-exports it). */
const PRINTERS = new Set(["graphql", "@apollo/client"]);

/** The document of `print(doc)` (`import { print } from "graphql"`, `graphql.print(doc)`): what is sent is its text. */
export function printedArgument(u: Expression): Expression | undefined {
  if (!Node.isCallExpression(u) || u.getArguments().length !== 1) return undefined;
  const callee = unwrap(u.getExpression());
  const member = Node.isPropertyAccessExpression(callee) && callee.getName() === "print";
  const ident = member ? unwrap(callee.getExpression()) : callee;
  if (!Node.isIdentifier(ident) || (!member && !/print/i.test(ident.getText()))) return undefined;
  const origin = identifierOrigin(ident);
  if (origin.kind !== "package" || !PRINTERS.has(origin.package)) return undefined;
  return member || origin.importedName === "print" ? (u.getArguments()[0] as Expression) : undefined;
}

/** Documents already read, per substitution: a fragment many documents interpolate is read once. */
const memo = new WeakMap<Node, Map<EvalCtx["subst"], Part[]>>();
const MAX_PARTS = 1_000;

/** A document past the size bound keeps its start, so its header still names it; its fields are unknown. */
export function truncated(start: string): Part[] {
  return [
    { kind: "static", text: start.slice(0, 1_000), viaConst: true },
    { kind: "dynamic", name: "document", origin: "unknown" },
  ];
}

/** Fragments interpolated into fragments can double a document per level: past the bounds, only its start is kept. */
function bounded(parts: Part[]): Part[] {
  let size = 0;
  for (const p of parts) size += p.kind === "static" ? p.text.length : 1;
  if (size <= MAX_DOCUMENT_CHARS && parts.length <= MAX_PARTS) return parts;
  const end = parts.findIndex((p) => p.kind !== "static");
  return truncated(staticText(end < 0 ? parts : parts.slice(0, end)) ?? "");
}

function readDocumentParts(u: Expression, ctx: EvalCtx, depth: number, evaluate: Evaluate): Part[] | undefined {
  if (Node.isTaggedTemplateExpression(u)) return isDocumentExpression(u) ? evaluate(u.getTemplate(), ctx, depth + 1) : undefined;
  if (!isDocumentCall(u)) return undefined;
  const [doc, fragments] = u.getArguments() as Expression[];
  const extra = fragments && Node.isArrayLiteralExpression(fragments) ? fragments.getElements() : [];
  return [doc!, ...extra].flatMap((e, i) => [...(i ? [{ kind: "static", text: "\n" } as Part] : []), ...evaluate(e, ctx, depth + 1)]);
}

/** The text of a document expression, its fragments appended; undefined when `u` is not one. */
export function documentParts(u: Expression, ctx: EvalCtx, depth: number, evaluate: Evaluate): Part[] | undefined {
  const known = memo.get(u)?.get(ctx.subst);
  if (known) return known;
  const parts = readDocumentParts(u, ctx, depth, evaluate);
  if (!parts) return undefined;
  const out = bounded(parts);
  let bySubst = memo.get(u);
  if (!bySubst) memo.set(u, (bySubst = new Map<EvalCtx["subst"], Part[]>()));
  bySubst.set(ctx.subst, out);
  return out;
}

/** A file's text with its `#import` lines replaced by the files they name, within the scanned directory. */
function readDocument(file: string, root: string, seen: Set<string>, depth: number): string | undefined {
  if (seen.has(file) || seen.size > 32) return "";
  seen.add(file);
  const text = readConfigFile(file, root);
  if (text === undefined || text.length > MAX_DOCUMENT_CHARS) return text;
  if (depth >= MAX_IMPORT_DEPTH) return text;
  return text.replace(IMPORT_LINE, (_line, rel: string) => (rel.startsWith(".") ? (readDocument(path.resolve(path.dirname(file), rel), root, seen, depth + 1) ?? "") : ""));
}

function documentText(text: string, name: string | undefined): Part[] {
  if (text.length > MAX_DOCUMENT_CHARS) return truncated(text);
  // graphql-tag/loader exports each operation by name, with the fragments it needs
  const selected = name ? operationDocument(text, name) : undefined;
  return [{ kind: "static", text: selected ?? text, viaConst: true }];
}

/** `import GetOrder from "./get-order.graphql"`, `import { GetOrder } from "./orders.graphql"`, or `require(...)` of one. */
function importedFile(u: Expression): { file: string; name?: string } | undefined {
  if (Node.isCallExpression(u) && u.getExpression().getText() === "require") {
    const arg = u.getArguments()[0];
    const spec = arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : undefined;
    return spec && DOCUMENT_FILE.test(spec) && spec.startsWith(".") ? { file: path.resolve(path.dirname(u.getSourceFile().getFilePath()), spec) } : undefined;
  }
  const decl = declarationsOf(u)[0];
  if (!decl || (!Node.isImportClause(decl) && !Node.isImportSpecifier(decl))) return undefined;
  const spec = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue();
  if (!spec || !DOCUMENT_FILE.test(spec) || !spec.startsWith(".")) return undefined;
  const name = Node.isImportSpecifier(decl) ? decl.getName() : undefined;
  return { file: path.resolve(path.dirname(u.getSourceFile().getFilePath()), spec), ...(name && name !== "default" ? { name } : {}) };
}

/** The text of a document file `u` imports; undefined when it imports none or the file cannot be read. */
export function importedDocument(u: Expression): Part[] | undefined {
  const imported = importedFile(u);
  const root = imported ? roots.get(u.getSourceFile().getProject()) : undefined;
  if (!imported || root === undefined) return undefined;
  const text = readDocument(imported.file, root, new Set(), 0);
  return text === undefined ? undefined : documentText(text, imported.name);
}

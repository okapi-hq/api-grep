import { ts } from "ts-morph";
import { isComponent } from "../html/components.js";

/** What a file tells about the files it can see: what it imports and what it adds to the global scope. */
export interface FileFacts {
  /** Module specifiers: imports, exports, `require()`, `import()`, import types, `declare module` names. */
  specifiers: string[];
  /** `/// <reference path>` targets, as written. */
  references: string[];
  /** `/// <reference types>` names. */
  typeRefs: string[];
  /** Names of `declare module "name"` blocks: ambient modules and augmentations. */
  ambient: string[];
  /** Names the file adds to the global scope: a script's top-level declarations, `export as namespace`. */
  globals: string[];
  /**
   * Declares global types that other files use without naming them: a `declare global` block, or an interface or
   * namespace of a script (`interface Window { api: Api }` types every `window.api`). Such a file sees every file.
   */
  universal: boolean;
}

export const NO_FACTS: FileFacts = { specifiers: [], references: [], typeRefs: [], ambient: [], globals: [], universal: false };

const JS = /\.(?:[cm]?jsx?|html?)$/i;

/** What the pre-processor does not read: JSDoc `import("x")` types and `@import` tags, template literal specifiers. */
const MORE_IMPORTS = [/\bimport\s*\(\s*["'`]([^"'`\n]+)["'`]\s*\)/g, /\brequire\s*\(\s*`([^`$\n]+)`\s*\)/g, /@import\b[^\n]*?\bfrom\s*["']([^"'\n]+)["']/g];

function scriptKindOf(file: string): ts.ScriptKind {
  if (/\.html?$/i.test(file)) return ts.ScriptKind.JS;
  if (isComponent(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(file)) return ts.ScriptKind.JS;
  return /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const e of name.elements) if (!ts.isOmittedExpression(e)) bindingNames(e.name, out);
}

/** Names declared by the statements of a script. */
function declaredNames(statements: readonly ts.Statement[], out: string[]): void {
  for (const s of statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) bindingNames(d.name, out);
    else if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) {
      if (s.name) out.push(s.name.text);
    } else if ((ts.isModuleDeclaration(s) || ts.isImportEqualsDeclaration(s)) && ts.isIdentifier(s.name)) out.push(s.name.text);
  }
}

/**
 * A JavaScript file without `import` / `export` that calls `require(x)` is a CommonJS module for the checker: its
 * declarations stay in the file. Any other script shares them with every file (a wrong "script" only merges more).
 */
function isCommonJs(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require" && n.arguments.length === 1) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Global names and `declare module` blocks of a parsed file. */
function scopeFacts(sf: ts.SourceFile, file: string): Pick<FileFacts, "ambient" | "globals" | "universal"> {
  const ambient: string[] = [];
  const globals: string[] = [];
  let universal = false;
  const isModule = ts.isExternalModule(sf) || (JS.test(file) && isCommonJs(sf));
  if (!isModule) {
    declaredNames(sf.statements, globals);
    universal = sf.statements.some((s) => ts.isInterfaceDeclaration(s) || (ts.isModuleDeclaration(s) && ts.isIdentifier(s.name)));
  }
  for (const s of sf.statements) {
    if (ts.isModuleDeclaration(s) && ts.isStringLiteral(s.name)) ambient.push(s.name.text);
    else if (ts.isModuleDeclaration(s) && ts.isIdentifier(s.name) && s.name.text === "global") universal = true;
    else if (ts.isNamespaceExportDeclaration(s)) globals.push(s.name.text);
  }
  return { ambient, globals, universal };
}

/** The facts of one file from its text (an HTML page: its inline scripts). */
export function factsOf(file: string, text: string): FileFacts {
  const pre = ts.preProcessFile(text, true, true);
  const specifiers = new Set(pre.importedFiles.map((f) => f.fileName));
  for (const re of MORE_IMPORTS) for (const m of text.matchAll(re)) specifiers.add(m[1]!);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKindOf(file));
  const { ambient, globals, universal } = scopeFacts(sf, file);
  for (const a of ambient) specifiers.add(a);
  return {
    specifiers: [...specifiers],
    references: pre.referencedFiles.map((f) => f.fileName),
    typeRefs: pre.typeReferenceDirectives.map((f) => f.fileName),
    ambient,
    globals,
    universal,
  };
}

/** Every word of a text that could be an identifier (strings and comments too: a superset only merges more). */
export function words(text: string): Set<string> {
  return new Set(text.match(/[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/gu) ?? []);
}

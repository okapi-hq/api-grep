import { ts, type SourceFile } from "ts-morph";
import { relativePosix } from "../../files.js";
import { MAX_SOURCE_CHARS, type HostLiterals } from "../../hosts/literals.js";
import { languageOf } from "../../language.js";
import { isInSourceTest, literalRole } from "./host-context.js";

/** A template's text with each substitution as `${}`: a host split by one is no host. */
function templateText(t: ts.TemplateExpression): string {
  return t.head.text + t.templateSpans.map((s) => "${}" + s.literal.text).join("");
}

const isModuleSpecifier = (n: ts.Node): boolean => (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent)) && n.parent.moduleSpecifier === n;

/**
 * Hands the string and template literals of a scanned file (an HTML page: its inline scripts, at their lines) to
 * `hosts`, each with its role (`host-context.ts`: a log's text, a link's value). Comments are not literals; module
 * specifiers (`https://esm.sh/...`) are imports, not calls; Vitest's in-source tests are not read. An explicit
 * stack: a long `a + b + ...` chain nests deeper than the call stack allows.
 */
export function collectHostLiterals(sf: SourceFile, rootDir: string, hosts: HostLiterals): void {
  const node = sf.compilerNode;
  if (node.text.length > MAX_SOURCE_CHARS) return;
  const file = relativePosix(rootDir, sf.getFilePath());
  const language = languageOf(file);
  const add = (n: ts.Node, text: string): void => {
    if (text.includes(".")) hosts.add(text, file, node.getLineAndCharacterOfPosition(n.getStart(node)).line + 1, language, literalRole(n, node));
  };
  const stack: ts.Node[] = [node];
  // a template's own parts are read whole below; only its substitutions hold other literals (order does not matter)
  const push = (c: ts.Node): void => {
    if (!ts.isTemplateHead(c) && !ts.isTemplateMiddle(c) && !ts.isTemplateTail(c)) stack.push(c);
  };
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!isModuleSpecifier(n)) add(n, n.text);
      continue;
    }
    if (ts.isTemplateExpression(n)) add(n, templateText(n));
    if (!isInSourceTest(n, node)) ts.forEachChild(n, push);
  }
}

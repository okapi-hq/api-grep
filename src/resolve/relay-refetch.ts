import path from "node:path";
import { Kind, parse, print, type FragmentDefinitionNode } from "graphql";
import type { Node, Project, SourceFile } from "ts-morph";
import { MAX_DOCUMENT_CHARS } from "../operation/graphql-document.js";
import type { Shape } from "../types.js";
import { artifactDocument } from "./relay-artifact.js";
import { stringShapeOf } from "./string-template.js";

/**
 * Relay's fragment hooks that refetch or paginate (`usePaginationFragment`, `useRefetchableFragment`, #92) send a query
 * the compiler generates from the fragment's `@refetchable(queryName: "...")`: its artifact
 * (`__generated__/<queryName>.graphql.ts`) when the project has it, else the query the compiler writes for the
 * fragment's type: the fragment at the root of a `Query` fragment, under `viewer` for `Viewer`, under `node` otherwise.
 */

const ARTIFACT = /^([_A-Za-z][_0-9A-Za-z]*)\.graphql\.[jt]sx?$/;

const indexes = new WeakMap<Project, Map<string, SourceFile>>();

/** The project's Relay artifacts by operation name, indexed once. */
function artifacts(project: Project): Map<string, SourceFile> {
  let index = indexes.get(project);
  if (!index) {
    index = new Map();
    for (const sf of project.getSourceFiles()) {
      const m = ARTIFACT.exec(path.basename(sf.getFilePath()));
      if (m && !index.has(m[1]!)) index.set(m[1]!, sf);
    }
    indexes.set(project, index);
  }
  return index;
}

/** The fragment of `text` that names a refetch query, and that name. */
function refetchable(text: string): { fragment: FragmentDefinitionNode; queryName: string } | undefined {
  if (text.length > MAX_DOCUMENT_CHARS) return undefined;
  let doc;
  try {
    doc = parse(text, { noLocation: true, maxTokens: 50_000 });
  } catch {
    return undefined;
  }
  for (const d of doc.definitions) {
    if (d.kind !== Kind.FRAGMENT_DEFINITION) continue;
    const directive = d.directives?.find((x) => x.name.value === "refetchable");
    const arg = directive?.arguments?.find((a) => a.name.value === "queryName");
    if (arg?.value.kind === Kind.STRING) return { fragment: d, queryName: arg.value.value };
  }
  return undefined;
}

/** The query the compiler writes for the fragment when its artifact is not in the scan. */
function generatedQuery(fragment: FragmentDefinitionNode, queryName: string): string {
  const type = fragment.typeCondition.name.value;
  const spread = `...${fragment.name.value}`;
  const selection = type === "Query" ? spread : type === "Viewer" ? `viewer { ${spread} }` : `node { ${spread} }`;
  return `query ${queryName} { ${selection} }\n${print(fragment)}`;
}

/** The document a refetch or pagination hook sends for the fragment it is given; unknown when it names none. */
export function refetchDocument(fragment: Shape | undefined, from: Node): Shape {
  const texts = fragment?.type === "string" ? (fragment.enum ?? []).filter((v): v is string => typeof v === "string") : [];
  const found = texts.length === 1 ? refetchable(texts[0]!) : undefined;
  if (!found) return { type: "unknown" };
  const artifact = artifacts(from.getProject()).get(found.queryName);
  const parts = artifact ? artifactDocument(artifact) : undefined;
  return parts ? stringShapeOf(parts) : { type: "string", enum: [generatedQuery(found.fragment, found.queryName)] };
}

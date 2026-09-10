import { Node, SyntaxKind, type CallExpression, type NewExpression, type SourceFile } from "ts-morph";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { detectAxios } from "./axios.js";
import { describeCallee } from "./callee.js";
import { detectFetch } from "./fetch.js";
import { detectFramework } from "./framework.js";
import { detectGotKy } from "./got-ky.js";
import { detectNodeHttp } from "./node-http.js";
import type { Registry } from "./registry/index.js";
import { detectSdk } from "./sdk.js";
import { wrapperFunction } from "../wrappers/function.js";

const MOCK_PKGS = new Set(["vitest", "jest", "@jest/globals", "msw", "nock", "sinon"]);

export interface WrapperCandidate {
  node: CallExpression;
  callee: Callee;
}

export interface DetectResult {
  calls: RawCall[];
  candidates: WrapperCandidate[];
}

export function detectNode(node: CallExpression | NewExpression, registry: Registry, ctx: EvalCtx = {}): { raw: RawCall | null; callee: Callee } {
  const callee = describeCallee(node);
  if (callee.package && MOCK_PKGS.has(callee.package)) return { raw: null, callee };
  const raw =
    detectSdk(node, callee, registry) ??
    detectFetch(node, callee, ctx) ??
    detectAxios(node, callee, ctx) ??
    detectGotKy(node, callee, ctx) ??
    detectNodeHttp(node, callee, ctx) ??
    detectFramework(node, callee, registry.frameworks, ctx);
  return { raw, callee };
}

/** Runs every detector over each call / new expression of a file. */
export function detectFile(sf: SourceFile, registry: Registry, root: Node = sf): DetectResult {
  const calls: RawCall[] = [];
  const candidates: WrapperCandidate[] = [];
  const nodes = [...root.getDescendantsOfKind(SyntaxKind.CallExpression), ...root.getDescendantsOfKind(SyntaxKind.NewExpression)];
  for (const node of nodes) {
    const { raw, callee } = detectNode(node, registry);
    if (raw) {
      calls.push(raw);
      continue;
    }
    if (Node.isCallExpression(node) && wrapperFunction(callee)) candidates.push({ node, callee });
  }
  return { calls, candidates };
}

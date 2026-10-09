import { Node, SyntaxKind, type CallExpression, type NewExpression, type SourceFile } from "ts-morph";
import type { Callee, EvalCtx, RawCall } from "../types.js";
import { detectAiSdk } from "./ai-sdk.js";
import { detectAxios } from "./axios.js";
import { describeCallee, wrapperFunction } from "./callee.js";
import { detectFetch } from "./fetch.js";
import { detectFramework } from "./framework.js";
import { detectGotKy } from "./got-ky.js";
import { detectNodeHttp } from "./node-http.js";
import type { Registry } from "./registry/index.js";
import { detectSdk } from "./sdk.js";
import { unfollowedFetch, type Unfollowed } from "./unfollowed.js";

const MOCK_PKGS = new Set(["vitest", "jest", "@jest/globals", "msw", "nock", "sinon"]);

export interface WrapperCandidate {
  node: CallExpression;
  callee: Callee;
}

export interface DetectResult {
  calls: RawCall[];
  candidates: WrapperCandidate[];
  /** Fetch functions received from outside (`this.fetchFn(url)`): calls that cannot be followed. */
  unfollowed: Unfollowed[];
}

/** Recognizes one kind of HTTP client at a call site; `null` when the call is not one. */
type Detector = (node: CallExpression | NewExpression, callee: Callee, registry: Registry, ctx: EvalCtx) => RawCall | null;

/** Tried in order, first match wins: registries before generic clients, so `stripe.customers.create` is not read as a fetch. */
const DETECTORS: readonly Detector[] = [
  (node, callee, registry) => detectSdk(node, callee, registry),
  (node, callee) => detectAiSdk(node, callee),
  (node, callee, _registry, ctx) => detectFetch(node, callee, ctx),
  (node, callee, _registry, ctx) => detectAxios(node, callee, ctx),
  (node, callee, _registry, ctx) => detectGotKy(node, callee, ctx),
  (node, callee, _registry, ctx) => detectNodeHttp(node, callee, ctx),
  (node, callee, registry, ctx) => detectFramework(node, callee, registry.frameworks, ctx),
];

export function detectNode(node: CallExpression | NewExpression, registry: Registry, ctx: EvalCtx = {}): { raw: RawCall | null; callee: Callee } {
  const callee = describeCallee(node);
  if (callee.package && MOCK_PKGS.has(callee.package)) return { raw: null, callee };
  for (const detect of DETECTORS) {
    const raw = detect(node, callee, registry, ctx);
    if (raw) return { raw, callee };
  }
  return { raw: null, callee };
}

/** Runs every detector over each call / new expression of a file. */
export function detectFile(sf: SourceFile, registry: Registry, root: Node = sf): DetectResult {
  const calls: RawCall[] = [];
  const candidates: WrapperCandidate[] = [];
  const unfollowed: Unfollowed[] = [];
  const nodes = [...root.getDescendantsOfKind(SyntaxKind.CallExpression), ...root.getDescendantsOfKind(SyntaxKind.NewExpression)];
  for (const node of nodes) {
    const { raw, callee } = detectNode(node, registry);
    if (raw) {
      calls.push(raw);
      continue;
    }
    if (!Node.isCallExpression(node)) continue;
    if (wrapperFunction(callee)) candidates.push({ node, callee });
    else {
      const u = unfollowedFetch(node, callee);
      if (u) unfollowed.push(u);
    }
  }
  return { calls, candidates, unfollowed };
}

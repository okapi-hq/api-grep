import type { BodyEncoding } from "../../../types.js";
import type { IrMethodSpec, IrRegistryEntry } from "../../ir/language.js";
import spec from "./spring-ai.json" with { type: "json" };

interface Kind {
  shared: string[];
  instances: string[];
  builders?: string[];
  methods: string[];
  encoding?: string;
}

interface ProviderKind {
  /** Model classes under the provider's package (`text.GoogleGenAiTextEmbeddingModel` in a subpackage). */
  classes: string[];
  path: string;
  /** The path of `stream` calls when it differs (Bedrock's `converse-stream`). */
  streamPath?: string;
  operationId?: string;
  /** Prefix of the kind's properties: `<prefix>.options.model`, `<prefix>.model`, `<prefix>.base-url`. */
  prefix: string;
  /** Model properties under the prefix, when not `options.model` / `model` (Azure's `options.deployment-name`). */
  modelKeys?: string[];
  /** The artifacts of this kind when the provider's are not (Google GenAI's embedding starter). */
  packages?: string[];
  /** The bean name when it is not the class name, lower first. */
  bean?: string;
}

interface Provider {
  provider: string;
  id: string;
  host: string;
  auth: string;
  packages: string[];
  own: string[];
  baseUrl?: string;
  vertexIf?: string;
  kinds: Record<string, ProviderKind>;
}

const KINDS = spec.kinds as Record<string, Kind>;

const simple = (c: string): string => c.slice(c.lastIndexOf(".") + 1);
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
/** The path a model id fills (`/model/{modelId}/converse`): the placeholder reads the call's model. */
const modelParam = (path: string): Record<string, string> | undefined => {
  const name = /\{(\w+)\}/.exec(path)?.[1];
  return name ? { [name]: "model" } : undefined;
};

function method(k: ProviderKind, kind: Kind, path: string): IrMethodSpec {
  const params = modelParam(path);
  return { method: "POST", path, ...(params ? { params } : {}), ...(k.operationId ? { operationId: k.operationId } : {}), ...(kind.encoding ? { encoding: kind.encoding as BodyEncoding } : {}) };
}

function entry(p: Provider, pkg: string, kindName: string, k: ProviderKind): IrRegistryEntry {
  const kind = KINDS[kindName]!;
  const classes = k.classes.map(simple);
  const methods = Object.fromEntries(kind.methods.map((name) => [name, method(k, kind, k.streamPath && /stream$/.test(name) ? k.streamPath : k.path)]));
  return {
    package: pkg,
    provider: p.provider,
    host: p.host,
    auth: p.auth,
    generatedFrom: spec.generatedFrom,
    imports: [...kind.shared, ...k.classes.map((c) => `${p.own[0]}.${c}`)],
    instance: { names: [...kind.instances, ...classes], build: "build" },
    ...(kind.builders ? { builders: kind.builders } : {}),
    methods,
    configured: {
      family: "spring-ai",
      kind: kindName,
      own: p.own,
      classes,
      model: (k.modelKeys ?? ["options.model", "model"]).map((m) => `${k.prefix}.${m}`),
      baseUrl: [`${k.prefix}.base-url`, ...(p.baseUrl ? [p.baseUrl] : [])],
      id: p.id,
      bean: k.bean ?? lowerFirst(classes[0]!),
      ...(p.vertexIf ? { elsewhereIf: p.vertexIf } : {}),
    },
  } as IrRegistryEntry;
}

/** One entry per provider, artifact (the module first, then the starters) and model kind. */
export const SPRING_AI_REGISTRY: IrRegistryEntry[] = (spec.providers as Provider[]).flatMap((p) =>
  Object.entries(p.kinds).flatMap(([kindName, k]) => (k.packages ?? p.packages).map((pkg) => entry(p, pkg, kindName, k))),
);

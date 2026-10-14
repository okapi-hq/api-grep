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
  classes: string[];
  path: string;
  operationId?: string;
  /** Prefix of the kind's properties: `<prefix>.options.model`, `<prefix>.model`, `<prefix>.base-url`. */
  prefix: string;
}

interface Provider {
  provider: string;
  host: string;
  auth: string;
  packages: string[];
  own: string[];
  baseUrl: string;
  kinds: Record<string, ProviderKind>;
}

const KINDS = spec.kinds as Record<string, Kind>;

function entry(p: Provider, pkg: string, kindName: string, k: ProviderKind): IrRegistryEntry {
  const kind = KINDS[kindName]!;
  const method: IrMethodSpec = { method: "POST", path: k.path, ...(k.operationId ? { operationId: k.operationId } : {}), ...(kind.encoding ? { encoding: kind.encoding as BodyEncoding } : {}) };
  return {
    package: pkg,
    provider: p.provider,
    host: p.host,
    auth: p.auth,
    generatedFrom: spec.generatedFrom,
    imports: [...kind.shared, ...k.classes.map((c) => `${p.own[0]}.${c}`)],
    instance: { names: [...kind.instances, ...k.classes], build: "build" },
    ...(kind.builders ? { builders: kind.builders } : {}),
    methods: Object.fromEntries(kind.methods.map((name) => [name, method])),
    configured: {
      family: "spring-ai",
      kind: kindName,
      own: p.own,
      classes: k.classes,
      model: [`${k.prefix}.options.model`, `${k.prefix}.model`],
      baseUrl: [`${k.prefix}.base-url`, p.baseUrl],
    },
  } as IrRegistryEntry;
}

/** One entry per provider, artifact (the module first, then the starters) and model kind. */
export const SPRING_AI_REGISTRY: IrRegistryEntry[] = (spec.providers as Provider[]).flatMap((p) =>
  Object.entries(p.kinds).flatMap(([kindName, k]) => p.packages.map((pkg) => entry(p, pkg, kindName, k))),
);

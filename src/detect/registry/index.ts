import type { FrameworkEntry, RegistryEntry } from "../../types.js";
import frameworks from "./frameworks.json" with { type: "json" };
import awsS3 from "./aws-sdk-v3-s3.json" with { type: "json" };
import awsV2 from "./aws-sdk-v2.json" with { type: "json" };
import firebase from "./firebase.json" with { type: "json" };
import octokit from "./octokit.json" with { type: "json" };
import openai from "./openai.json" with { type: "json" };
import sentry from "./sentry.json" with { type: "json" };
import slack from "./slack.json" with { type: "json" };
import stripe from "./stripe.json" with { type: "json" };
import supabase from "./supabase.json" with { type: "json" };
import twilio from "./twilio.json" with { type: "json" };

export class Registry {
  private byPkg = new Map<string, RegistryEntry>();
  readonly frameworks: FrameworkEntry[];

  constructor(entries: RegistryEntry[], frameworkEntries: FrameworkEntry[] = []) {
    for (const e of entries) this.add(e);
    this.frameworks = frameworkEntries;
  }

  add(e: RegistryEntry): void {
    this.byPkg.set(e.package, e);
    for (const a of e.aliases ?? []) this.byPkg.set(a, e);
  }

  /** Exact package first, then a scope wildcard alias (`@sentry/*`). */
  byPackage(pkg: string | undefined): RegistryEntry | undefined {
    if (!pkg) return undefined;
    const scope = pkg.startsWith("@") ? pkg.split("/")[0] : undefined;
    return this.byPkg.get(pkg) ?? (scope ? this.byPkg.get(`${scope}/*`) : undefined);
  }

  entries(): RegistryEntry[] {
    return [...new Set(this.byPkg.values())];
  }
}

export function defaultRegistry(): Registry {
  return new Registry([stripe, openai, octokit, slack, twilio, awsS3, awsV2, supabase, firebase, sentry] as RegistryEntry[], frameworks.frameworks as FrameworkEntry[]);
}

import type { RegistryEntry } from "../../types.js";
import awsS3 from "./aws-sdk-v3-s3.json" with { type: "json" };
import awsV2 from "./aws-sdk-v2.json" with { type: "json" };
import octokit from "./octokit.json" with { type: "json" };
import openai from "./openai.json" with { type: "json" };
import slack from "./slack.json" with { type: "json" };
import stripe from "./stripe.json" with { type: "json" };
import twilio from "./twilio.json" with { type: "json" };

export class Registry {
  private byPkg = new Map<string, RegistryEntry>();

  constructor(entries: RegistryEntry[]) {
    for (const e of entries) this.add(e);
  }

  add(e: RegistryEntry): void {
    this.byPkg.set(e.package, e);
    for (const a of e.aliases ?? []) this.byPkg.set(a, e);
  }

  byPackage(pkg: string | undefined): RegistryEntry | undefined {
    return pkg ? this.byPkg.get(pkg) : undefined;
  }

  entries(): RegistryEntry[] {
    return [...new Set(this.byPkg.values())];
  }
}

export function defaultRegistry(): Registry {
  return new Registry([stripe, openai, octokit, slack, twilio, awsS3, awsV2] as RegistryEntry[]);
}

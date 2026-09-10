/** Small deterministic PRNG so example values are stable across runs for the same call. */

const WORDS = [
  "amber", "harbor", "quiet", "maple", "river", "copper", "meadow", "lantern", "summit", "willow",
  "orbit", "velvet", "canyon", "ember", "falcon", "garden", "horizon", "island", "jasper", "kestrel",
  "lagoon", "marble", "nectar", "onyx", "pebble", "quartz", "ridge", "saffron", "timber", "umber",
  "valley", "walnut", "yarrow", "zephyr", "atlas", "birch", "cedar", "delta", "echo", "fable",
  "glacier", "hollow", "indigo", "juniper", "koala", "linen", "mosaic", "nimbus", "opal", "prairie",
  "quill", "raven", "sable", "tundra", "ultra", "verdant", "wander", "xenon", "yonder", "zenith",
  "anchor", "beacon", "compass", "dune", "estuary", "fjord", "grove", "haven", "inlet", "jetty",
];

const FIRST_NAMES = ["Ada", "Bruno", "Chloe", "Dario", "Elena", "Felix", "Greta", "Hugo", "Iris", "Jonas", "Kira", "Leo", "Maya", "Nils", "Olga", "Pablo"];
const LAST_NAMES = ["Alder", "Brook", "Castel", "Dumont", "Ekwall", "Ferrer", "Galli", "Hoshi", "Ibarra", "Jansen", "Kovac", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Petrov"];
const CITIES = ["Lisbon", "Porto", "Lyon", "Bologna", "Ghent", "Bergen", "Tallinn", "Valencia", "Graz", "Utrecht"];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string) {
    this.state = hash(seed) || 1;
  }

  /** Uniform float in [0, 1). mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  word(): string {
    return this.pick(WORDS);
  }

  words(n: number, sep = " "): string {
    return Array.from({ length: n }, () => this.word()).join(sep);
  }

  capitalized(n: number): string {
    return Array.from({ length: n }, () => {
      const w = this.word();
      return w[0]!.toUpperCase() + w.slice(1);
    }).join(" ");
  }

  firstName(): string {
    return this.pick(FIRST_NAMES);
  }

  lastName(): string {
    return this.pick(LAST_NAMES);
  }

  city(): string {
    return this.pick(CITIES);
  }

  hex(len: number): string {
    return Array.from({ length: len }, () => "0123456789abcdef"[this.int(0, 15)]).join("");
  }

  alnum(len: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: len }, () => chars[this.int(0, chars.length - 1)]).join("");
  }

  uuid(): string {
    return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-a${this.hex(3)}-${this.hex(12)}`;
  }

  /** A date within the last 400 days, at whole-second precision, ISO formatted. */
  isoDate(): string {
    const days = this.int(0, 400);
    const t = Date.UTC(2026, 0, 1) - days * 86_400_000 + this.int(0, 86_399) * 1000;
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}

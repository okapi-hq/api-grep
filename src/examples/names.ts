import { isCredentialKey } from "../secrets.js";
import type { Rng } from "./random.js";

/** What the caller can accept: the synthesizer only uses a hint whose kind fits the shape's type. */
export type Kind = "string" | "number" | "boolean";

interface Rule {
  re: RegExp;
  string?: (r: Rng) => string;
  number?: (r: Rng) => number;
}

const RULES: Rule[] = [
  { re: /e[-_]?mail|^(to|from|cc|bcc|reply[-_]?to|recipient|sender)$/i, string: (r) => `${r.firstName().toLowerCase()}.${r.lastName().toLowerCase()}@example.com` },
  { re: /^(url|uri|href|link|website|homepage|callback|redirect[-_]?uri|redirect|webhook|endpoint)$|(Url|Uri|Link|Href)$|_(url|uri|link)$/, string: (r) => `https://example.com/${r.words(2, "/")}` },
  { re: /uuid|guid/i, string: (r) => r.uuid() },
  { re: /(^|_)(id|ids)$|[a-z]Id$|[a-z]Ids$|^id$/i, string: (r) => r.alnum(8), number: (r) => r.int(1, 9999) },
  { re: /phone|mobile|^tel$|telephone/i, string: (r) => `+1415555${String(r.int(100, 999))}${r.int(0, 9)}` },
  { re: /timestamp|_ts$|epoch/i, string: (r) => r.isoDate(), number: (r) => 1_700_000_000 + r.int(0, 60_000_000) },
  { re: /(^|_)(date|time|datetime)($|_)|_at$|(At|Date|Time)$|^(created|updated|deleted|expires|start|end)$/, string: (r) => r.isoDate(), number: (r) => 1_700_000_000 + r.int(0, 60_000_000) },
  { re: /^(first[-_]?name|given[-_]?name|firstname)$/i, string: (r) => r.firstName() },
  { re: /^(last[-_]?name|family[-_]?name|surname|lastname)$/i, string: (r) => r.lastName() },
  { re: /^(user[-_]?name|username|handle|nickname|login)$/i, string: (r) => `${r.firstName().toLowerCase()}${r.int(10, 99)}` },
  { re: /^(full[-_]?name|display[-_]?name|name|title|subject|label|heading|caption)$|(Name|Title|Label)$/, string: (r) => r.capitalized(2) },
  { re: /description|message|content|text|body|comment|note|summary|bio|reason|prompt|question|answer/i, string: (r) => `${r.capitalized(1)} ${r.words(5)}.` },
  { re: /slug|permalink/i, string: (r) => r.words(2, "-") },
  { re: /currency/i, string: () => "usd" },
  { re: /country/i, string: () => "US" },
  { re: /^(lang|language|locale)$/i, string: () => "en-US" },
  { re: /timezone|time_zone|^tz$/i, string: () => "Europe/Paris" },
  { re: /^(city|town)$/i, string: (r) => r.city() },
  { re: /^(zip|zipcode|postal[-_]?code|postcode)$/i, string: (r) => String(r.int(10000, 99999)) },
  { re: /(^|_)(street|address|line1|address1)($|_)/i, string: (r) => `${r.int(1, 200)} ${r.capitalized(1)} Street` },
  { re: /^(limit|per[-_]?page|perpage|page[-_]?size|pagesize|top|max[-_]?results|count|size|batch[-_]?size)$/i, string: (r) => String(r.int(10, 100)), number: (r) => r.int(10, 100) },
  { re: /^(page|page[-_]?number|offset|skip|start[-_]?index)$/i, string: (r) => String(r.int(0, 5)), number: (r) => r.int(0, 5) },
  { re: /amount|price|total|cost|balance|fee|subtotal|budget/i, string: (r) => String(r.int(100, 9999)), number: (r) => r.int(100, 9999) },
  { re: /quantity|^qty$|^num[-_]|^number[-_]?of/i, string: (r) => String(r.int(1, 9)), number: (r) => r.int(1, 9) },
  { re: /^(age)$/i, number: (r) => r.int(20, 80), string: (r) => String(r.int(20, 80)) },
  { re: /^(exp[-_]?)?month$/i, number: (r) => r.int(1, 12), string: (r) => String(r.int(1, 12)) },
  { re: /^(exp[-_]?)?year$/i, number: (r) => r.int(2027, 2030), string: (r) => String(r.int(2027, 2030)) },
  { re: /^(day|day[-_]?of[-_]?month)$/i, number: (r) => r.int(1, 28), string: (r) => String(r.int(1, 28)) },
  { re: /^(hour|hours)$/i, number: (r) => r.int(0, 23), string: (r) => String(r.int(0, 23)) },
  { re: /^(minute|minutes|second|seconds)$/i, number: (r) => r.int(0, 59), string: (r) => String(r.int(0, 59)) },
  { re: /^(iban)$/i, string: (r) => `DE89${String(r.int(1000000000, 9999999999))}${String(r.int(10000000, 99999999))}` },
  { re: /^(bic|swift)$/i, string: () => "DEUTDEFF" },
  { re: /^(card[-_]?number|pan)$/i, string: () => "4242424242424242" },
  { re: /^(cvc|cvv)$/i, string: (r) => String(r.int(100, 999)) },
  { re: /latitude|^lat$/i, number: (r) => Number((r.next() * 180 - 90).toFixed(5)), string: (r) => (r.next() * 180 - 90).toFixed(5) },
  { re: /longitude|^(lng|lon|long)$/i, number: (r) => Number((r.next() * 360 - 180).toFixed(5)), string: (r) => (r.next() * 360 - 180).toFixed(5) },
  { re: /percent|ratio|rate|score|weight|temperature/i, number: (r) => Number(r.next().toFixed(2)), string: (r) => r.next().toFixed(2) },
  { re: /^(version|api[-_]?version)$/i, string: (r) => `v${r.int(1, 3)}` },
  { re: /^(status|state)$/i, string: () => "active" },
  { re: /^(sort|order|order[-_]?by|direction)$/i, string: (r) => r.pick(["asc", "desc"]) },
  { re: /^(q|query|search|term|keyword|filter)$/i, string: (r) => r.word() },
  { re: /colou?r/i, string: (r) => `#${r.hex(6)}` },
  { re: /^(ip|ip[-_]?address|client[-_]?ip)$/i, string: (r) => `192.0.2.${r.int(1, 254)}` },
  { re: /mime|content[-_]?type|media[-_]?type/i, string: () => "application/json" },
  { re: /file[-_]?name|^filename$/i, string: (r) => `${r.word()}.pdf` },
  { re: /^(path|file|file[-_]?path|key|object[-_]?key)$/i, string: (r) => `${r.words(2, "/")}.pdf` },
  { re: /domain|hostname|^host$/i, string: (r) => `${r.word()}.example.org` },
  { re: /^(sha|hash|digest|checksum|etag)$/i, string: (r) => r.hex(16) },
  { re: /^(cursor|next|after|before|page[-_]?token|continuation)$/i, string: (r) => r.alnum(12) },
  { re: /^(model)$/i, string: () => "gpt-4o" },
  { re: /^(role)$/i, string: () => "user" },
  { re: /^(tags?|labels?|categories|category)$/i, string: (r) => r.word() },
  { re: /^(code|coupon|promo[-_]?code|voucher)$/i, string: (r) => r.alnum(6).toUpperCase() },
];

/** Placeholder for credential-like keys: never invent something that looks like a real secret. */
export function credentialPlaceholder(key: string): string | undefined {
  return isCredentialKey(key) ? `<${key}>` : undefined;
}

/** Name-driven value for `key`, only when a rule fits both the name and the requested kind. */
export function byName(key: string, kind: Kind, rng: Rng): string | number | undefined {
  if (kind === "boolean") return undefined;
  const cred = credentialPlaceholder(key);
  if (cred) return kind === "string" ? cred : undefined;
  for (const rule of RULES) {
    if (!rule.re.test(key)) continue;
    if (kind === "string" && rule.string) return rule.string(rng);
    if (kind === "number" && rule.number) return rule.number(rng);
  }
  return undefined;
}

/** Boolean keys: `is*`, `has*`, `*enabled`, `*_flag` read as true by default. */
export function looksBoolean(key: string): boolean {
  return /^(is|has|can|should|allow|enable|include|with|use)[A-Z_]|enabled$|disabled$|_flag$|^(active|archived|public|private|verified|required|optional|deleted|hidden|visible|default)$/.test(key);
}

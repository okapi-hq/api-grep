import { printable } from "../../src/report/printable.js";
import { SUPABASE, type RepoDetail, type Totals } from "./totals.js";

function pct(num: number, den: number): string {
  return den === 0 ? "n/a" : `${num} / ${den} (${((100 * num) / den).toFixed(1)}%)`;
}

/** `ok 3, unsupported 1`, most frequent first; `none` when empty. */
function counts(rec: Record<string, number>): string {
  const list = Object.entries(rec).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return list.length === 0 ? "none" : list.map(([k, v]) => `\`${k}\` ${v}`).join(", ");
}

function recall(t: Totals): string[] {
  const r = t.recall;
  return [
    "## #3: recall against the reference inventory",
    "",
    `- Inventory call sites found: **${pct(r.matched, r.entries)}** (same file, line within ${t.tolerance}).`,
    `- At the inventory's own line: ${r.sameLine}; through a call reported at a wrapper's caller: ${r.throughWrapper}.`,
    `- Missed in repositories whose scan stopped: ${r.missedInStoppedScans}. In files outside the scanned subdirectory: ${r.outsideScannedDir}.`,
    `- Inventory rows left out: ${r.rejectedRows} invalid, ${r.otherRepositoryRows} naming a repository that is not in this run.`,
    `- Calls reported in all: ${t.calls.reported} (${t.calls.throughWrapper} at a wrapper's caller).`,
  ];
}

function scans(t: Totals): string[] {
  const s = t.scans;
  const reasons = Object.entries(s.reasons).sort((a, b) => b[1].entries - a[1].entries || a[0].localeCompare(b[0]));
  return [
    "## #4: scans that stop, partial reports",
    "",
    `- Scans: ${t.repositories}; with a report: ${s.completed}; **stopped: ${s.stopped}**.`,
    `- Reports with \`complete: true\`: ${s.complete}; with \`complete: false\`: ${s.partial}.`,
    ...(reasons.length === 0
      ? ["- Reasons a report is partial: none."]
      : ["", "| reason (`diagnostics`) | entries | repositories |", "|---|---:|---:|", ...reasons.map(([k, v]) => `| ${k} | ${v.entries} | ${v.repositories} |`)]),
  ];
}

function coverage(t: Totals): string[] {
  return [
    `## #7: \`coverage.sdks\` for \`${SUPABASE}\``,
    "",
    `- Repositories with an entry for it: ${t.supabase.repositories}; status: ${counts(t.supabase.status)}.`,
    `- Every \`coverage.sdks\` entry, all packages: ${counts(t.sdkStatus)}.`,
  ];
}

function providers(t: Totals): string[] {
  const p = t.providers;
  const row = (name: string, s: Totals["providers"]["matched"]): string => `| ${name} | ${s.resolved} | ${s.internal} | ${s.unknown} | ${s.env} |`;
  return [
    "## #8: provider of the matched calls",
    "",
    "| matched calls | resolved | `internal` | `unknown` | `env:*` |",
    "|---|---:|---:|---:|---:|",
    row("all", p.matched),
    row("third-party", p.thirdParty),
    "",
    `- **Third-party calls still \`unknown\` or \`env:*\`: ${p.thirdPartyUnresolved}** (target: at most ${p.target}).`,
    `- Third-party per the inventory (\`kind\` or \`service\`): ${p.thirdPartyFromInventory}; per the report when the inventory does not say (any provider but \`internal\`): ${p.thirdPartyFromReport}.`,
  ];
}

/** The totals to post on #114: counts only. */
export function totalsMarkdown(t: Totals, date = new Date().toISOString().slice(0, 10)): string {
  return [`# Private evaluation: ${t.repositories} repositories, ${date}`, "", ...recall(t), "", ...scans(t), "", ...coverage(t), "", ...providers(t), ""].join("\n");
}

const MAX_MISSED_LISTED = 50;

/** Per repository, with names and paths: for the person who runs the evaluation, never to be posted. */
export function detailMarkdown(details: RepoDetail[]): string {
  const lines = ["## Local detail: do not post (repository names and paths)", ""];
  for (const d of details) {
    const head = `- ${printable(d.name)}: scan ${d.scan}${d.error ? ` (${printable(d.error)})` : ""}, found ${d.matched} / ${d.entries}, third-party unresolved ${d.thirdPartyUnresolved}, ${SUPABASE} ${d.supabase ?? "absent"}`;
    const missed = d.missed.slice(0, MAX_MISSED_LISTED).map((e) => `  - missed ${printable(e.file)}:${e.line}`);
    const more = d.missed.length > MAX_MISSED_LISTED ? [`  - and ${d.missed.length - MAX_MISSED_LISTED} more`] : [];
    lines.push(head, ...missed, ...more);
  }
  return `${lines.join("\n")}\n`;
}

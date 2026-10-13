import type { Assign, Branch, Entry, Expr, FunctionDef, Param } from "./model.js";

/**
 * Keys added to or removed from a dict after it is built (`kwargs["k"] = v`, `kwargs.update(...)`, `del kwargs["k"]`,
 * `$params['k'] = $v`): the front ends lower each statement as an `Assign` with `edit`, and a lookup of the variable
 * folds the edits made in the same function, before the use, into one dict literal. A key added in a block that may not
 * run (a branch, a loop body) is optional unless every branch of an `if` / `else` chain adds it; a key set on several
 * paths keeps each value as an alternative.
 */

/** Calls that build or copy a dict: their result is edited like a literal. */
const DICT_CALLS = new Set(["dict", "copy", "deepcopy"]);

/** Registers a block that may not run before the code after it (a branch, a loop body, a handler). */
export function addBranch(fn: FunctionDef, start: number, end: number, group?: Branch["group"]): void {
  (fn.branches ??= []).push({ start, end, ...(group ? { group } : {}) });
}

function isEditable(e: Expr): boolean {
  if (e.k === "dict") return true;
  if (e.k !== "call") return false;
  const name = e.fn.k === "name" || e.fn.k === "attr" ? e.fn.name : undefined;
  return name !== undefined && DICT_CALLS.has(name);
}

const MAX_SELF_SPREADS = 4;

/** A literal's entries, `dict(k=v, **other)` as entries, anything else spread into a new dict. */
function baseEntries(fn: FunctionDef, target: string, e: Expr, depth: number): Entry[] {
  if (e.k === "call" && e.fn.k === "name" && e.fn.name === "dict" && e.args.every((a) => a.name || a.spread === "dict")) {
    return e.args.map((a) => (a.spread ? { value: a.value, spread: true } : { key: { k: "str", v: a.name! }, value: a.value }));
  }
  if (e.k !== "dict") return [{ value: e, spread: true }];
  // `kwargs = {**kwargs, "k": v}`, `array_merge($params, [...])`: the earlier dict's own entries, for later edits to reach
  return e.entries.flatMap((en) => {
    const self = en.spread && en.value.k === "name" && en.value.name === target && depth < MAX_SELF_SPREADS ? en.value : undefined;
    return (self && selfEntries(fn, target, self.pos.offset, depth)) || [en];
  });
}

/** The entries of the dict `target` holds at `at`, when it is built in place in `fn`. */
function selfEntries(fn: FunctionDef, target: string, at: number, depth: number): Entry[] | undefined {
  const prev = fn.assigns.filter((a) => a.target === target && !a.edit && a.offset < at).at(-1);
  if (!prev || prev.augmented || !isEditable(prev.value)) return undefined;
  return entriesAt(fn, target, prev.value, prev.offset, at, depth + 1);
}

const literalKey = (k: Expr | undefined): string | undefined => (k?.k === "str" ? k.v : k?.k === "num" ? String(k.v) : undefined);

function lastIndexOfKey(entries: Entry[], key: string | undefined): number {
  if (key === undefined) return -1;
  for (let i = entries.length - 1; i >= 0; i--) if (literalKey(entries[i]!.key) === key) return i;
  return -1;
}

/** Whether an edit always runs before the use, runs in one branch of an exhaustive chain, or may not run. */
type Reach = { kind: "always" } | { kind: "group"; branch: Branch & { group: NonNullable<Branch["group"]> } } | { kind: "maybe" };

function reachOf(fn: FunctionDef, offset: number, at: number | undefined): Reach {
  const inside = (b: Branch, o: number): boolean => b.start <= o && o <= b.end;
  const open = (fn.branches ?? []).filter((b) => inside(b, offset) && (at === undefined || !inside(b, at)));
  if (open.length === 0) return { kind: "always" };
  const only = open.length === 1 ? open[0]! : undefined;
  return only?.group ? { kind: "group", branch: { ...only, group: only.group } } : { kind: "maybe" };
}

/** Whether a statement at `offset` may not run before `at` (it is in a branch or a loop body that `at` is not in). */
export const mayNotRun = (fn: FunctionDef, offset: number, at: number | undefined): boolean => reachOf(fn, offset, at).kind !== "always";

/** Per key, the branches of each exhaustive chain that set it: a key set in all of them is always sent. */
type Coverage = Map<string, Map<number, Set<number>>>;

function cover(coverage: Coverage, key: string | undefined, reach: Reach): void {
  if (key === undefined || reach.kind !== "group") return;
  const groups = coverage.get(key) ?? new Map<number, Set<number>>();
  coverage.set(key, groups);
  const seen = groups.get(reach.branch.group.id) ?? new Set<number>();
  groups.set(reach.branch.group.id, seen.add(reach.branch.start));
}

function setEntry(entries: Entry[], en: Entry, edit: Assign, optional: boolean): void {
  const i = en.spread ? -1 : lastIndexOfKey(entries, literalKey(en.key));
  const prev = i >= 0 ? entries[i]! : undefined;
  if (edit.edit === "remove") {
    if (prev && optional) entries[i] = { ...prev, optional: true };
    else if (prev) entries.splice(i, 1);
  } else if (prev && edit.edit === "default") {
    return;
  } else if (prev && optional) {
    entries[i] = { ...prev, value: { k: "cond", then: prev.value, else: en.value } };
  } else if (prev) {
    entries[i] = { key: prev.key, value: en.value };
  } else {
    entries.push(optional ? { ...en, optional: true } : en);
  }
}

function applyEdit(entries: Entry[], edit: Assign, reach: Reach, coverage: Coverage): void {
  const items: Entry[] = edit.value.k === "dict" ? edit.value.entries : edit.value.k === "list" ? edit.value.items.map((key) => ({ key, value: { k: "null" } })) : [];
  for (const en of items) {
    const key = literalKey(en.key);
    if (edit.edit === "remove" && key !== undefined) coverage.delete(key);
    else cover(coverage, key, reach);
    setEntry(entries, en, edit, reach.kind !== "always");
  }
}

/** Keys every branch of an exhaustive chain sets are not optional. */
function settle(entries: Entry[], coverage: Coverage, fn: FunctionDef): void {
  for (const [key, groups] of coverage) {
    const i = lastIndexOfKey(entries, key);
    const all = [...groups].some(([id, seen]) => seen.size === fn.branches?.find((b) => b.group?.id === id)?.group?.size);
    if (i >= 0 && all) entries[i] = { key: entries[i]!.key, value: entries[i]!.value };
  }
}

const editedTargets = new WeakMap<FunctionDef, Set<string>>();

/** The edits of `target` in `fn` after `from` and before `at`, in order. */
function editsOf(fn: FunctionDef, target: string, from: number, at: number | undefined): Assign[] {
  let targets = editedTargets.get(fn);
  if (!targets) {
    targets = new Set(fn.assigns.filter((a) => a.edit).map((a) => a.target));
    editedTargets.set(fn, targets);
  }
  if (!targets.has(target)) return [];
  return fn.assigns.filter((a) => a.edit && a.target === target && a.offset > from && (at === undefined || a.offset < at));
}

/** The entries of `base` with the edits of `target` after `from` and before `at` applied. */
function entriesAt(fn: FunctionDef, target: string, base: Expr, from: number, at: number | undefined, depth: number): Entry[] {
  const entries = baseEntries(fn, target, base, depth);
  const coverage: Coverage = new Map();
  for (const e of editsOf(fn, target, from, at)) applyEdit(entries, e, reachOf(fn, e.offset, at), coverage);
  settle(entries, coverage, fn);
  return entries;
}

/** The dict once edited, as an assignment at `from`; undefined when no edit applies (the value is read as it is). */
function folded(fn: FunctionDef, target: string, base: Expr, from: number, at: number | undefined): Assign | undefined {
  if (editsOf(fn, target, from, at).length === 0) return undefined;
  return { target, value: { k: "dict", entries: entriesAt(fn, target, base, from, at, 0) }, offset: from };
}

/** The assignment `base` of a dict as the code sees it at `at`: with the keys later statements add or remove. */
export function editedAssign(fn: FunctionDef, base: Assign, at: number | undefined): Assign {
  if (base.edit || base.augmented || !isEditable(base.value)) return base;
  return folded(fn, base.target, base.value, base.offset, at) ?? base;
}

/** `def f(**kwargs): kwargs.setdefault(...)`: the keyword arguments with the keys the function adds. */
export function editedParam(fn: FunctionDef, param: Param, at: number | undefined): Assign | undefined {
  if (param.kind !== "kwargs") return undefined;
  return folded(fn, param.name, { k: "name", name: param.name, pos: fn.pos }, fn.pos.offset, at);
}

/** `$data['k'] = $v` with no `$data = [...]` before (PHP creates the array): the keys the function adds. */
export function editedUnbound(fn: FunctionDef, name: string, at: number | undefined): Assign | undefined {
  return folded(fn, name, { k: "dict", entries: [] }, -1, at);
}

import type { Scoped } from "../ir/language.js";
import { dottedPath, type CallExpr, type Entry, type Expr, type FunctionDef } from "../ir/model.js";
import { lookup } from "../ir/project.js";
import type { IrCtx } from "../ir/raw.js";
import { deref } from "../ir/values.js";

/**
 * sendgrid-python's `Mail` helper (`sendgrid.helpers.mail`), as the dict its `get()` gives `sg.send(message)`: the
 * sender as `{email, name}`, the recipients in a personalization, the contents as `{type, value}` items. The attributes
 * the code sets on the variable holding it afterwards (`message.template_id = ...`) are read too; its `add_*` methods
 * are not, nor is a `Mail` built anywhere else than in the function that holds it.
 */

/** A call of a class the sendgrid package exports (`Mail`, `To`, `Content`): its name and the call. */
function sendgridCall(e: Expr, fn: FunctionDef, ctx: IrCtx): { name: string; call: CallExpr; fn: FunctionDef } | undefined {
  const d = deref(e, fn, ctx);
  const name = d.expr.k === "call" ? sendgridName(d.expr, d.fn, ctx) : undefined;
  return name && d.expr.k === "call" ? { name, call: d.expr, fn: d.fn } : undefined;
}

/** The class name of a call of the sendgrid package, read through the module's imports (no dereference: `deref` runs this). */
function sendgridName(call: CallExpr, fn: FunctionDef, ctx: IrCtx): string | undefined {
  const path = dottedPath(call.fn);
  const head = path ? lookup(path[0]!, fn, undefined, ctx.idx) : undefined;
  return head?.kind === "external" && head.path[0] === "sendgrid" ? path![path!.length - 1] : undefined;
}

/** Positional argument N or keyword `kw` of a call, in the scope of `at`. */
function argIn(call: CallExpr, callFn: FunctionDef, at: FunctionDef, index: number, kw: string): Expr | undefined {
  const value = call.args.find((a) => a.name === kw)?.value ?? call.args.filter((a) => !a.name && !a.spread)[index]?.value;
  return value && callFn !== at ? { k: "scoped", expr: value, fn: callFn } : value;
}

const str = (v: string): Expr => ({ k: "str", v });
const dict = (pairs: [string, Expr | undefined][]): Expr => ({ k: "dict", entries: pairs.flatMap(([k, value]) => (value ? [{ key: str(k), value }] : [])) });

/** An address as the API takes it: `Email` / `To` / ... helpers, a `(email, name)` tuple, or the address itself. */
function emailOf(e: Expr, fn: FunctionDef, ctx: IrCtx): Expr {
  const helper = sendgridCall(e, fn, ctx);
  if (helper) return dict([["email", argIn(helper.call, helper.fn, fn, 0, "email")], ["name", argIn(helper.call, helper.fn, fn, 1, "name")]]);
  const d = deref(e, fn, ctx);
  const pair = d.expr.k === "list" && d.expr.items.length === 2 ? d.expr.items : undefined;
  const scoped = (x: Expr): Expr => (d.fn !== fn ? { k: "scoped", expr: x, fn: d.fn } : x);
  return pair ? dict([["email", scoped(pair[0]!)], ["name", scoped(pair[1]!)]]) : dict([["email", e]]);
}

/** `to_emails`: one address, or a list of them (a two-item list is taken as a list, not a `(email, name)` tuple). */
function recipients(e: Expr, fn: FunctionDef, ctx: IrCtx): Expr {
  const d = deref(e, fn, ctx);
  if (d.expr.k !== "list") return { k: "list", items: [emailOf(e, fn, ctx)] };
  const items = d.expr.items.map((x) => emailOf(d.fn !== fn ? { k: "scoped", expr: x, fn: d.fn } : x, fn, ctx));
  return { k: "list", items };
}

/** A content argument: a `Content(type, value)` helper, or the text of the argument's MIME type. */
function contentOf(e: Expr | undefined, mime: string, fn: FunctionDef, ctx: IrCtx): Expr | undefined {
  if (!e) return undefined;
  const helper = sendgridCall(e, fn, ctx);
  if (helper?.name === "Content") return dict([["type", argIn(helper.call, helper.fn, fn, 0, "mime_type")], ["value", argIn(helper.call, helper.fn, fn, 1, "content")]]);
  return dict([["type", str(mime)], ["value", e]]);
}

/** A value given as a one-argument helper (`TemplateId("d-...")`, `Subject("...")`): what it holds. */
function unwrapped(e: Expr, fn: FunctionDef, ctx: IrCtx): Expr {
  const helper = sendgridCall(e, fn, ctx);
  return (helper ? argIn(helper.call, helper.fn, fn, 0, "") : undefined) ?? e;
}

/** Attributes set on the mail after it is built, by the key `get()` gives them; `dynamic_template_data` goes to the personalization. */
const ATTRIBUTES: Record<string, string> = {
  template_id: "template_id",
  subject: "subject",
  from_email: "from",
  reply_to: "reply_to",
  send_at: "send_at",
  batch_id: "batch_id",
  ip_pool_name: "ip_pool_name",
  dynamic_template_data: "dynamic_template_data",
};

/** The attributes the code sets on the variable `call` is assigned to, in the same function, after it. */
function attributesSet(call: CallExpr, fn: FunctionDef): Map<string, Expr> {
  const out = new Map<string, Expr>();
  const assign = fn.assigns.find((a) => a.value === call);
  for (const s of assign && fn.attrSets ? fn.attrSets : []) if (s.target === assign!.target && s.offset > assign!.offset && ATTRIBUTES[s.name]) out.set(ATTRIBUTES[s.name]!, s.value);
  return out;
}

function mailDict(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Expr {
  const arg = (i: number, kw: string): Expr | undefined => argIn(call, fn, fn, i, kw);
  const set = attributesSet(call, fn);
  const from = set.get("from") ?? arg(0, "from_email");
  const to = arg(1, "to_emails");
  const data = set.get("dynamic_template_data");
  const personalization = to || data ? dict([["to", to ? recipients(to, fn, ctx) : undefined], ["dynamic_template_data", data]]) : undefined;
  const contents = [contentOf(arg(3, "plain_text_content"), "text/plain", fn, ctx), contentOf(arg(5, "amp_html_content"), "text/x-amp-html", fn, ctx), contentOf(arg(4, "html_content"), "text/html", fn, ctx)];
  const content = contents.filter((c): c is Expr => !!c);
  const subject = set.get("subject") ?? arg(2, "subject");
  const entries: Entry[] = (dict([
    ["from", from ? emailOf(from, fn, ctx) : undefined],
    ["subject", subject ? unwrapped(subject, fn, ctx) : undefined],
    ["personalizations", personalization ? { k: "list", items: [personalization] } : undefined],
    ["content", content.length > 0 ? { k: "list", items: content } : undefined],
  ]) as Extract<Expr, { k: "dict" }>).entries;
  for (const [key, value] of set) {
    if (key === "from" || key === "subject" || key === "dynamic_template_data") continue;
    entries.push({ key: str(key), value: key === "reply_to" ? emailOf(value, fn, ctx) : unwrapped(value, fn, ctx) });
  }
  return { k: "dict", entries };
}

/** `resolveCall` for sendgrid's `Mail(...)`: the dict it sends. */
export function sendgridMail(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined {
  const path = dottedPath(call.fn);
  if (path?.[path.length - 1] !== "Mail" || sendgridName(call, fn, ctx) !== "Mail") return undefined;
  return { expr: mailDict(call, fn, ctx), fn };
}

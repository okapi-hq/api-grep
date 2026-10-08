import { assembleCall } from "../../assemble.js";
import type { Call } from "../../report/schema.js";
import { partsToUrlShape } from "../../resolve/url-shape.js";
import type { BodyEncoding, Shape } from "../../types.js";
import type { BodyResult } from "../../resolve/body.js";
import type { FormField, HtmlForm } from "./extract.js";

/** Input types that say what a field holds (an `email` field holds an email). */
function fieldShape(f: FormField): Shape {
  if (f.type === "hidden" && f.value !== undefined) return { type: "string", enum: [f.value] };
  if (f.type === "number" || f.type === "range") return { type: "number", hint: f.name };
  if (f.type === "checkbox") return { type: "boolean", hint: f.name };
  const hint = f.type === "email" || f.type === "tel" || f.type === "url" || f.type === "date" ? f.type : f.name;
  return { type: "string", hint };
}

function fieldsShape(form: HtmlForm): Shape {
  const properties = Object.fromEntries(form.fields.map((f) => [f.name, fieldShape(f)]));
  const required = form.fields.filter((f) => f.required || (f.type === "hidden" && f.value !== undefined)).map((f) => f.name);
  return { type: "object", properties, required };
}

function encodingOf(form: HtmlForm): BodyEncoding {
  const enctype = (form.enctype ?? "").toLowerCase();
  return enctype.includes("multipart") ? "multipart" : enctype.includes("text/plain") ? "raw" : "form";
}

/**
 * A form posted to its `action` URL: the fields are the body (or the query string of a GET), named after their
 * `name`, typed from their `type`. Calls are on the `<form>` line.
 */
export function formCall(form: HtmlForm, file: string, envHints: Record<string, string>): Call {
  const url = partsToUrlShape([{ kind: "static", text: form.action }], { envHints });
  const isGet = form.method !== "POST" && form.method !== "PUT" && form.method !== "PATCH" && form.method !== "DELETE";
  const shape = fieldsShape(form);
  const hasFields = form.fields.length > 0;
  const body: BodyResult = isGet || !hasFields ? { encoding: "none", dynamic: [], fromLiteral: false } : { shape, encoding: encodingOf(form), dynamic: [], fromLiteral: true };
  const query = isGet && shape.type === "object" ? { names: Object.keys(shape.properties), shape: shape.properties } : { names: [], shape: {} };
  return assembleCall({
    location: { file, line: form.line, col: form.col, language: "html" },
    client: "html-form",
    url,
    method: isGet ? "GET" : form.method,
    dynamic: url.dynamic,
    body,
    headers: { names: [], values: {}, authScheme: "none" },
    query,
  });
}

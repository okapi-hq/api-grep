/**
 * Server-side template tags inside an inline script (Jinja / Django `{{ x }}` `{% url 'x' %}`, Handlebars, EJS
 * `<%= x %>`, PHP `<?= $x ?>`) rewritten as JavaScript of the same length, so positions in the page do not move:
 *
 *   const id = {{ user.id }};       ->  const id = user_id     ;
 *   fetch("{{ api_url }}/items")    ->  fetch(""+api_url  +"/items")
 *   fetch(`{% url 'items' %}?q=1`)  ->  fetch(`${url          }?q=1`)
 *   {% if admin %} ... {% endif %}  ->  blank
 */

const TAG_RE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}|<%[\s\S]*?%>|<\?(?:php|=)?[\s\S]*?\?>/y;
/** Statement tags that still print a value (`{% url 'name' %}`, `{% static 'x' %}`). */
const OUTPUT_STATEMENTS = /^\{%-?\s*(url|static|csrf_token)\b/;

const blank = (s: string): string => s.replace(/[^\r\n]/g, " ");

/** The value a tag prints, as an identifier (`{{ user.id }}` -> `user_id`); undefined for a statement tag. */
function valueName(tag: string): string | undefined {
  const statement = OUTPUT_STATEMENTS.exec(tag);
  if (statement) return statement[1];
  if (!/^(?:\{\{|<%[=-]|<\?=|<\?php\s+echo\b)/.test(tag)) return undefined;
  const ref = /[A-Za-z_$][\w$]*(?:\s*(?:\.|->)\s*[A-Za-z_$][\w$]*)*/.exec(tag.replace(/^(?:\{\{|<%[=-]|<\?=|<\?php\s+echo)/, ""))?.[0] ?? "value";
  const name = ref.replace(/^\$/, "").replace(/\s*(?:\.|->)\s*/g, "_");
  return /^[A-Za-z_$]/.test(name) ? name : `_${name}`;
}

/** Same-length JavaScript for a tag, in code or in a string quoted with `quote`. */
function replacement(tag: string, quote: string | undefined): string {
  const name = valueName(tag);
  if (!name || /\n/.test(tag)) return blank(tag);
  const fit = (room: number): string => name.slice(0, Math.max(1, room));
  if (!quote) return fit(tag.length).padEnd(tag.length, " ");
  if (quote === "`") {
    const inner = fit(tag.length - 3);
    return `\${${inner}${" ".repeat(Math.max(0, tag.length - 3 - inner.length))}}`;
  }
  if (tag.length < 5) return blank(tag);
  const inner = fit(tag.length - 4);
  return `${quote}+${inner}${" ".repeat(Math.max(0, tag.length - 4 - inner.length))}+${quote}`;
}

/** Skips a comment at `i`; returns the index after it, or `i` when there is none. */
function skipComment(code: string, i: number): number {
  if (code.startsWith("//", i)) {
    const end = code.indexOf("\n", i);
    return end < 0 ? code.length : end;
  }
  if (code.startsWith("/*", i)) {
    const end = code.indexOf("*/", i + 2);
    return end < 0 ? code.length : end + 2;
  }
  return i;
}

/** Rewrites the template tags of a script, tracking whether each one sits in code or in a string. */
export function neutralizeTemplates(code: string): string {
  let out = "";
  let quote: string | undefined;
  for (let i = 0; i < code.length; ) {
    TAG_RE.lastIndex = i;
    const tag = TAG_RE.exec(code)?.[0];
    if (tag) {
      out += replacement(tag, quote);
      i += tag.length;
      continue;
    }
    const c = code[i]!;
    const after = quote ? i : skipComment(code, i);
    if (after !== i) {
      out += code.slice(i, after);
      i = after;
      continue;
    }
    if (quote && c === "\\") {
      out += code.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = quote === c ? undefined : (quote ?? c);
    out += c;
    i++;
  }
  return out;
}

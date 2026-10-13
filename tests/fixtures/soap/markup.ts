// markup that is not an XML document an API reads: no `xml` encoding, no operation

// an HTML page sent to a renderer
export async function render(title: string) {
  const page = `<!DOCTYPE html><html><body><h1>${title}</h1></body></html>`;
  return fetch("https://render.example-docs.com/pdf", { method: "POST", headers: { "Content-Type": "text/html" }, body: page });
}

// an HTML fragment and an SVG image
export const note = () => fetch("https://notes.example-docs.com/notes", { method: "POST", body: "<p>Remember the milk</p>" });
export const badge = (color: string) => fetch("https://render.example-docs.com/png", { method: "POST", body: `<svg width="20"><rect fill="${color}"/></svg>` });

// text that only looks like a tag
export const tag = () => fetch("https://notes.example-docs.com/tags", { method: "POST", body: "<Unclosed>" });

// elements, but sent as JSON: the declared content type wins
export const quoted = (id: string) =>
  fetch("https://notes.example-docs.com/raw", { method: "POST", headers: { "Content-Type": "application/json" }, body: `<Ref><Id>${id}</Id></Ref>` });

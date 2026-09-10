declare function buildInit(): RequestInit;

export function createPage() {
  const init = buildInit();
  return fetch("https://api.notion.com/v1/pages", init);
}

export function dynamicMethod(method: string) {
  return fetch("https://api.notion.com/v1/blocks", { method, headers: new Headers({ "Notion-Version": "2022-06-28" }) });
}

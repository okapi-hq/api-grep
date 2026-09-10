export const item = (id: string) => fetch("https://api." + "example.com" + "/x/" + encodeURIComponent(id));
export const joined = (a: string) => fetch(["https://api.example.com", "v1", a].join("/"));

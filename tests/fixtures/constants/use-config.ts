import { API_ROOT, CONFIG } from "./config";

export const gql = (query: string) => fetch(CONFIG.baseUrl + "/graphql", { method: "POST", body: JSON.stringify({ query }) });
export const projects = () => fetch(API_ROOT + "/v9/projects");

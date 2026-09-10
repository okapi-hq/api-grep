import axios from "axios";

const token = process.env.LINEAR_TOKEN;
const api = axios.create({ baseURL: "https://api.linear.app", headers: { Authorization: token } });

export function query(q: string) {
  return api.post("/graphql", { query: q, variables: { first: 10 } });
}

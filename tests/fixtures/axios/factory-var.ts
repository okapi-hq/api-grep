import axios from "axios";

function makeClient() {
  const client = axios.create({ baseURL: "https://api.vercel.com" });
  client.interceptors.response.use((r) => r);
  return client;
}

export const request = makeClient();
export const deployments = () => request.get("/v6/deployments");

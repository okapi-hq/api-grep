import axios from "axios";

function createClient() {
  return axios.create({ baseURL: "https://api.linear.app", headers: { Authorization: `Bearer ${process.env.LINEAR_KEY}` } });
}

const client = createClient();

export const teams = () => client.get("/teams");

import axios from "axios";

export const hubspot = axios.create({ baseURL: process.env.HUBSPOT_URL, headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` } });

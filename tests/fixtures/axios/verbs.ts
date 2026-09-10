import axios from "axios";

const k = process.env.OPENAI_API_KEY;

export async function chat(messages: { role: string; content: string }[]) {
  return axios.post("https://api.openai.com/v1/chat/completions", { model: "gpt-4o", messages, temperature: 0.2 }, { headers: { Authorization: `Bearer ${k}` } });
}

export const getUser = (id: string) => axios.get(`https://api.github.com/users/${id}`, { params: { per_page: 10 } });
export const replace = (id: string, body: Record<string, unknown>) => axios.put(`https://api.example.com/items/${id}`, body);
export const patch = () => axios.patch("https://api.example.com/items/1", { archived: true });
export const remove = (id: number) => axios.delete("https://api.example.com/items/" + id);

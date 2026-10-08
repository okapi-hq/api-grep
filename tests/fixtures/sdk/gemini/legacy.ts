import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export async function tagline(product: string) {
  const result = await model.generateContent(`Write a tagline for ${product}`);
  return result.response.text();
}

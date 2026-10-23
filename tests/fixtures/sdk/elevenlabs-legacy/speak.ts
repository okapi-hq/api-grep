import { ElevenLabsClient } from "elevenlabs";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

export const say = (text: string) => client.textToSpeech.convert("VoiceAbc123", { text, model_id: "acme_voice_v2", output_format: "mp3_44100_128" });

export const sayLive = (text: string) => client.textToSpeech.convertAsStream("VoiceAbc123", { text, model_id: "acme_voice_fast" });

export const models = () => client.models.getAll();

export const signedUrl = (agentId: string) => client.conversationalAi.getSignedUrl({ agent_id: agentId });

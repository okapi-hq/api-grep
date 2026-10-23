import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

export const read = (text: string) => elevenlabs.textToSpeech.convert("VoiceAbc123", { text, modelId: "acme_voice_v2", outputFormat: "mp3_44100_128", voiceSettings: { stability: 0.5, similarityBoost: 0.8 } });

export const readLive = (voiceId: string, text: string) => elevenlabs.textToSpeech.stream(voiceId, { text, modelId: "acme_voice_fast" });

export const timed = (text: string) => elevenlabs.textToSpeech.convertWithTimestamps("VoiceAbc123", { text, modelId: "acme_voice_v2" });

export const transcribe = (file: Blob) => elevenlabs.speechToText.convert({ file, modelId: "acme_scribe", tagAudioEvents: true });

export const effect = (text: string) => elevenlabs.textToSoundEffects.convert({ text, durationSeconds: 3 });

export const voices = () => elevenlabs.voices.search({ pageSize: 20 });

export const voice = (id: string) => elevenlabs.voices.get(id);

export const models = () => elevenlabs.models.list();

export const signedUrl = (agentId: string) => elevenlabs.conversationalAi.conversations.getSignedUrl({ agentId });

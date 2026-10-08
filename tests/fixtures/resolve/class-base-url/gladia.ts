export class TranscriptionClient {
  private readonly baseUrl: string;

  constructor(opts: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = opts.baseUrl ?? "https://api.gladia.io";
  }

  upload(file: Blob) {
    return fetch(`${this.baseUrl}/v2/upload`, { method: "POST", body: file });
  }
}

export class SpeechClient {
  constructor(private readonly baseUrl = "https://api.elevenlabs.io") {}

  speak(voiceId: string, text: string) {
    return fetch(`${this.baseUrl}/v1/text-to-speech/${voiceId}`, { method: "POST", body: JSON.stringify({ text }) });
  }
}

export function listVoices(base = "https://api.elevenlabs.io") {
  return fetch(`${base}/v1/voices`);
}

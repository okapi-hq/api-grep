const Groq = require("groq-sdk");

const groq = process.env.PODCAST_GROQ_KEY ? new Groq({ apiKey: process.env.PODCAST_GROQ_KEY }) : null;

class Episodes {
  constructor() {
    this.client = null;
  }

  connect() {
    this.client = process.env.PODCAST_GROQ_KEY && new Groq({ apiKey: process.env.PODCAST_GROQ_KEY });
  }

  async summary(text) {
    return this.client.chat.completions.create({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: text }] });
  }
}

async function transcribe(file) {
  if (!groq) return null;
  return groq.audio.transcriptions.create({ file, model: "whisper-large-v3" });
}

module.exports = { Episodes, transcribe };

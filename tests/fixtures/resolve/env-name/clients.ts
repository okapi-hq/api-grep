export const models = () => fetch(`${process.env.OPENROUTER_BASE_URL}/models`);

export const invoke = (name: string) => fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, { method: "POST" });

export const alert = (text: string) => fetch(process.env.SLACK_WEBHOOK_URL!, { method: "POST", body: JSON.stringify({ text }) });

// the app's own backend and its own callback stay as env vars
export const me = () => fetch(`${import.meta.env.VITE_API_URL}/me`);
export const callback = () => fetch(`${process.env.GITHUB_CALLBACK_URL}?ping=1`);

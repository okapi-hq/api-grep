import Bugsnag from "@bugsnag/browser";

const client = Bugsnag.createClient({
  apiKey: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
  autoTrackSessions: false,
  endpoints: { notify: "https://bugs.lanternfish.example/notify", sessions: "https://bugs.lanternfish.example/sessions" },
});

export const capture = (err: Error) => client.notify(err);

export const beginSession = () => client.startSession();

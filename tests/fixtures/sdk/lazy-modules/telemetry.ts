type CrashSdk = { captureException(e: unknown): void };
type Events = { capture(event: string, props?: object): void };

let CrashReporter: CrashSdk | null = null;
let EventsClient: { new (key: string, o?: { host?: string }): Events } | null = null;
// one of two analytics packages, picked at run time: no package is named
let Either: { capture(e: string): void } | null = null;

const crashes = (): CrashSdk | null => {
  if (CrashReporter) return CrashReporter;
  try {
    CrashReporter = require("@sentry/react-native");
    return CrashReporter;
  } catch {
    return null;
  }
};

try {
  const module = require("posthog-react-native");
  EventsClient = module.default || module.PostHog;
  Either = process.env.LEGACY ? require("posthog-js").default : require("@sentry/react-native");
} catch {
  // optional
}

class Telemetry {
  private client: Events | null = null;

  start(key: string) {
    if (EventsClient) this.client = new EventsClient(key, { host: "https://eu.i.posthog.com" });
  }

  track(event: string) {
    this.client?.capture(event, { screen: "library" });
    Either?.capture(event);
  }
}

export function crash(e: unknown) {
  const sdk = crashes();
  sdk?.captureException(e);
}

export const telemetry = new Telemetry();

class Crashes {
  private sdk: CrashSdk | null = null;

  start() {
    const loaded = crashes();
    if (loaded) this.sdk = loaded;
  }

  report(e: unknown) {
    this.sdk?.captureException(e);
  }
}

export const crashReports = new Crashes();

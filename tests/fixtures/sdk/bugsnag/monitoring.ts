import Bugsnag from "@bugsnag/js";

Bugsnag.start({ apiKey: process.env.BUGSNAG_API_KEY!, appVersion: "2.4.1" });

export function report(err: Error) {
  Bugsnag.leaveBreadcrumb("report", { at: Date.now() });
  Bugsnag.notify(err);
}

export const reportWithContext = (err: Error, orderId: string) =>
  Bugsnag.notify(err, (event) => {
    event.addMetadata("order", { orderId });
  });

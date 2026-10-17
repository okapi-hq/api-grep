import analytics from "./monitoring";

export function fired(kilnId: string) {
  analytics.capture({ distinctId: kilnId, event: "kiln_fired" });
}

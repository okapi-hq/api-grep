const ax = require("axios");

export function ping() {
  return ax.post("https://api.example.com/ping", { at: Date.now() });
}

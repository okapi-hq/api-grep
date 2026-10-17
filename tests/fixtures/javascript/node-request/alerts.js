const https = require("https");

// the URL is the wrapper's untyped parameter, the options object follows it
function postJson(url, { method = "POST", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(url, { method, headers: { "Content-Type": "application/json", ...headers } }, (res) => resolve(res.statusCode));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pageOnCall(summary) {
  return postJson("https://events.pagerbell-demo.io/v2/enqueue", { body: { summary } });
}

// an options object, not a URL: the host is read from it
function health(cb) {
  const opts = { hostname: "status.pagerbell-demo.io", path: "/v1/health", method: "GET" };
  return https.request(opts, cb);
}

module.exports = { pageOnCall, health };

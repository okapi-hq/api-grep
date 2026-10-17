const Sentry = require("./sentry-setup");

process.on("unhandledRejection", (err) => {
  Sentry.captureException(err);
});

function firing(batch) {
  Sentry.captureMessage(`kiln batch ${batch} started`);
}

module.exports = { firing };

const Sentry = require("@sentry/node");

Sentry.init({ dsn: process.env.KILN_SENTRY_DSN });

module.exports = Sentry;

const Bugsnag = require("@bugsnag/node");

Bugsnag.start("a1b2c3d4e5f60718293a4b5c6d7e8f90");

function onJobFailed(err) {
  Bugsnag.notify(err);
}

module.exports = { onJobFailed };

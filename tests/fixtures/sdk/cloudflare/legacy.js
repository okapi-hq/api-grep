const cf = require("cloudflare")({ token: process.env.CF_TOKEN });

async function pointAt(zoneId, ip) {
  await cf.dnsRecords.add(zoneId, { type: "A", name: "app", content: ip });
  return cf.dnsRecords.browse(zoneId);
}

const flush = (zoneId) => cf.zones.purgeCache(zoneId, { purge_everything: true });

const pause = (zoneId) => cf.zones.edit(zoneId, { paused: true });

module.exports = { pointAt, flush, pause };

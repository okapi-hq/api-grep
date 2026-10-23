const bizSdk = require("facebook-nodejs-business-sdk");

const EventRequest = bizSdk.EventRequest;
const ServerEvent = bizSdk.ServerEvent;
const UserData = bizSdk.UserData;

async function trackPurchase(email, pixelId) {
  const userData = new UserData().setEmails([email]);
  const event = new ServerEvent().setEventName("Purchase").setEventTime(Math.floor(Date.now() / 1000)).setUserData(userData);
  const request = new EventRequest(process.env.META_CAPI_TOKEN, pixelId).setEvents([event]);
  return request.execute();
}

function trackLead(event) {
  return new EventRequest(process.env.META_CAPI_TOKEN, "1029384756").setEvents([event]).setTestEventCode("TEST4242").execute();
}

const ownedAccounts = (id) => new bizSdk.Business(id).getOwnedAdAccounts(["name"]);

module.exports = { trackPurchase, trackLead, ownedAccounts };

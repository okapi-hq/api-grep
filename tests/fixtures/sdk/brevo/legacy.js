const SibApiV3Sdk = require("sib-api-v3-sdk");

SibApiV3Sdk.ApiClient.instance.authentications["api-key"].apiKey = process.env.SENDINBLUE_KEY;

const api = new SibApiV3Sdk.TransactionalEmailsApi();

function sendReset(to, link) {
  return api.sendTransacEmail({ to: [{ email: to }], templateId: 7, params: { link } });
}

module.exports = { sendReset };

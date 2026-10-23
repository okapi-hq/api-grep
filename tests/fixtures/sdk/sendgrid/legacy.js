const sgMail = require("@sendgrid/mail");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function notifyOwner(owner) {
  return sgMail.send({ to: owner.email, from: "robot@harbor-tide.test", subject: "Weekly report", text: "See attached", attachments: [{ content: owner.report, filename: "report.csv", contentId: "weekly" }] });
}

module.exports = { notifyOwner };

const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const fetch = require("node-fetch");
const { github } = require("./client");
const config = require("./config");

const app = express();

app.post("/checkout", async (req, res) => {
  const session = await stripe.checkout.sessions.create({ mode: "payment", line_items: req.body.items });
  res.json(session);
});

app.get("/repos/:owner", async (req, res) => {
  const { data } = await github.get(`/users/${req.params.owner}/repos`, { params: { per_page: 30 } });
  res.json(data);
});

async function notify(text) {
  return fetch(config.slackWebhook, { method: "POST", body: JSON.stringify({ text }), headers: { "Content-Type": "application/json" } });
}

module.exports = { app, notify };

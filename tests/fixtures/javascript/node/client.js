const axios = require("axios");
const { GITHUB_API } = require("./config");

const github = axios.create({ baseURL: GITHUB_API, headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } });

module.exports = { github };

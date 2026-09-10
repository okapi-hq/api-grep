import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_TOKEN);

export const say = (channel: string) => slack.chat.postMessage({ channel, text: "hi", unfurl_links: false });

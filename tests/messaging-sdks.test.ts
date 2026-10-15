import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const keys = (c: Call): string[] => Object.keys((c.body as { properties?: object } | undefined)?.properties ?? {}).sort();

describe("Telegram Bot API libraries: JavaScript and TypeScript", () => {
  it("node-telegram-bot-api: positional arguments and the form options are the body", async () => {
    const r = await scanFixture("sdk/telegram-node");
    expect(at(r, "bot.js", 6)).toMatchObject({ provider: "telegram", method: "POST", host: "api.telegram.org", pathTemplate: "/bot{token}/sendMessage", bodyEncoding: "form", sdk: { package: "node-telegram-bot-api" } });
    expect(keys(at(r, "bot.js", 6))).toEqual(["chat_id", "parse_mode", "text"]);
    expect(keys(at(r, "bot.js", 10))).toEqual(["caption", "chat_id", "photo"]);
    // `editMessageText(text, form)` takes the text first; `setWebHook` is the library's name for `setWebhook`
    expect(keys(at(r, "bot.js", 13))).toEqual(["chat_id", "message_id", "text"]);
    expect(at(r, "bot.js", 14)).toMatchObject({ pathTemplate: "/bot{token}/setWebhook", sdk: { chain: "setWebHook" } });
  });

  it("telegraf: bot.telegram methods and the handler context, JSON bodies", async () => {
    const r = await scanFixture("sdk/telegraf");
    expect(at(r, "bot.ts", 5)).toMatchObject({ pathTemplate: "/bot{token}/sendMessage", bodyEncoding: "json", clientFrom: "manifest", sdk: { chain: "ctx.reply" } });
    expect(keys(at(r, "bot.ts", 5))).toEqual(["text"]);
    expect(at(r, "bot.ts", 6)).toMatchObject({ pathTemplate: "/bot{token}/sendPhoto" });
    expect(at(r, "bot.ts", 8)).toMatchObject({ pathTemplate: "/bot{token}/answerCallbackQuery" });
    expect(at(r, "bot.ts", 9)).toMatchObject({ pathTemplate: "/bot{token}/sendMessage", sdk: { chain: "telegram.sendMessage" } });
    expect(keys(at(r, "bot.ts", 13))).toEqual(["chat_id", "parse_mode", "text"]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["telegraf", "ok"]]);
  });

  it("grammY: bot.api, ctx.api and the handler context", async () => {
    const r = await scanFixture("sdk/grammy");
    expect(r.calls.map((c) => [c.location.line, c.pathTemplate])).toEqual([
      [5, "/bot{token}/sendMessage"],
      [7, "/bot{token}/sendChatAction"],
      [8, "/bot{token}/setMessageReaction"],
      [11, "/bot{token}/sendMessage"],
      [12, "/bot{token}/deleteMessage"],
    ]);
    expect(keys(at(r, "bot.ts", 7))).toEqual(["action", "chat_id"]);
    expect(keys(at(r, "bot.ts", 12))).toEqual(["chat_id", "message_id"]);
  });

});

describe("Telegram Bot API libraries: Python and PHP", () => {
  it("python-telegram-bot, aiogram and pyTelegramBotAPI: the bot, what holds it, and the objects handlers get", async () => {
    const r = await scanFixture("python/sdk/telegram");
    expect(at(r, "ptb_bot.py", 9)).toMatchObject({ pathTemplate: "/bot{token}/sendMessage", bodyEncoding: "form", sdk: { package: "python-telegram-bot", chain: "message.reply_text" } });
    expect(keys(at(r, "ptb_bot.py", 10))).toEqual(["chat_id", "parse_mode", "text"]);
    expect(at(r, "ptb_bot.py", 15)).toMatchObject({ pathTemplate: "/bot{token}/answerCallbackQuery" });
    expect(at(r, "ptb_bot.py", 16)).toMatchObject({ pathTemplate: "/bot{token}/editMessageText" });
    // an untyped handler's `context.bot`: the one SDK the manifests declare with that method
    expect(at(r, "ptb_bot.py", 20)).toMatchObject({ pathTemplate: "/bot{token}/sendPhoto", clientFrom: "manifest" });
    expect(keys(at(r, "ptb_bot.py", 25))).toEqual(["chat_id", "text"]);
    expect(at(r, "ptb_bot.py", 31)).toMatchObject({ pathTemplate: "/bot{token}/setMyCommands" });
    expect(at(r, "aio_bot.py", 11)).toMatchObject({ pathTemplate: "/bot{token}/sendMessage", sdk: { package: "aiogram", chain: "answer" } });
    expect(at(r, "aio_bot.py", 17)).toMatchObject({ pathTemplate: "/bot{token}/answerCallbackQuery" });
    expect(at(r, "aio_bot.py", 18)).toMatchObject({ pathTemplate: "/bot{token}/editMessageText" });
    // pyTelegramBotAPI sends the parameters in the query string, `get*` methods as a GET
    expect(at(r, "tele_bot.py", 9)).toMatchObject({ method: "POST", pathTemplate: "/bot{token}/sendMessage", query: ["text"] });
    expect(at(r, "tele_bot.py", 10).query).toEqual(["chat_id", "text", "parse_mode"]);
    expect(at(r, "tele_bot.py", 11)).toMatchObject({ method: "GET", pathTemplate: "/bot{token}/getMe" });
  });

  it("irazasyed/telegram-bot-sdk: the Api client and the Laravel facade", async () => {
    const r = await scanFixture("php/sdk/telegram");
    expect(at(r, "Bot.php", 19)).toMatchObject({ pathTemplate: "/bot{token}/sendMessage", bodyEncoding: "form" });
    expect(keys(at(r, "Bot.php", 19))).toEqual(["chat_id", "parse_mode", "text"]);
    expect(at(r, "Bot.php", 24)).toMatchObject({ pathTemplate: "/bot{token}/sendPhoto" });
    expect(at(r, "Bot.php", 29)).toMatchObject({ pathTemplate: "/bot{token}/setWebhook" });
    expect(at(r, "Bot.php", 31)).toMatchObject({ pathTemplate: "/bot{token}/deleteWebhook", sdk: { chain: "removeWebhook" } });
  });
});

describe("Discord REST API v10", () => {
  it("discord.js: the client's managers, the objects events hand over, and REST routes", async () => {
    const r = await scanFixture("sdk/discord-js");
    expect(at(r, "bot.js", 6)).toMatchObject({ provider: "discord", host: "discord.com", method: "POST", pathTemplate: "/api/v10/channels/{channel_id}/messages", clientFrom: "manifest" });
    expect(at(r, "bot.js", 8)).toMatchObject({ pathTemplate: "/api/v10/channels/{channel_id}/messages", sdk: { chain: "channel.send" } });
    expect(at(r, "bot.js", 13)).toMatchObject({ pathTemplate: "/api/v10/interactions/{interaction_id}/{interaction_token}/callback" });
    expect(at(r, "bot.js", 14)).toMatchObject({ method: "PATCH", pathTemplate: "/api/v10/webhooks/{application_id}/{interaction_token}/messages/@original" });
    expect(at(r, "bot.js", 15)).toMatchObject({ method: "GET", pathTemplate: "/api/v10/guilds/{guild_id}/members" });
    // a channel fetched by id, then sent to
    expect(at(r, "bot.js", 21)).toMatchObject({ pathTemplate: "/api/v10/channels/{channel_id}/messages", sdk: { chain: "channels.fetch.send" } });
    expect(at(r, "bot.js", 24)).toMatchObject({ method: "GET", pathTemplate: "/api/v10/gateway/bot" });
    expect(at(r, "deploy.ts", 6)).toMatchObject({ method: "PUT", pathTemplate: "/api/v10/applications/{application_id}/commands" });
    expect(at(r, "deploy.ts", 7)).toMatchObject({ pathTemplate: "/api/v10/applications/{application_id}/guilds/{guild_id}/commands" });
    expect(at(r, "deploy.ts", 9)).toMatchObject({ method: "POST", pathTemplate: "/api/v10/channels/123/messages" });
    expect(keys(at(r, "deploy.ts", 9))).toEqual(["content"]);
    expect(at(r, "deploy.ts", 10)).toMatchObject({ method: "GET", pathTemplate: "/api/v10/users/@me" });
  });

  it("discord.py: client, command tree, interactions, contexts and messages", async () => {
    const r = await scanFixture("python/sdk/discord");
    expect(at(r, "bot.py", 14)).toMatchObject({ method: "PUT", pathTemplate: "/api/v10/applications/{application_id}/commands", sdk: { chain: "sync" } });
    expect(at(r, "bot.py", 20)).toMatchObject({ pathTemplate: "/api/v10/channels/{channel_id}/messages", clientFrom: "manifest" });
    expect(at(r, "bot.py", 25)).toMatchObject({ pathTemplate: "/api/v10/interactions/{interaction_id}/{interaction_token}/callback" });
    expect(keys(at(r, "bot.py", 25))).toEqual(["content", "ephemeral"]);
    expect(at(r, "bot.py", 26)).toMatchObject({ pathTemplate: "/api/v10/webhooks/{application_id}/{interaction_token}" });
    expect(at(r, "bot.py", 31)).toMatchObject({ pathTemplate: "/api/v10/channels/{channel_id}/messages", sdk: { chain: "send" } });
    expect(at(r, "bot.py", 36)).toMatchObject({ pathTemplate: "/api/v10/channels/{channel_id}/messages", sdk: { chain: "get_channel.send" } });
    expect(at(r, "bot.py", 42)).toMatchObject({ method: "PUT", pathTemplate: "/api/v10/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me" });
    expect(at(r, "bot.py", 46)).toMatchObject({ method: "GET", pathTemplate: "/api/v10/users/@me" });
  });
});

describe("Hugging Face inference", () => {
  it("huggingface_hub: the router's chat completions, task models and Hub downloads", async () => {
    const r = await scanFixture("python/sdk/huggingface");
    expect(at(r, "infer.py", 8)).toMatchObject({ provider: "huggingface", host: "router.huggingface.co", pathTemplate: "/v1/chat/completions" });
    // the model the client was built with
    expect(at(r, "infer.py", 8).model).toMatchObject({ values: ["meta-llama/Llama-3.1-8B-Instruct"] });
    expect(at(r, "infer.py", 13).model).toMatchObject({ values: ["Qwen/Qwen2.5-72B-Instruct"] });
    expect(at(r, "infer.py", 17)).toMatchObject({ pathTemplate: "/hf-inference/models/{model}", model: { values: ["meta-llama/Llama-3.1-8B-Instruct"] } });
    expect(at(r, "infer.py", 21).model).toMatchObject({ values: ["black-forest-labs/FLUX.1-schnell"] });
    expect(at(r, "infer.py", 25)).toMatchObject({ method: "GET", host: "huggingface.co", pathTemplate: "/{repo_id}/resolve/{revision}/{filename}" });
  });

  it("@huggingface/inference: chatCompletion and task methods", async () => {
    const r = await scanFixture("sdk/huggingface");
    expect(at(r, "hf.ts", 6)).toMatchObject({ host: "router.huggingface.co", pathTemplate: "/v1/chat/completions", model: { values: ["meta-llama/Llama-3.1-8B-Instruct"] } });
    expect(at(r, "hf.ts", 9)).toMatchObject({ pathTemplate: "/hf-inference/models/gpt2", model: { values: ["gpt2"] } });
    expect(at(r, "hf.ts", 10)).toMatchObject({ pathTemplate: "/hf-inference/models/stabilityai/stable-diffusion-2" });
  });
});

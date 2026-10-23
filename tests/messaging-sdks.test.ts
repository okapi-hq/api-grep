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

describe("Replicate", () => {
  const predictionsOfModel = "/v1/models/{model_owner}/{model_name}/predictions";

  it("replicate (PyPI): run picks the version or the model path, predictions, deployments and trainings", async () => {
    const r = await scanFixture("python/sdk/replicate");
    // a reference with a version creates a prediction of that version; the model fact leaves the version out
    expect(at(r, "studio.py", 10)).toMatchObject({ provider: "replicate", method: "POST", host: "api.replicate.com", pathTemplate: "/v1/predictions", authScheme: "bearer", model: { values: ["acme-labs/sketchy"] } });
    expect(keys(at(r, "studio.py", 10))).toEqual(["input"]);
    expect(at(r, "studio.py", 14)).toMatchObject({ pathTemplate: predictionsOfModel, model: { values: ["acme-labs/poster-maker"] } });
    expect(at(r, "studio.py", 18)).toMatchObject({ pathTemplate: predictionsOfModel, sdk: { chain: "run" } });
    expect(at(r, "studio.py", 22)).toMatchObject({ pathTemplate: predictionsOfModel, model: { values: ["acme-labs/poster-maker"] } });
    // `wait=` is the `Prefer: wait` header, not a body key
    expect(keys(at(r, "studio.py", 22))).toEqual(["input", "webhook"]);
    expect(keys(at(r, "studio.py", 38))).toEqual(["input"]);
    expect(keys(at(r, "studio.py", 26))).toEqual(["input", "version"]);
    expect(at(r, "studio.py", 34)).toMatchObject({ method: "POST", pathTemplate: "/v1/predictions/{prediction_id}/cancel" });
    expect(at(r, "studio.py", 38)).toMatchObject({ pathTemplate: "/v1/deployments/{deployment_owner}/{deployment_name}/predictions" });
    // a deployment object read once, then asked for a prediction
    expect(at(r, "studio.py", 43)).toMatchObject({ pathTemplate: "/v1/deployments/{deployment_owner}/{deployment_name}/predictions", model: { values: ["acme-labs/tuned-captioner"] } });
    expect(r.calls.find((c) => c.sdk?.chain === "models.get.versions.list")).toMatchObject({ method: "GET", pathTemplate: "/v1/models/{model_owner}/{model_name}/versions", model: { values: ["acme-labs/sketchy"] } });
    expect(at(r, "studio.py", 55)).toMatchObject({ pathTemplate: "/v1/models/{model_owner}/{model_name}/versions/{version_id}/trainings", model: { values: ["acme-labs/sketchy"] } });
    expect(keys(at(r, "studio.py", 55))).toEqual(["destination", "input"]);
    expect(at(r, "studio.py", 65)).toMatchObject({ pathTemplate: "/v1/files", bodyEncoding: "multipart" });
    // a reference the scan cannot read: the model's path, the model unknown
    expect(at(r, "studio.py", 69)).toMatchObject({ pathTemplate: predictionsOfModel, model: { values: [], dynamic: true } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["replicate", "ok"]]);
  });

  it("replicate (npm): run, predictions.create by model or version, owner and name arguments", async () => {
    const r = await scanFixture("sdk/replicate");
    expect(at(r, "render.ts", 5)).toMatchObject({ method: "POST", host: "api.replicate.com", pathTemplate: "/v1/predictions", authScheme: "bearer", model: { values: ["acme-labs/sketchy"] } });
    expect(at(r, "render.ts", 7)).toMatchObject({ pathTemplate: predictionsOfModel, model: { values: ["acme-labs/poster-maker"] } });
    expect(at(r, "render.ts", 10)).toMatchObject({ pathTemplate: predictionsOfModel, model: { values: ["acme-labs/poster-maker"] } });
    // the library takes `model` (the path), `wait` (a header) and `signal` out of the options it sends
    expect(keys(at(r, "render.ts", 10))).toEqual(["input", "webhook"]);
    expect(at(r, "render.ts", 10).dynamic.filter((d) => d.where === "body").map((d) => d.name)).toEqual(["prompt"]);
    expect(keys(at(r, "render.ts", 5))).toEqual(["input"]);
    expect(keys(at(r, "render.ts", 25))).toEqual(["input"]);
    expect(at(r, "render.ts", 13)).toMatchObject({ pathTemplate: "/v1/predictions" });
    expect(at(r, "render.ts", 15)).toMatchObject({ method: "GET", pathTemplate: "/v1/predictions/{prediction_id}" });
    expect(at(r, "render.ts", 17)).toMatchObject({ pathTemplate: "/v1/deployments/{deployment_owner}/{deployment_name}/predictions" });
    expect(keys(at(r, "render.ts", 17))).toEqual(["input"]);
    expect(keys(at(r, "render.ts", 22))).toEqual(["destination", "input"]);
    expect(at(r, "render.ts", 22)).toMatchObject({ pathTemplate: "/v1/models/{model_owner}/{model_name}/versions/{version_id}/trainings" });
    expect(at(r, "render.ts", 25)).toMatchObject({ pathTemplate: predictionsOfModel, sdk: { chain: "stream" } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["replicate", "ok"]]);
  });
});

describe("fal", () => {
  const status = "/{app_owner}/{app_alias}/requests/{request_id}/status";
  const result = "/{app_owner}/{app_alias}/requests/{request_id}";

  it("fal-client (PyPI): run on fal.run, the queue on queue.fal.run, request handles, the CDN upload", async () => {
    const r = await scanFixture("python/sdk/fal");
    expect(at(r, "canvas.py", 11)).toMatchObject({ provider: "fal", method: "POST", host: "fal.run", pathTemplate: "/{app_id}", authScheme: "apikey", model: { values: ["fal-ai/flux/dev"] } });
    expect(keys(at(r, "canvas.py", 11))).toEqual(["num_images", "prompt"]);
    // `subscribe` is reported as its submit, the request that sends the input; `with_logs` is no body key
    expect(at(r, "canvas.py", 15)).toMatchObject({ method: "POST", host: "queue.fal.run", pathTemplate: "/{app_id}", model: { values: ["fal-ai/flux/schnell"] } });
    expect(keys(at(r, "canvas.py", 15))).toEqual(["prompt"]);
    expect(at(r, "canvas.py", 19)).toMatchObject({ host: "queue.fal.run", query: ["fal_webhook"], model: { values: ["acme-studio/upscaler"] } });
    expect(at(r, "canvas.py", 23)).toMatchObject({ method: "GET", host: "queue.fal.run", pathTemplate: status, query: ["logs"] });
    expect(at(r, "canvas.py", 27)).toMatchObject({ method: "GET", pathTemplate: result, model: { values: ["acme-studio/upscaler"] } });
    expect(at(r, "canvas.py", 31)).toMatchObject({ method: "PUT", pathTemplate: `${result}/cancel` });
    // the handle `submit` returns, read for its result
    expect(at(r, "canvas.py", 36)).toMatchObject({ method: "GET", pathTemplate: result, sdk: { chain: "submit.get" }, model: { values: ["fal-ai/flux/dev"] } });
    expect(at(r, "canvas.py", 40)).toMatchObject({ method: "POST", host: "fal.run", pathTemplate: "/{app_id}/stream" });
    expect(at(r, "canvas.py", 45)).toMatchObject({ method: "POST", host: "v3.fal.media", pathTemplate: "/files/upload" });
    expect(at(r, "canvas.py", 49)).toMatchObject({ host: "fal.run", model: { values: [], dynamic: true } });
    expect(at(r, "canvas.py", 53)).toMatchObject({ host: "queue.fal.run", sdk: { chain: "subscribe_async" } });
    expect(at(r, "canvas.py", 57)).toMatchObject({ pathTemplate: status, sdk: { chain: "get_handle.status" } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["fal-client", "ok"]]);
  });

  it("@fal-ai/client: the fal singleton and createFalClient, queue methods, storage; realtime is no HTTP call", async () => {
    const r = await scanFixture("sdk/fal");
    expect(at(r, "canvas.ts", 5)).toMatchObject({ provider: "fal", method: "POST", host: "fal.run", pathTemplate: "/{app_id}", authScheme: "apikey", model: { values: ["fal-ai/flux/dev"] } });
    expect(keys(at(r, "canvas.ts", 5))).toEqual(["num_images", "prompt"]);
    expect(at(r, "canvas.ts", 7)).toMatchObject({ host: "queue.fal.run", pathTemplate: "/{app_id}", model: { values: ["fal-ai/flux/schnell"] } });
    expect(keys(at(r, "canvas.ts", 7))).toEqual(["prompt"]);
    expect(at(r, "canvas.ts", 9)).toMatchObject({ host: "queue.fal.run", query: ["fal_webhook"], sdk: { chain: "queue.submit" } });
    expect(at(r, "canvas.ts", 11)).toMatchObject({ method: "GET", pathTemplate: status, model: { values: ["acme-studio/upscaler"] } });
    expect(at(r, "canvas.ts", 13)).toMatchObject({ method: "GET", pathTemplate: result });
    expect(at(r, "canvas.ts", 15)).toMatchObject({ method: "PUT", pathTemplate: `${result}/cancel` });
    expect(at(r, "canvas.ts", 17)).toMatchObject({ host: "fal.run", pathTemplate: "/{app_id}/stream" });
    expect(at(r, "canvas.ts", 19)).toMatchObject({ method: "POST", host: "rest.fal.ai", pathTemplate: "/storage/upload/initiate" });
    expect(at(r, "canvas.ts", 23)).toMatchObject({ host: "fal.run", model: { values: [], dynamic: true } });
    expect(r.calls.some((c) => c.location.line === 25)).toBe(false);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["@fal-ai/client", "ok"]]);
  });

  it("@fal-ai/serverless-client: the namespace import, the same requests", async () => {
    const r = await scanFixture("sdk/fal-serverless");
    expect(at(r, "legacy.ts", 5)).toMatchObject({ provider: "fal", host: "fal.run", pathTemplate: "/{app_id}", model: { values: ["fal-ai/fast-sdxl"] } });
    expect(at(r, "legacy.ts", 7)).toMatchObject({ host: "queue.fal.run", pathTemplate: "/{app_id}" });
    expect(at(r, "legacy.ts", 9)).toMatchObject({ method: "GET", pathTemplate: status });
    expect(at(r, "legacy.ts", 11)).toMatchObject({ host: "rest.alpha.fal.ai", pathTemplate: "/storage/upload/initiate" });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["@fal-ai/serverless-client", "ok"]]);
  });
});

describe("SendGrid", () => {
  const prop = (c: Call, ...path: string[]): unknown => path.reduce<unknown>((s, k) => (k === "[]" ? (s as { items?: unknown })?.items : (s as { properties?: Record<string, unknown> })?.properties?.[k]), c.body);

  it("sendgrid (PyPI): send(Mail(...)) as the dict Mail.get() gives, the fluent client's path from its attributes", async () => {
    const r = await scanFixture("python/sdk/sendgrid");
    expect(at(r, "mailer.py", 19)).toMatchObject({ provider: "sendgrid", method: "POST", host: "api.sendgrid.com", pathTemplate: "/v3/mail/send", authScheme: "bearer" });
    // the helper's constructor and the attributes set on it afterwards
    expect(keys(at(r, "mailer.py", 19))).toEqual(["content", "from", "personalizations", "subject", "template_id"]);
    expect(Object.keys((prop(at(r, "mailer.py", 19), "personalizations", "[]") as { properties: object }).properties)).toEqual(["to", "dynamic_template_data"]);
    expect(prop(at(r, "mailer.py", 19), "personalizations", "[]", "to", "[]", "email")).toMatchObject({ hint: "address" });
    expect(prop(at(r, "mailer.py", 24), "from")).toMatchObject({ properties: { email: { enum: ["digest@lumen-notes.test"] }, name: { enum: ["Lumen Digest"] } } });
    expect(prop(at(r, "mailer.py", 24), "content", "[]", "type")).toMatchObject({ enum: ["text/plain"] });
    // a dict is sent as it is
    expect(keys(at(r, "mailer.py", 29))).toEqual(["content", "from", "personalizations", "subject"]);
    expect(at(r, "mailer.py", 33)).toMatchObject({ method: "GET", pathTemplate: "/v3/templates", query: ["generations", "page_size"] });
    expect(at(r, "mailer.py", 37)).toMatchObject({ method: "PUT", pathTemplate: "/v3/marketing/contacts" });
    expect(keys(at(r, "mailer.py", 37))).toEqual(["contacts", "list_ids"]);
    expect(at(r, "mailer.py", 41)).toMatchObject({ method: "POST", pathTemplate: "/v3/contactdb/recipients" });
    // `_(x)` is a segment of its own
    expect(at(r, "mailer.py", 45)).toMatchObject({ method: "DELETE", pathTemplate: "/v3/suppression/bounces/{address}" });
    expect(at(r, "mailer.py", 49)).toMatchObject({ method: "GET", pathTemplate: "/v3/templates/{template_id}/versions" });
    // the `host` argument replaces the host, `/v3` stays
    expect(at(r, "mailer.py", 56)).toMatchObject({ method: "POST", host: "api.eu.sendgrid.com", pathTemplate: "/v3/asm/groups/{group_id}/suppressions" });
    expect(keys(at(r, "mailer.py", 56))).toEqual(["recipient_emails"]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["sendgrid", "ok"]]);
  });

  it("@sendgrid/mail: the body Mail.create(data).toJSON() sends; @sendgrid/client: request({ method, url, body, qs })", async () => {
    const r = await scanFixture("sdk/sendgrid");
    expect(at(r, "notify.ts", 6)).toMatchObject({ provider: "sendgrid", method: "POST", host: "api.sendgrid.com", pathTemplate: "/v3/mail/send", authScheme: "bearer", sdk: { package: "@sendgrid/mail" } });
    // camelCase keys in snake case, `to` and the template data in a personalization; the data's own keys as written
    expect(keys(at(r, "notify.ts", 6))).toEqual(["from", "personalizations", "template_id"]);
    expect(Object.keys((prop(at(r, "notify.ts", 6), "personalizations", "[]") as { properties: object }).properties)).toEqual(["to", "dynamic_template_data"]);
    expect(prop(at(r, "notify.ts", 6), "personalizations", "[]", "dynamic_template_data")).toMatchObject({ properties: { firstName: { type: "string" } } });
    // `text` / `html` are the content; `isMultiple` is no body key
    expect(keys(at(r, "notify.ts", 11))).toEqual(["content", "from", "personalizations", "subject"]);
    expect(prop(at(r, "notify.ts", 11), "from")).toMatchObject({ properties: { email: { enum: ["billing@harbor-tide.test"] } } });
    expect(keys(at(r, "notify.ts", 15))).toEqual(["content", "from", "mail_settings", "personalizations", "subject"]);
    // an array is one request per item
    expect(keys(at(r, "notify.ts", 22))).toEqual(["content", "from", "personalizations", "subject"]);
    expect(prop(at(r, "legacy.js", 6), "attachments", "[]")).toMatchObject({ properties: { content_id: { enum: ["weekly"] } } });
    expect(at(r, "contacts.ts", 6)).toMatchObject({ method: "PUT", pathTemplate: "/v3/marketing/contacts", sdk: { package: "@sendgrid/client" } });
    expect(keys(at(r, "contacts.ts", 6))).toEqual(["contacts", "list_ids"]);
    expect(at(r, "contacts.ts", 10)).toMatchObject({ method: "GET", pathTemplate: "/v3/templates", query: ["generations", "page_size"] });
    expect(at(r, "contacts.ts", 14)).toMatchObject({ method: "DELETE", pathTemplate: "/v3/suppression/bounces/{address}" });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["@sendgrid/client", "ok"], ["@sendgrid/mail", "ok"]]);
  });
});

describe("Slack Bolt", () => {
  it("slack-bolt (PyPI): the app's WebClient, listener arguments injected by name, the async app", async () => {
    const r = await scanFixture("python/sdk/slack-bolt");
    // `app.client` is slack-sdk's WebClient: the same request, under slack-bolt
    expect(at(r, "standup_bot.py", 14)).toMatchObject({ provider: "slack", method: "POST", host: "slack.com", pathTemplate: "/api/chat.postMessage", bodyEncoding: "json", authScheme: "bearer", sdk: { package: "slack-bolt", chain: "client.chat_postMessage" } });
    expect(keys(at(r, "standup_bot.py", 14))).toEqual(["channel", "text"]);
    // a listener's `client`; `ack()` answers Slack's request and is no call
    expect(at(r, "standup_bot.py", 20)).toMatchObject({ pathTemplate: "/api/reactions.add", bodyEncoding: "form" });
    expect(keys(at(r, "standup_bot.py", 20))).toEqual(["channel", "name", "timestamp"]);
    // `say(text)` posts to the event's channel, which the code does not give
    expect(at(r, "standup_bot.py", 21)).toMatchObject({ pathTemplate: "/api/chat.postMessage", operationId: "chat_postMessage", sdk: { chain: "say" } });
    expect(keys(at(r, "standup_bot.py", 21))).toEqual(["text"]);
    expect(keys(at(r, "standup_bot.py", 26))).toEqual(["text", "thread_ts"]);
    // `respond` posts to the request's response_url: Slack's hooks host, a path the code never holds
    expect(at(r, "standup_bot.py", 32)).toMatchObject({ host: "hooks.slack.com", pathTemplate: "/{response_url}", authScheme: "none", sdk: { chain: "respond" } });
    expect(keys(at(r, "standup_bot.py", 32))).toEqual(["response_type", "text"]);
    expect(at(r, "standup_bot.py", 38)).toMatchObject({ pathTemplate: "/api/views.open" });
    // `context.client` and `context["client"]`
    expect(at(r, "standup_bot.py", 44)).toMatchObject({ pathTemplate: "/api/chat.postEphemeral" });
    expect(at(r, "standup_bot.py", 50)).toMatchObject({ pathTemplate: "/api/users.info" });
    expect(r.calls.filter((c) => c.location.file === "async_digest.py").map((c) => [c.location.line, c.pathTemplate])).toEqual([
      [9, "/api/conversations.info"],
      [10, "/api/chat.postMessage"],
      [14, "/api/chat.scheduleMessage"],
    ]);
    // an app handed to a registering function as `app: App`
    expect(at(r, "listeners.py", 8)).toMatchObject({ pathTemplate: "/api/chat.update", sdk: { package: "slack-bolt" } });
    // a decorated function of another library keeps its `client` / `say` parameters unknown; socket mode is no call
    expect(r.calls.filter((c) => c.location.file === "unrelated.py").map((c) => c.host)).toEqual(["status.example-uptime.dev"]);
    expect(r.calls.filter((c) => c.provider === "slack")).toHaveLength(12);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["slack-bolt", "ok"]]);
  });
});

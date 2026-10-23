import type { IrMethodSpec, IrRegistryEntry } from "../../src/lang/ir/language.js";
import { BOT_API, PATH } from "./methods.js";
import { GENERATED } from "./python.js";

type Entry = IrRegistryEntry & { $comment?: string };

/** Bot API methods go-telegram/bot has no method for: `getUpdates` runs inside `b.Start`, the rest were renamed. */
const ABSENT = new Set(["getUpdates", "kickChatMember", "getChatMembersCount"]);
/** Go names that are not the Bot API's with a capital. */
const GO_NAMES: Record<string, string> = { logOut: "Logout" };
/** Methods taking a context only: no params struct, and the library sends no body. */
const NO_PARAMS = new Set(["getWebhookInfo", "getMe", "logOut", "close", "getForumTopicIconStickers", "getMyStarBalance", "getAvailableGifts"]);
/** Where the library sends a method other than its own (v1.27: `GetMyDefaultAdministratorRights` posts to `set...`). */
const SENT_AS: Record<string, string> = { getMyDefaultAdministratorRights: "setMyDefaultAdministratorRights" };

function goSpec(api: string): IrMethodSpec {
  const path = PATH(SENT_AS[api] ?? api);
  return NO_PARAMS.has(api) ? { method: "POST", path } : { method: "POST", path, bodyArg: 1, encoding: "multipart" };
}

/** go-telegram/bot: `b.SendMessage(ctx, &bot.SendMessageParams{...})`, the params struct as a multipart form. */
export function goTelegramBot(): Entry {
  const methods: Record<string, IrMethodSpec> = {};
  for (const api of Object.keys(BOT_API)) {
    if (!ABSENT.has(api)) methods[GO_NAMES[api] ?? `${api[0]!.toUpperCase()}${api.slice(1)}`] = goSpec(api);
  }
  return {
    $comment:
      "go-telegram/bot: `b, _ := bot.New(token, opts...)`, then `b.SendMessage(ctx, &bot.SendMessageParams{ChatID: id, Text: t})`, also on the `*bot.Bot` a handler is given. Every method posts its params struct as a multipart form (its `json` tags, the Go names in snake case), a method without params no body; `bot.WithServerURL(u)` replaces `https://api.telegram.org`.",
    package: "github.com/go-telegram/bot",
    imports: ["github.com/go-telegram/bot"],
    provider: "telegram",
    host: "api.telegram.org",
    auth: "apikey",
    generatedFrom: GENERATED,
    instance: { names: ["New", "Bot"], urlArg: { New: "kw:WithServerURL" } },
    methods,
  };
}

use serenity::async_trait;
use serenity::model::channel::Message;
use serenity::prelude::*;
use teloxide::prelude::*;

pub async fn alert(chat: ChatId, text: String) -> ResponseResult<()> {
    let bot = Bot::new(std::env::var("ALERT_BOT_TOKEN").unwrap());
    bot.send_message(chat, text).await?;
    Ok(())
}

pub async fn run() {
    let bot = Bot::from_env();
    teloxide::repl(bot, |bot: Bot, msg: teloxide::types::Message| async move {
        bot.send_dice(msg.chat.id).await?;
        Ok(())
    })
    .await;
}

struct Handler;

#[async_trait]
impl EventHandler for Handler {
    async fn message(&self, ctx: Context, msg: Message) {
        if msg.content == "!ping" {
            let _ = msg.channel_id.say(&ctx.http, "Pong!").await;
        }
        if msg.content == "!help" {
            let _ = msg.reply(&ctx, "Commands: !ping").await;
        }
    }
}

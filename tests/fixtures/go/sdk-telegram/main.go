package main

import (
	"context"
	"os"
	"os/signal"

	"github.com/go-telegram/bot"
	"github.com/go-telegram/bot/models"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	b, err := bot.New(os.Getenv("FERRY_BOT_TOKEN"), bot.WithDefaultHandler(onUpdate))
	if err != nil {
		panic(err)
	}
	b.RegisterHandler(bot.HandlerTypeCallbackQueryData, "dock", bot.MatchTypePrefix, onDock)
	me, _ := b.GetMe(ctx)
	_ = me
	b.SetWebhook(ctx, &bot.SetWebhookParams{URL: os.Getenv("FERRY_WEBHOOK_URL"), SecretToken: "harbor"})
	b.Start(ctx)
}

func onUpdate(ctx context.Context, b *bot.Bot, update *models.Update) {
	if update.Message == nil {
		return
	}
	b.SendMessage(ctx, &bot.SendMessageParams{
		ChatID:    update.Message.Chat.ID,
		Text:      "<b>Next ferry</b> at 10:40",
		ParseMode: models.ParseModeHTML,
	})
}

func onDock(ctx context.Context, b *bot.Bot, update *models.Update) {
	b.AnswerCallbackQuery(ctx, &bot.AnswerCallbackQueryParams{CallbackQueryID: update.CallbackQuery.ID, Text: "Docked"})
	b.DeleteMessages(ctx, &bot.DeleteMessagesParams{ChatID: update.CallbackQuery.From.ID, MessageIDs: []int{1, 2}})
}

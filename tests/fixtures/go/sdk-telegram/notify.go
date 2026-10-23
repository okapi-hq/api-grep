package main

import (
	"bytes"
	"context"
	"os"

	"github.com/go-telegram/bot"
	"github.com/go-telegram/bot/models"
)

// Notifier posts timetable changes through a local Bot API server.
type Notifier struct {
	tg     *bot.Bot
	chatID int64
}

func NewNotifier(chatID int64) (*Notifier, error) {
	tg, err := bot.New(os.Getenv("FERRY_BOT_TOKEN"), bot.WithServerURL(os.Getenv("BOT_API_SERVER")))
	if err != nil {
		return nil, err
	}
	return &Notifier{tg: tg, chatID: chatID}, nil
}

func (n *Notifier) Timetable(ctx context.Context, pdf []byte) error {
	_, err := n.tg.SendDocument(ctx, &bot.SendDocumentParams{
		ChatID:   n.chatID,
		Document: &models.InputFileUpload{Filename: "timetable.pdf", Data: bytes.NewReader(pdf)},
		Caption:  "Winter timetable",
	})
	return err
}

package main

import (
	"context"
	"log"
	"os"

	"github.com/example-org/helpdesk/internal/llm"
	tg "github.com/example-org/helpdesk/internal/telegram"
)

func main() {
	ctx := context.Background()
	groq := llm.New(os.Getenv("GROQ_API_KEY"))
	answer, err := groq.Ask(ctx, "Summarize the ticket")
	if err != nil {
		log.Fatal(err)
	}
	bot := tg.Bot{Token: os.Getenv("TELEGRAM_TOKEN")}
	if err := bot.Send(42, answer); err != nil {
		log.Fatal(err)
	}
	llm.Moderate(ctx, answer)
}

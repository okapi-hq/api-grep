package opsbot

import (
	"context"
	"errors"
	"os"

	"github.com/getsentry/sentry-go"
	"github.com/slack-go/slack"
)

type Notifier struct {
	api     *slack.Client
	channel string
}

func NewNotifier() *Notifier {
	return &Notifier{api: slack.New(os.Getenv("SLACK_BOT_TOKEN")), channel: "C0OPS"}
}

func (n *Notifier) Alert(ctx context.Context, text string) error {
	_, _, err := n.api.PostMessageContext(ctx, n.channel, slack.MsgOptionText(text, false))
	if err != nil {
		sentry.CaptureException(err)
	}
	return err
}

func (n *Notifier) Resolve(ctx context.Context, ts string) error {
	_, _, _, err := n.api.UpdateMessageContext(ctx, n.channel, ts, slack.MsgOptionText("resolved", false))
	return err
}

func (n *Notifier) Who(userID string) (string, error) {
	user, err := n.api.GetUserInfo(userID)
	if err != nil {
		return "", err
	}
	return user.RealName, nil
}

func Webhook(text string) error {
	return slack.PostWebhook(os.Getenv("SLACK_WEBHOOK_URL"), &slack.WebhookMessage{Text: text})
}

func Report(ctx context.Context) {
	if hub := sentry.GetHubFromContext(ctx); hub != nil {
		hub.CaptureMessage("deploy finished")
	}
	sentry.CaptureException(errors.New("unreachable"))
}

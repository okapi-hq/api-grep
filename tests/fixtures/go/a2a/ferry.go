package ferryman

import (
	"context"
	"net/http"

	"github.com/a2aproject/a2a-go/v2/a2a"
	"github.com/a2aproject/a2a-go/v2/a2aclient"
	"github.com/a2aproject/a2a-go/v2/a2aclient/agentcard"
)

const scheduleAgent = "https://schedule.ferry-row.dev"

func Book(ctx context.Context, req *a2a.SendMessageRequest) (a2a.SendMessageResult, error) {
	card, err := agentcard.DefaultResolver.Resolve(ctx, scheduleAgent)
	if err != nil {
		return nil, err
	}
	client, err := a2aclient.NewFromCard(ctx, card)
	if err != nil {
		return nil, err
	}
	return client.SendMessage(ctx, req)
}

func Tickets(ctx context.Context, httpClient *http.Client) (*a2a.Task, error) {
	resolver := agentcard.NewResolver(httpClient)
	card, err := resolver.Resolve(ctx, "https://tickets.ferry-row.dev")
	if err != nil {
		return nil, err
	}
	client, err := a2aclient.NewFromCard(ctx, card)
	if err != nil {
		return nil, err
	}
	return client.GetTask(ctx, &a2a.GetTaskRequest{ID: "t-9"})
}

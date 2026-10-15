package assistant

import (
	"context"
	"os"

	openai "github.com/sashabaranov/go-openai"
)

type Bot struct {
	client *openai.Client
	model  string
}

func NewBot() *Bot {
	return &Bot{client: openai.NewClient(os.Getenv("OPENAI_API_KEY")), model: openai.GPT4oMini}
}

func (b *Bot) Reply(ctx context.Context, text string) (string, error) {
	resp, err := b.client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:     b.model,
		MaxTokens: 256,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: "Be brief."},
			{Role: openai.ChatMessageRoleUser, Content: text},
		},
	})
	if err != nil {
		return "", err
	}
	return resp.Choices[0].Message.Content, nil
}

func Embed(ctx context.Context, input string) error {
	client := openai.NewClient(os.Getenv("OPENAI_API_KEY"))
	_, err := client.CreateEmbeddings(ctx, openai.EmbeddingRequest{Input: []string{input}, Model: openai.SmallEmbedding3})
	return err
}

func DeepSeek(ctx context.Context, text string) error {
	cfg := openai.DefaultConfig(os.Getenv("DEEPSEEK_API_KEY"))
	cfg.BaseURL = "https://api.deepseek.com/v1"
	client := openai.NewClientWithConfig(cfg)
	req := openai.ChatCompletionRequest{Model: "deepseek-chat", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: text}}}
	req.Stream = true
	_, err := client.CreateChatCompletionStream(ctx, req)
	return err
}

func OpenRouter(ctx context.Context) error {
	cfg := openai.DefaultConfig(os.Getenv("OPENROUTER_API_KEY"))
	cfg.BaseURL = os.Getenv("OPENROUTER_BASE_URL")
	_, err := openai.NewClientWithConfig(cfg).CreateChatCompletion(ctx, openai.ChatCompletionRequest{Model: "openai/gpt-4o"})
	return err
}

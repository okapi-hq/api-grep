package assistant

import (
	"context"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"google.golang.org/genai"
)

func Official(ctx context.Context, prompt string) error {
	client := openai.NewClient(option.WithAPIKey(os.Getenv("OPENAI_API_KEY")))
	_, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model:     openai.ChatModelGPT4o,
		MaxTokens: openai.Int(512),
		Messages:  []openai.ChatCompletionMessageParamUnion{openai.SystemMessage("Answer in French."), openai.UserMessage(prompt)},
	})
	return err
}

func XAI(ctx context.Context) error {
	client := openai.NewClient(option.WithBaseURL("https://api.x.ai/v1"), option.WithAPIKey(os.Getenv("XAI_API_KEY")))
	_, err := client.Responses.New(ctx, map[string]any{"model": "grok-4"})
	return err
}

func Claude(ctx context.Context, prompt string) error {
	client := anthropic.NewClient()
	_, err := client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_5,
		MaxTokens: 1024,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(prompt))},
	})
	return err
}

func Gemini(ctx context.Context, prompt string) error {
	client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: os.Getenv("GEMINI_API_KEY"), Backend: genai.BackendGeminiAPI})
	if err != nil {
		return err
	}
	_, err = client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text(prompt), nil)
	if err != nil {
		return err
	}
	chat, _ := client.Chats.Create(ctx, "gemini-2.5-pro", nil, nil)
	_, err = chat.SendMessage(ctx, genai.Part{Text: prompt})
	return err
}

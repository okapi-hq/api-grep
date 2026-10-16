package llmproxy

import (
	"bytes"
	"context"
	"net/http"

	openai "github.com/sashabaranov/go-openai"
)

var baseURLs = map[string]string{
	"groq":     "https://api.groq.com/openai/v1",
	"deepseek": "https://api.deepseek.com/v1",
}

func endpointFor(name string) string {
	switch name {
	case "fireworks":
		return "https://api.fireworks.ai/inference/v1"
	case "together":
		return "https://api.together.xyz/v1"
	default:
		return "https://api.openai.com/v1"
	}
}

func Relay(name string, body []byte) (*http.Response, error) {
	return http.Post(baseURLs[name]+"/chat/completions", "application/json", bytes.NewReader(body))
}

func Models(name string) (*http.Response, error) {
	return http.Get(endpointFor(name) + "/models")
}

func Ask(ctx context.Context, name, key, text string) error {
	config := openai.DefaultConfig(key)
	config.BaseURL = baseURLs[name]
	client := openai.NewClientWithConfig(config)
	_, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{Model: "any-model", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: text}}})
	return err
}

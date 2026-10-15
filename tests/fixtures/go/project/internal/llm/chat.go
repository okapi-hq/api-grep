package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"

	"github.com/example-org/helpdesk/internal/config"
	openai "github.com/sashabaranov/go-openai"
)

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func (c *Client) post(ctx context.Context, path string, body any) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	return c.http.Do(req)
}

func (c *Client) Ask(ctx context.Context, prompt string) (string, error) {
	resp, err := c.post(ctx, "/chat/completions", chatRequest{Model: config.Model, Messages: []chatMessage{{Role: "user", Content: prompt}}})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		Choices []struct {
			Message chatMessage `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || len(out.Choices) == 0 {
		return "", err
	}
	return out.Choices[0].Message.Content, nil
}

// Moderate goes through OpenAI itself.
func Moderate(ctx context.Context, text string) error {
	_, err := openai.NewClient("").Moderations(ctx, openai.ModerationRequest{Input: text, Model: openai.ModerationOmniLatest})
	return err
}

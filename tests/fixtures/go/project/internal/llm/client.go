package llm

import (
	"net/http"

	"github.com/example-org/helpdesk/internal/config"
)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(apiKey string) *Client {
	return &Client{baseURL: config.GroqBase, apiKey: apiKey, http: &http.Client{}}
}

package main

import (
	"net/http"

	"github.com/a2aproject/a2a-go/v2/a2asrv"
)

func main() {
	handler := a2asrv.NewHandler(nil)
	http.Handle("/a2a", a2asrv.NewJSONRPCHandler(handler))
	http.Handle("/.well-known/agent-card.json", a2asrv.NewStaticAgentCardHandler(nil))
	_ = http.ListenAndServe(":8080", nil)
}

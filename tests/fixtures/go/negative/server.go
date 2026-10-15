package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
)

type cache struct{ items map[string]string }

func (c *cache) Get(key string) string { return c.items[key] }

func handler(w http.ResponseWriter, r *http.Request) {
	page := r.URL.Query().Get("page")
	auth := r.Header.Get("Authorization")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"page": page, "auth": auth})
}

func Serve() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/items", handler)
	http.Handle("/static/", http.FileServer(http.Dir("public")))
	return http.ListenAndServe(":8080", mux)
}

func Parse(raw string) string {
	u, _ := url.Parse("https://api.example.com/v1?x=1")
	c := &cache{}
	_ = httptest.NewRecorder()
	return strings.TrimSpace(u.Query().Get("x") + c.Get(raw))
}

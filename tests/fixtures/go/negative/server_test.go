package server

import "net/http"

func probe() { http.Get("https://api.github.com/meta") }

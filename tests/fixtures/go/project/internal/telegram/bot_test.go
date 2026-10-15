package telegram

import "net/http"

func ping() { http.Get("https://api.telegram.org/botTEST/getMe") }

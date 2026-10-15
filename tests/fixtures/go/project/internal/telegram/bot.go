package telegram

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

type Bot struct {
	Token string
}

func (b Bot) Send(chatID int64, text string) error {
	endpoint := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", b.Token)
	_, err := http.PostForm(endpoint, url.Values{"chat_id": {strconv.FormatInt(chatID, 10)}, "text": {text}})
	return err
}

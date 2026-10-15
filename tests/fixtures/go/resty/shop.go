package shop

import (
	"os"

	"github.com/go-resty/resty/v2"
)

type order struct {
	Amount   int    `json:"amount"`
	Currency string `json:"currency"`
}

var api = resty.New().SetBaseURL("https://api.lemonsqueezy.com/v1").SetAuthToken(os.Getenv("LS_KEY"))

func Products() error {
	_, err := api.R().SetQueryParam("page[size]", "50").Get("/products")
	return err
}

func Charge(amount int) error {
	_, err := resty.New().R().
		SetHeader("Content-Type", "application/json").
		SetBody(order{Amount: amount, Currency: "usd"}).
		Post("https://api.paddle.com/transactions")
	return err
}

func Forget(id string) error {
	client := resty.New()
	_, err := client.R().SetBasicAuth("key", os.Getenv("MAILCHIMP_KEY")).Delete("https://us1.api.mailchimp.com/3.0/lists/" + id)
	return err
}

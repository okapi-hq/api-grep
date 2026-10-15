package notifier

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
)

const slackHook = "https://hooks.slack.com/services/T000/B000/XXXX"

type alert struct {
	Text    string `json:"text"`
	Channel string `json:"channel,omitempty"`
	secret  string
}

func Status() (*http.Response, error) {
	return http.Get("https://www.githubstatus.com/api/v2/status.json")
}

func Slack(text string) error {
	data, _ := json.Marshal(alert{Text: text, Channel: "#ops"})
	_, err := http.Post(slackHook, "application/json", bytes.NewBuffer(data))
	return err
}

func Twilio(sid, to, body string) error {
	form := url.Values{"To": {to}, "Body": {body}}
	_, err := http.PostForm(fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", sid), form)
	return err
}

func PagerDuty(ctx context.Context, summary string) error {
	payload := map[string]any{"routing_key": os.Getenv("PD_KEY"), "event_action": "trigger"}
	payload["payload"] = map[string]string{"summary": summary}
	data, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://events.pagerduty.com/v2/enqueue", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	_, err = http.DefaultClient.Do(req)
	return err
}

func Weather(lat, lon string) error {
	req, _ := http.NewRequest("GET", "https://api.open-meteo.com/v1/forecast", nil)
	q := req.URL.Query()
	q.Set("latitude", lat)
	q.Add("longitude", lon)
	req.URL.RawQuery = q.Encode()
	client := &http.Client{}
	_, err := client.Do(req)
	return err
}

func Mailgun(domain, to string) error {
	base := os.Getenv("MAILGUN_API_BASE")
	form := url.Values{}
	form.Set("to", to)
	req, _ := http.NewRequest(http.MethodPost, base+"/v3/"+domain+"/messages", strings.NewReader(form.Encode()))
	req.SetBasicAuth("api", os.Getenv("MAILGUN_KEY"))
	req.Header.Add("Content-Type", "application/x-www-form-urlencoded")
	_, err := http.DefaultClient.Do(req)
	return err
}

func Head() {
	http.Head("https://api.github.com/zen")
}

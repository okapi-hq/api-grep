package notifier

import (
	retryablehttp "github.com/hashicorp/go-retryablehttp"
)

// Sentry's store endpoint through a retrying client; this file ends without a newline
func Report(dsnHost string, event []byte) error {
	req, err := retryablehttp.NewRequest("POST", "https://sentry.io/api/42/store/", event)
	if err != nil {
		return err
	}
	req.Header.Set("X-Sentry-Auth", "Sentry sentry_version=7")
	_, err = retryablehttp.NewClient().Do(req)
	return err
}
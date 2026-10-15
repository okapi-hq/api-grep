package notifier

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
)

// Linear's GraphQL endpoint, a package-level variable read by another file of the package
var linearURL = "https://api.linear.app/graphql"

type Linear struct {
	token string
	http  *http.Client
}

func NewLinear() *Linear {
	return &Linear{token: os.Getenv("LINEAR_TOKEN"), http: &http.Client{}}
}

func (l *Linear) Query(doc string) error {
	data, _ := json.Marshal(map[string]string{"query": doc})
	req, _ := http.NewRequest("POST", linearURL, bytes.NewBuffer(data))
	req.Header.Set("Authorization", "Bearer "+l.token)
	_, err := l.http.Do(req)
	return err
}

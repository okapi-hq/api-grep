# Mail and storage calls: basic auth, multipart form, upload
curl -s --user "api:${MAILGUN_API_KEY}" \
  "https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages" \
  -F from='Reports <reports@example.org>' \
  -F to="$RECIPIENT" \
  -F subject='Nightly report' \
  -F attachment=@report.pdf

curl -T report.pdf "https://storage.example.org/reports/$(date +%F).pdf"

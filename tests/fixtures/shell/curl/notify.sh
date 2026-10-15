#!/usr/bin/env bash
# Sends the nightly report to the team's chat channels.
set -euo pipefail

TELEGRAM_API="https://api.telegram.org"
readonly DISCORD_URL="https://discord.com/api/webhooks/${DISCORD_WEBHOOK_ID}/${DISCORD_WEBHOOK_TOKEN}"
MESSAGE="Nightly report is ready"

curl -s -X POST "${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d text="$MESSAGE" \
  -d parse_mode=Markdown

curl -fsS -H 'Content-Type: application/json' \
  -d '{"content": "'"$MESSAGE"'", "username": "report-bot", "tts": false}' \
  "$DISCORD_URL"

status=$(curl -s -o /dev/null -w '%{http_code}' --json '{"text": "ping"}' "$SLACK_WEBHOOK_URL")
echo "slack answered $status"

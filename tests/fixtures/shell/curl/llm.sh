#!/bin/sh
MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
ANTHROPIC_BASE="${ANTHROPIC_BASE_URL:-https://api.anthropic.com}"

answer=`curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "'"$MODEL"'",
    "messages": [{"role": "user", "content": "'"$1"'"}],
    "temperature": 0.2
  }'`

curl "$ANTHROPIC_BASE/v1/messages" \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --json @request.json

curl -XPOST http://localhost:11434/api/generate -d '{"model": "llama3", "prompt": "hi"}'
curl --request GET --url "http://127.0.0.1:8080/health"

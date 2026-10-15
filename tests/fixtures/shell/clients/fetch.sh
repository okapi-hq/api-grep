#!/bin/sh
# wget and HTTPie, the other HTTP clients scripts call

wget -qO- --header="Authorization: token ${GITHUB_TOKEN}" https://api.github.com/user/repos

wget --post-data "token=${PUSHOVER_TOKEN}&user=${PUSHOVER_USER}&message=deployed" \
  -O /dev/null https://api.pushover.net/1/messages.json

wget --method=DELETE --header "X-Auth-Email: ops@example.org" "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache"

http POST https://api.linear.app/graphql Authorization:"$LINEAR_API_KEY" query='{ viewer { id } }'

https --form api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json To="$TO" From="$FROM" Body=hello -a "$TWILIO_SID:$TWILIO_TOKEN"

http :3000/health

http PATCH api.example.org/v1/items/42 count:=3 tags:='["a","b"]' search==widgets

#!/bin/bash
# Release helper for the widgets repository.

REPO="acme/widgets"

gh_api() {
  local path="$1"
  shift
  curl -sSf \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/${path}" "$@"
}

latest=$(gh_api "repos/${REPO}/releases/latest" | jq -r .tag_name)
gh_api "repos/${REPO}/issues" -X POST -d '{"title": "Release '"$latest"' is out", "labels": ["release"]}'
gh_api "repos/${REPO}/issues" -G --data-urlencode "state=open" -d per_page=50

curl -I https://api.github.com/zen

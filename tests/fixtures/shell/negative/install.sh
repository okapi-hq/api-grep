#!/usr/bin/env bash
# curl https://example.org/in-a-comment
echo "curl https://api.example.org/echoed"
printf 'run: curl -X POST %s\n' "https://api.example.org/printed"
MSG="wget https://api.example.org/in-a-string"
alias fetchit='curl https://api.example.org/aliased'

cat <<EOT
curl https://api.example.org/heredoc
EOT

if ! command -v curl >/dev/null; then
  apt-get install -y curl wget httpie
fi
curl --version
type wget
man http

forward() {
  curl --silent "$@"
}

http() {
  python3 -m http.server "$1"
}
http 8000

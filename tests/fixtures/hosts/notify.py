import courier
import requests

PROJECT_URL = "https://acme-demo.supabase.co"


def summarize(text, key):
    """Summarizes a note; see https://api.slack.com/methods for the format."""
    # https://api.github.com/v3/gists is a comment
    r = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": text}]},
    )
    return r.json()


def save(project, note):
    return requests.post(f"https://{project}.supabase.co/rest/v1/notes", json=note)


def mail(to):
    # a client api-grep does not know: its call is missed, its host named
    return courier.send("https://api.mailgun.net/v3/mg.acme.dev/messages", to=to, docs="https://www.mailgun.com/pricing")

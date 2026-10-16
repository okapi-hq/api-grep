import os

from github import Auth, Github

gh = Github(auth=Auth.Token(os.environ["BOT_TOKEN"]))


def open_ticket(title: str, body: str):
    repo = gh.get_repo("acme/widgets")
    return repo.create_issue(title=title, body=body, labels=["triage"])


def thank(number: int) -> None:
    issue = gh.get_repo("acme/widgets").get_issue(number)
    issue.create_comment("Thanks for the report!")


def changelog(ref: str) -> str:
    return gh.get_repo("acme/widgets").get_contents("CHANGELOG.md", ref=ref).decoded_content.decode()


def open_pulls():
    return [p.title for p in gh.get_repo("acme/widgets").get_pulls(state="open")]


def me():
    return gh.get_user().login

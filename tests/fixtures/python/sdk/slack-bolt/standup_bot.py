"""A stand-up reminder bot: Web API calls through the app's client and listener helpers."""
import os
import re

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

app = App(token=os.environ["STANDUP_BOT_TOKEN"])

DIGEST_CHANNEL = "C0STANDUP"


def post_digest(summary):
    return app.client.chat_postMessage(channel=DIGEST_CHANNEL, text=summary)


@app.event("app_mention")
def on_mention(event, say, client, ack):
    ack()
    client.reactions_add(channel=event["channel"], name="eyes", timestamp=event["ts"])
    say("On it, collecting today's notes")


@app.message(re.compile("^standup"))
def on_standup(message, say):
    say(text="Thanks, noted", thread_ts=message["ts"])


@app.command("/standup")
def on_command(ack, respond, command):
    ack()
    respond(text="Your stand-up is saved", response_type="ephemeral")


@app.action("open_notes")
def on_open_notes(ack, body, client):
    ack()
    client.views_open(trigger_id=body["trigger_id"], view={"type": "modal", "title": {"type": "plain_text", "text": "Notes"}})


@app.view("notes_modal")
def on_notes_submitted(ack, view, context):
    ack()
    context.client.chat_postEphemeral(channel=DIGEST_CHANNEL, user=context.user_id, text="Notes saved")


@app.shortcut("standup_now")
def on_shortcut(ack, shortcut, context):
    ack()
    context["client"].users_info(user=shortcut["user"]["id"])


if __name__ == "__main__":
    SocketModeHandler(app, os.environ["STANDUP_APP_TOKEN"]).start()

"""Listeners registered on an app handed to a function, decorated inside it."""
from slack_bolt import App


def register_listeners(app: App):
    @app.event("reaction_added")
    def on_reaction(event, client):
        client.chat_update(channel=event["item"]["channel"], ts=event["item"]["ts"], text="Marked as done")

"""The async flavour of the same app."""
from slack_bolt.async_app import AsyncApp

digest_app = AsyncApp()


@digest_app.event("member_joined_channel")
async def greet(event, client, say):
    await client.conversations_info(channel=event["channel"])
    await say(text="Welcome to the stand-up channel")


async def nightly_reminder():
    await digest_app.client.chat_scheduleMessage(channel="C0STANDUP", post_at=1700000000, text="Stand-up in 10 minutes")

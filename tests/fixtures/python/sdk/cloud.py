import json

import boto3
import posthog
import resend
from posthog import Posthog
from slack_sdk import WebClient
from slack_sdk.webhook import WebhookClient
from twilio.rest import Client

s3 = boto3.client("s3")
bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
sqs = boto3.client("sqs")
twilio = Client("AC123", "token")
slack = WebClient(token="xoxb-placeholder")
hook = WebhookClient("https://hooks.slack.com/services/T000/B000/XXXX")
ph = Posthog("phc_placeholder", host="https://eu.i.posthog.com")


def store(key: str, body: bytes):
    return s3.put_object(Bucket="uploads", Key=key, Body=body)


def ask(prompt: str):
    return bedrock.invoke_model(modelId="anthropic.claude-3-haiku-20240307-v1:0", body=json.dumps({"prompt": prompt}))


def enqueue(msg: str):
    return sqs.send_message(QueueUrl="https://sqs.us-east-1.amazonaws.com/1/q", MessageBody=msg)


def sms(to: str):
    return twilio.messages.create(to=to, from_="+15550000000", body="Hello")


def verify(to: str):
    return twilio.verify.v2.services("VA123").verifications.create(to=to, channel="sms")


def post(channel: str, text: str):
    return slack.chat_postMessage(channel=channel, text=text)


def alert(text: str):
    return hook.send(text=text)


def email(to: str):
    return resend.Emails.send({"from": "app@example.com", "to": to, "subject": "Hi", "html": "<p>Hi</p>"})


def event(user: str):
    posthog.capture(user, "signed_up")
    ph.capture(distinct_id=user, event="paid")

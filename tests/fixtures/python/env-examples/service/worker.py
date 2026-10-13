import os

from anthropic import Anthropic

claude = Anthropic()


def answer(messages):
    return claude.messages.create(model=os.environ["CHAT_MODEL"], max_tokens=512, messages=messages)

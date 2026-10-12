import anthropic


class Responder:
    def __init__(self, client):
        self.client = client

    def answer(self, question):
        return self.client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=64,
            messages=[{"role": "user", "content": question}],
        )


def build():
    return Responder(anthropic.Anthropic())

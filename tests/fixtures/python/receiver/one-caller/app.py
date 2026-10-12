import anthropic


def ask(client, prompt):
    return client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=16,
        messages=[{"role": "user", "content": prompt}],
    )


def main():
    client = anthropic.Anthropic()
    print(ask(client, "hello"))

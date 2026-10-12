def classify(client, ticket):
    return client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=8,
        messages=[{"role": "user", "content": ticket}],
    )

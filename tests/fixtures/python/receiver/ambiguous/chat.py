def reply(client, prompt):
    return client.chat.completions.create(
        model="some-model",
        messages=[{"role": "user", "content": prompt}],
    )

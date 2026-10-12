from openai import OpenAI

client = OpenAI()


def complete(prompt, reasoning=False):
    kwargs = {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": prompt}]}
    if reasoning:
        kwargs["max_completion_tokens"] = 64
    else:
        kwargs["max_tokens"] = 64
        kwargs["temperature"] = 0.2
    return client.chat.completions.create(**kwargs)


def pick_model(prompt, fast):
    kwargs = {"messages": [{"role": "user", "content": prompt}]}
    if fast:
        kwargs["model"] = "gpt-4o-mini"
    else:
        kwargs["model"] = "o3"
    kwargs["n"] = 1
    return client.chat.completions.create(**kwargs)

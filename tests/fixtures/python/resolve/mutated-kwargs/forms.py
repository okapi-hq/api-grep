import requests
from openai import OpenAI

client = OpenAI()
DEFAULTS = {"temperature": 0.1, "top_p": 0.9}


def by_keywords(prompt):
    kwargs = {"messages": [{"role": "user", "content": prompt}]}
    kwargs.update(model="gpt-4o-mini", max_tokens=64)
    return client.chat.completions.create(**kwargs)


def by_dict(prompt):
    kwargs = dict(messages=[{"role": "user", "content": prompt}])
    kwargs.update({"model": "gpt-4.1", "seed": 7})
    kwargs.update(**DEFAULTS)
    return client.chat.completions.create(**kwargs)


def with_defaults(prompt, user=None):
    kwargs = {"model": "gpt-4.1-mini", "messages": [{"role": "user", "content": prompt}]}
    kwargs.setdefault("model", "ignored-model")
    kwargs.setdefault("max_tokens", 128)
    kwargs |= {"stream": False}
    if user:
        kwargs |= {"user": user}
    return client.chat.completions.create(**kwargs)


def without_keys(prompt, legacy):
    kwargs = {"model": "gpt-4o", "messages": [{"role": "user", "content": prompt}], "temperature": 0.3, "logprobs": True, "seed": 1}
    del kwargs["logprobs"]
    kwargs.pop("seed", None)
    if legacy:
        kwargs.pop("temperature")
    return client.chat.completions.create(**kwargs)


def forwarded(**kwargs):
    kwargs.setdefault("model", "gpt-4o-mini")
    return client.chat.completions.create(**kwargs)


def post_order(item_id, rush):
    payload = {"item": item_id}
    payload["quantity"] = 1
    if rush:
        payload["priority"] = "high"
    return requests.post("https://api.example-shop.com/v1/orders", json=payload)


def hostile_key(prompt):
    kwargs = {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": prompt}]}
    kwargs["__proto__"] = {"polluted": True}
    kwargs["constructor"] = 1
    return client.chat.completions.create(**kwargs)

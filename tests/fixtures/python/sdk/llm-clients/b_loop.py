from concurrent.futures import ThreadPoolExecutor

from openai import OpenAI

STRATEGIES = ["plain", "roleplay"]


def build_messages(strategy):
    return [{"role": "user", "content": strategy}]


def _test_query(client, model, messages, timeout=45):
    response = client.chat.completions.create(model=model, messages=messages, timeout=timeout)
    return response, 0, None


def probe(model=None, base_url=None, api_key=None):
    client = OpenAI(api_key=api_key, base_url=base_url)
    for strategy in STRATEGIES:
        content, latency, err = _test_query(client, model, build_messages(strategy))
    return content


def _ask_pool(client, model, messages):
    return client.chat.completions.create(model=model, messages=messages)


def probe_pool(model="gpt-4o-mini", base_url=None):
    client = OpenAI(base_url=base_url)
    with ThreadPoolExecutor() as ex:
        futures = [ex.submit(_ask_pool, client, model, build_messages(s)) for s in STRATEGIES]
    return futures

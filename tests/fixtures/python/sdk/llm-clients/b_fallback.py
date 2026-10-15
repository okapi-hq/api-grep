try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


def _test_query(client, model, messages, timeout=45):
    try:
        response = client.chat.completions.create(model=model, messages=messages, timeout=timeout)
        return response.choices[0].message.content, 0.0, None
    except Exception as e:
        return None, 0.0, str(e)


def auto_jailbreak(model=None, base_url=None, api_key=None, dry_run=False):
    if OpenAI is None:
        raise RuntimeError("pip install openai")
    client = OpenAI(api_key=api_key, base_url=base_url)
    for strategy in ["a", "b"]:
        content, latency, err = _test_query(client, model, [{"role": "user", "content": strategy}])
    return content

from openai import OpenAI


def translate(client, text):
    return client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": text}],
    )


def hosted(text):
    return translate(OpenAI(), text)


def fast(text):
    groq = OpenAI(base_url="https://api.groq.com/openai/v1")
    return translate(groq, text)

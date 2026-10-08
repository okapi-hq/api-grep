from openai import OpenAI

openai = OpenAI()


def ask(q: str):
    return openai.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": q}])

import instructor
import ollama
from openai import OpenAI

client = instructor.from_openai(OpenAI())


def extract(text, schema):
    return client.chat.completions.create(model="gpt-4o-mini", response_model=schema, messages=[{"role": "user", "content": text}])


def local_chat(prompt):
    return ollama.chat(model="llama3.2", messages=[{"role": "user", "content": prompt}])

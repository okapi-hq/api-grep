import os

import anthropic
import openai
from anthropic import AsyncAnthropic
from google import genai
from openai import AsyncOpenAI, OpenAI

client = OpenAI()
router = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=os.environ["OPENROUTER_KEY"])
claude = AsyncAnthropic()
gemini = genai.Client(api_key=os.environ["GEMINI_KEY"])


def chat(messages: list):
    return client.chat.completions.create(model="gpt-4o", messages=messages, temperature=0.2)


def embed(text: str):
    return openai.embeddings.create(model="text-embedding-3-small", input=text)


def routed(prompt: str):
    return router.chat.completions.with_raw_response.create(model="anthropic/claude-sonnet-4", messages=[{"role": "user", "content": prompt}])


def file_info(file_id: str):
    return client.files.retrieve(file_id)


async def summarize(text: str):
    return await claude.messages.create(model="claude-sonnet-4-5", max_tokens=1024, messages=[{"role": "user", "content": text}])


def legacy():
    return anthropic.Anthropic().messages.count_tokens(model="claude-sonnet-4-5", messages=[])


def gen(prompt: str):
    return gemini.models.generate_content(model="gemini-2.0-flash", contents=prompt)


class Assistant:
    def __init__(self, llm: AsyncOpenAI):
        self.llm = llm

    async def answer(self, q: str):
        return await self.llm.responses.create(model="gpt-4.1", input=q)

import asyncio
import functools

from clients import claude, gemini, openai_client


async def in_thread(prompt: str):
    return await asyncio.to_thread(claude.messages.create, model="claude-sonnet-4-5", max_tokens=256, messages=[{"role": "user", "content": prompt}])


async def gemini_in_thread(prompt: str):
    return await asyncio.to_thread(gemini.models.generate_content, model="gemini-2.5-flash", contents=prompt)


async def in_executor(prompt: str):
    loop = asyncio.get_running_loop()
    call = functools.partial(claude.messages.create, model="claude-haiku-4-5", max_tokens=64, messages=[{"role": "user", "content": prompt}])
    return await loop.run_in_executor(None, call)


async def in_executor_inline(prompt: str):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, functools.partial(openai_client.embeddings.create, model="text-embedding-3-small", input=prompt))


def with_timeout(prompt: str):
    return openai_client.with_options(timeout=20).chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": prompt}])


def by_name(prompt: str):
    create = getattr(openai_client.chat.completions, "create")
    return create(model="gpt-4.1", messages=[{"role": "user", "content": prompt}])

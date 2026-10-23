from langchain_together import ChatTogether, Together, TogetherEmbeddings

drafter = ChatTogether(model="meta-llama/Llama-3.3-70B-Instruct-Turbo", temperature=0.7)

proxied = ChatTogether(model="Qwen/Qwen2.5-7B-Instruct-Turbo", base_url="http://localhost:9300/v1")

autocomplete = Together(model="mistralai/Mixtral-8x7B-v0.1", max_tokens=64)

vectors = TogetherEmbeddings(model="BAAI/bge-base-en-v1.5")


async def draft(topic: str) -> str:
    reply = await drafter.ainvoke(topic)
    return reply.content

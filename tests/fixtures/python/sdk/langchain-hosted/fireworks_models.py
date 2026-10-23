import os

from langchain_fireworks import ChatFireworks, Fireworks, FireworksEmbeddings

planner = ChatFireworks(model="accounts/fireworks/models/llama-v3p1-70b-instruct", temperature=0.2, max_tokens=512)

gateway = ChatFireworks(model_name="accounts/fireworks/models/qwen3-8b", base_url="https://llm-gw.harborlane.dev/fireworks", api_key=os.environ["FIREWORKS_API_KEY"])

completer = Fireworks(model="accounts/fireworks/models/mixtral-8x7b-instruct", max_tokens=128)

indexer = FireworksEmbeddings(model="nomic-ai/nomic-embed-text-v1.5")


def plan(goal: str) -> str:
    return planner.invoke(goal).content

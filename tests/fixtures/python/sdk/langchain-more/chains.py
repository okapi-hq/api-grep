import os

from langchain_deepseek import ChatDeepSeek
from langchain_google_vertexai import ChatVertexAI, VertexAIEmbeddings

reasoner = ChatDeepSeek(model="deepseek-reasoner", temperature=0, api_key=os.environ["DEEPSEEK_API_KEY"])

local = ChatDeepSeek(model="deepseek-chat", api_base="http://localhost:8001/v1")

gemini = ChatVertexAI(model="gemini-2.5-flash", project="acme-research", location="europe-west1", temperature=0.3)

embedder = VertexAIEmbeddings(model_name="text-embedding-005", project="acme-research", location="europe-west1")


def answer(question: str) -> str:
    return reasoner.invoke(question).content

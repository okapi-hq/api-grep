from langchain_huggingface import (
    ChatHuggingFace,
    HuggingFaceEmbeddings,
    HuggingFaceEndpoint,
    HuggingFaceEndpointEmbeddings,
    HuggingFacePipeline,
)

writer = HuggingFaceEndpoint(repo_id="mistralai/Mistral-7B-Instruct-v0.3", max_new_tokens=256, temperature=0.4)

tgi = HuggingFaceEndpoint(endpoint_url="http://tgi.internal.harborlane.dev:8080/", max_new_tokens=128)

backbone = HuggingFaceEndpoint(repo_id="meta-llama/Llama-3.1-8B-Instruct", task="text-generation")
assistant = ChatHuggingFace(llm=backbone)

dedicated = ChatHuggingFace(llm=HuggingFaceEndpoint(endpoint_url="https://abc123.us-east-1.aws.endpoints.huggingface.cloud"))

search_vectors = HuggingFaceEndpointEmbeddings(model="sentence-transformers/all-MiniLM-L6-v2")

tei = HuggingFaceEndpointEmbeddings(model="http://tei.internal.harborlane.dev:8081")

local = HuggingFacePipeline.from_model_id(model_id="gpt2", task="text-generation")
local_chat = ChatHuggingFace(llm=local)

offline_vectors = HuggingFaceEmbeddings(model_name="sentence-transformers/all-mpnet-base-v2")

routed = ChatHuggingFace.from_model_id(model_id="HuggingFaceH4/zephyr-7b-beta", task="text-generation", backend="endpoint")


def write(prompt: str) -> str:
    return assistant.invoke(prompt).content

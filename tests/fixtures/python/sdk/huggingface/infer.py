import os
from huggingface_hub import InferenceClient, hf_hub_download

client = InferenceClient(model="meta-llama/Llama-3.1-8B-Instruct", token=os.environ["HF_TOKEN"])


def chat(question: str):
    return client.chat_completion(messages=[{"role": "user", "content": question}], max_tokens=200)


def openai_style():
    hf = InferenceClient(api_key=os.environ["HF_TOKEN"])
    return hf.chat.completions.create(model="Qwen/Qwen2.5-72B-Instruct", messages=[{"role": "user", "content": "hi"}])


def generate(prompt: str):
    return client.text_generation(prompt, max_new_tokens=50)


def image(prompt: str):
    return InferenceClient().text_to_image(prompt, model="black-forest-labs/FLUX.1-schnell")


def weights():
    return hf_hub_download("bert-base-uncased", "config.json")

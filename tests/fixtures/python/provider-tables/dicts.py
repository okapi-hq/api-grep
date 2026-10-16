import requests

PROVIDERS = {
    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "key_env": "OPENROUTER_API_KEY"},
    "deepinfra": {"base_url": "https://api.deepinfra.com/v1/openai", "key_env": "DEEPINFRA_API_KEY"},
}


def list_models(name: str):
    return requests.get(PROVIDERS[name]["base_url"] + "/models")


def embed(name: str, text: str):
    cfg = PROVIDERS.get(name)
    return requests.post(f"{cfg['base_url']}/embeddings", json={"input": text})

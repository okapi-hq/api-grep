from fastapi import Depends, FastAPI
from openai import OpenAI

app = FastAPI()


def get_openai() -> OpenAI:
    return OpenAI()


def openai_session():
    client = OpenAI()
    yield client
    client.close()


@app.post("/typed")
def typed(client: OpenAI = Depends(get_openai)):
    return client.chat.completions.create(model="gpt-4o", messages=[])


@app.post("/untyped")
def untyped(client=Depends(get_openai)):
    return client.responses.create(model="gpt-4.1-mini", input="hi")


@app.post("/generator")
def from_generator(client=Depends(openai_session)):
    return client.embeddings.create(model="text-embedding-3-small", input="hi")

import os

import vertexai
from vertexai.generative_models import GenerationConfig, GenerativeModel

vertexai.init(project="lumen-press", location="europe-west4")

model = GenerativeModel("gemini-2.0-flash", system_instruction="You write short product blurbs.")


def blurb(product):
    return model.generate_content(f"Describe {product}", generation_config=GenerationConfig(temperature=0.4))


def blurb_stream(product):
    return model.generate_content(f"Describe {product}", stream=True)


async def blurb_async(product):
    return await model.generate_content_async(contents=product)


def budget(text):
    return model.count_tokens(text)


def chat(question):
    session = model.start_chat()
    return session.send_message(question)


def from_env(prompt):
    return GenerativeModel(model_name=os.environ["COPY_MODEL"]).generate_content(prompt)

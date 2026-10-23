import os

from zhipuai import ZhipuAI

client = ZhipuAI(api_key=os.environ["ZHIPUAI_API_KEY"])


def explain(question):
    return client.chat.completions.create(model="glm-4-plus", messages=[{"role": "user", "content": question}], temperature=0.3)


def queue(question):
    return client.chat.asyncCompletions.create(model="glm-4-air", messages=[{"role": "user", "content": question}])


def poll(task_id):
    return client.chat.asyncCompletions.retrieve_completion_result(id=task_id)


def vectors(texts):
    return client.embeddings.create(model="embedding-3", input=texts)


def poster(prompt):
    return client.images.generations(model="cogview-4", prompt=prompt, size="1024x1024")


def clip(prompt):
    return client.videos.generations("cogvideox-2", prompt=prompt, with_audio=True)


def upload(path):
    return client.files.create(file=open(path, "rb"), purpose="batch")


def remove(file_id):
    return client.files.delete(file_id)


def ask_agent(agent_id, text):
    return client.agents.invoke(agent_id, messages=[{"role": "user", "content": text}])


proxied = ZhipuAI(api_key=os.environ["ZHIPUAI_API_KEY"], base_url="https://llm-gw.tidewater.dev/zhipu/api/paas/v4")


def via_gateway(question):
    return proxied.chat.completions.create(model="glm-4-flash", messages=[{"role": "user", "content": question}])

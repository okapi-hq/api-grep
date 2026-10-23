import os

from zai import ZaiClient, ZhipuAiClient

global_client = ZaiClient(api_key=os.environ["ZAI_API_KEY"])
china_client = ZhipuAiClient(api_key=os.environ["ZHIPU_API_KEY"])


def reply(question):
    return global_client.chat.completions.create(model="glm-4.6", messages=[{"role": "user", "content": question}], thinking={"type": "enabled"})


def reply_cn(question):
    return china_client.chat.completions.create(model="glm-4.5-air", messages=[{"role": "user", "content": question}])


def read_page(url):
    return global_client.web_reader.web_reader(url=url, return_format="markdown")


def search(query):
    return global_client.web_search.web_search(search_engine="search-prime", search_query=query)


def speak(text):
    return china_client.audio.speech(model="cogtts", input=text, voice="tongtong")


def batch_status(batch_id):
    return global_client.batches.retrieve(batch_id)


def voices():
    return china_client.voice.list(voice_type="OFFICIAL")

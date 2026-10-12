from openai import OpenAI

client = OpenAI()


def summarize(text, model="gpt-4o-mini", max_tokens=1024):
    return client.chat.completions.create(model=model, max_tokens=max_tokens, messages=[{"role": "user", "content": text}])


def translate(text, model="gpt-4o-mini", max_tokens=1024):
    return client.chat.completions.create(model=model, max_tokens=max_tokens, messages=[{"role": "user", "content": text}])


def classify(text, model="gpt-4o-mini", max_tokens=1024):
    return client.chat.completions.create(model=model, max_tokens=max_tokens, messages=[{"role": "user", "content": text}])


def translate_both(text):
    translate(text)
    return translate(text, model="o3", max_tokens=4096)


def classify_with(text, settings):
    classify(text)
    return classify(text, model=settings.pick_model(), max_tokens=settings.limit)


class Writer:
    default_model = "gpt-4.1"

    def draft(self, text, model=None):
        return client.chat.completions.create(model=model or self.default_model, messages=[{"role": "user", "content": text}])

    def draft_fast(self, text):
        return self.draft(text, model="gpt-4.1-nano")

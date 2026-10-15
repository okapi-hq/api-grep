import anthropic
import openai


class Summarizer:
    def __init__(self, provider="anthropic", model=None, client=None, api_key=None):
        self._provider = provider
        if provider == "gemini":
            self._client = None
            self._model = model or "gemini-2.5-flash-lite"
        elif provider == "anthropic":
            self._model = model or "claude-sonnet-4-6"
            self._client = client
            if self._client is None:
                kwargs = {"api_key": api_key} if api_key else {}
                self._client = anthropic.Anthropic(**kwargs)
        elif provider == "openai":
            self._model = model or "gpt-5-mini"
            self._client = client

    def _ensure_openai_client(self):
        if self._client is None:
            self._client = openai.OpenAI()

    def _call_anthropic(self, system, user):
        resp = self._client.messages.create(model=self._model, max_tokens=1024, system=system, messages=[{"role": "user", "content": user}])
        return resp

    def _call_openai(self, system, user):
        self._ensure_openai_client()
        resp = self._client.chat.completions.create(model=self._model, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
        return resp

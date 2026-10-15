import os


class BaseAgent:
    def __init__(self, name: str):
        self.name = name


class LLMAgent(BaseAgent):
    def __init__(self, name: str, model: str = "claude-sonnet-4-6"):
        super().__init__(name)
        self.model = model
        self._llm_client = None

    def _get_llm_client(self):
        if self._llm_client is None:
            if self.model.startswith("claude"):
                from anthropic import AsyncAnthropic
                self._llm_client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
            else:
                from openai import AsyncOpenAI
                self._llm_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        return self._llm_client

    async def ask(self, prompt: str) -> str:
        client = self._get_llm_client()
        if not client:
            return "no client"
        if self.model.startswith("claude"):
            response = await client.messages.create(model=self.model, max_tokens=4096, messages=[{"role": "user", "content": prompt}])
        else:
            response = await client.chat.completions.create(model=self.model, messages=[{"role": "user", "content": prompt}], max_tokens=4096)
        return str(response)


class AnalystAgent(LLMAgent):
    async def analyse(self, text: str) -> str:
        return await self.ask(f"Analyse: {text}")

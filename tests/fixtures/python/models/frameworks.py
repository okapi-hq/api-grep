import dspy
import litellm
from agents import Agent as OpenAIAgent
from crewai import LLM
from google.adk.agents import Agent as AdkAgent
from langchain.chat_models import init_chat_model
from langchain_anthropic import ChatAnthropic
from langchain_aws import ChatBedrockConverse
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from pydantic_ai import Agent
from smolagents import LiteLLMModel

writer = ChatOpenAI(model="gpt-4o", temperature=0, api_key="sk-local", callbacks=[])
embedder = OpenAIEmbeddings(model="text-embedding-3-small")
critic = ChatAnthropic(model="claude-3-opus-20240229", max_tokens=1024)
gemini = ChatGoogleGenerativeAI(model="gemini-1.5-pro", temperature=0.3)
bedrock = ChatBedrockConverse(model="anthropic.claude-3-sonnet-20240229-v1:0", region_name="us-east-1")
local = ChatOpenAI(model="qwen3:32b", base_url="http://localhost:11434/v1")
router = init_chat_model("groq:llama-3.3-70b-versatile", temperature=0)
helper = Agent("openai:gpt-4o", system_prompt="Be brief.")
triage = OpenAIAgent(name="Triage", instructions="Route the request.", model="gpt-4.1-mini")
crew_llm = LLM(model="anthropic/claude-3-5-sonnet-20240620", temperature=0.7)
lm = dspy.LM("openai/gpt-4o-mini", max_tokens=2000)
coder = LiteLLMModel(model_id="deepseek/deepseek-chat")
adk = AdkAgent(name="assistant", model="gemini-2.0-flash", instruction="Help.")


def complete(messages):
    return litellm.completion(model="mistral/mistral-large-latest", messages=messages)


def embed(texts):
    return litellm.embedding(model="text-embedding-ada-002", input=texts)


def mystery(messages):
    return litellm.completion(model="my-finetune", messages=messages)

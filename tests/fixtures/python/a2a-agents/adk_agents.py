from google.adk.agents import Agent
from google.adk.agents.remote_a2a_agent import RemoteA2aAgent

weather = RemoteA2aAgent(
    name="weather",
    agent_card="https://forecast.harbor-lane.dev/.well-known/agent-card.json",
)

tides = RemoteA2aAgent(name="tides", agent_card="https://tides.harbor-lane.dev")

root = Agent(name="captain", model="gemini-2.5-flash", sub_agents=[weather, tides])

from google.adk.a2a.utils.agent_to_a2a import to_a2a
from google.adk.agents import Agent

pantry = Agent(name="pantry", model="gemini-2.5-flash", instruction="Track what is in the pantry.")
app = to_a2a(pantry, port=8001)

from agent_framework.a2a import A2AAgent as FrameworkAgent
from crewai import Agent
from crewai.a2a import A2AClientConfig
from fasta2a.client import A2AClient
from strands.agent.a2a_agent import A2AAgent

pilot = A2AAgent(endpoint="https://pilot.harbor-lane.dev")

harbor_master = FrameworkAgent(name="harbor", url="https://master.harbor-lane.dev/a2a")

dispatcher = Agent(
    role="dispatcher",
    goal="route boats",
    backstory="",
    llm="gpt-4o-mini",
    a2a=A2AClientConfig(endpoint="https://dock.harbor-lane.dev/.well-known/agent-card.json"),
)


async def ask_lighthouse(message):
    client = A2AClient("https://lighthouse.harbor-lane.dev")
    sent = await client.send_message(message)
    return await client.get_task(sent["result"]["id"])

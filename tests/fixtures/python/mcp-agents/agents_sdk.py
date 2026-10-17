import os

from agents import Agent, Runner
from agents.mcp import MCPServerSse, MCPServerStdio, MCPServerStreamableHttp


async def answer(question: str):
    async with MCPServerStreamableHttp(
        name="crm",
        params={"url": "https://mcp.tallyhouse-crm.dev/mcp", "headers": {"Authorization": f"Bearer {os.environ['TALLYHOUSE_TOKEN']}"}},
    ) as crm, MCPServerStdio(params={"command": "npx", "args": ["-y", "@example/files-server"]}) as files:
        tools = await crm.list_tools()
        contact = await crm.call_tool("find_contact", {"query": question})
        agent = Agent(name="Desk", model="gpt-4.1", mcp_servers=[crm, files])
        return tools, contact, await Runner.run(agent, question)


def legacy_server():
    return MCPServerSse(params={"url": "https://mcp.tallyhouse-crm.dev/sse"})

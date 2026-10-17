import os

from crewai import Agent
from crewai.mcp import MCPServerHTTP, MCPServerStdio
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

DOCS_SERVER = {"url": "https://mcp.lanternworks.dev/mcp", "transport": "streamable-http", "headers": {"X-Api-Key": os.environ["LANTERN_KEY"]}}


def research(topic: str):
    with MCPServerAdapter([DOCS_SERVER, StdioServerParameters(command="uvx", args=["example-files-mcp"])]) as tools:
        return [t.name for t in tools], topic


researcher = Agent(
    role="Researcher",
    goal="Find sources",
    backstory="Reads a lot",
    llm="gpt-4o",
    mcps=[
        "https://mcp.lanternworks.dev/search",
        "crewai-amp:example-catalog",
        MCPServerHTTP(url="https://archive.lanternworks.dev/mcp", headers={"Authorization": "Bearer " + os.environ["ARCHIVE_TOKEN"]}),
        MCPServerStdio(command="python", args=["./local_server.py"]),
    ],
)

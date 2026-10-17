import os

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

SERVERS = {
    "kb": {
        "url": "https://mcp.quillstack.dev/mcp",
        "transport": "streamable_http",
        "headers": {"Authorization": f"Bearer {os.environ['QUILL_TOKEN']}"},
    },
    "search": {"url": "https://search.quillstack.dev/sse", "transport": "sse"},
    "issues": {"url": "https://mcp.linear.app/mcp", "transport": "streamable_http"},
    "math": {"command": "python", "args": ["./servers/math.py"], "transport": "stdio"},
}


async def knowledge_tools():
    client = MultiServerMCPClient(SERVERS)
    return await client.get_tools()


async def session_tools():
    async with streamablehttp_client("https://mcp.quillstack.dev/mcp") as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await load_mcp_tools(session)

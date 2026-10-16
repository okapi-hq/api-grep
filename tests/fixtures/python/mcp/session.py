import os
from contextlib import AsyncExitStack

from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client

WEATHER_MCP = "https://mcp.drizzle-forecast.dev/mcp"


async def forecast(city: str):
    headers = {"Authorization": f"Bearer {os.environ['DRIZZLE_TOKEN']}"}
    async with streamablehttp_client(WEATHER_MCP, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("daily_forecast", {"city": city, "days": 3})
            return tools, result


async def legacy_alerts(region: str):
    async with sse_client("https://alerts.drizzle-forecast.dev/sse") as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await session.read_resource(f"alerts://{region}")


class ToolBridge:
    def __init__(self, url: str):
        self.url = url
        self.stack = AsyncExitStack()

    async def open(self):
        transport = await self.stack.enter_async_context(streamablehttp_client(self.url))
        read, write, _ = transport
        self.session = await self.stack.enter_async_context(ClientSession(read, write))
        await self.session.initialize()

    async def run(self, tool: str, args: dict):
        return await self.session.call_tool(tool, arguments=args)

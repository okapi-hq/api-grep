import os

from autogen_ext.tools.mcp import McpWorkbench, SseServerParams, StreamableHttpServerParams, mcp_server_tools
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
from llama_index.tools.mcp import BasicMCPClient, McpToolSpec
from pydantic_ai.mcp import MCPServerSSE, MCPServerStreamableHTTP
from smolagents import MCPClient, ToolCollection

WEATHER_TOKEN = os.environ["DRIZZLE_TOKEN"]

# PydanticAI
forecast_server = MCPServerStreamableHTTP("https://mcp.drizzle-forecast.dev/mcp", headers={"Authorization": f"Bearer {WEATHER_TOKEN}"})
alerts_server = MCPServerSSE(url="https://alerts.drizzle-forecast.dev/sse")


async def forecast_tools():
    return await forecast_server.list_tools()


# Google ADK
radar = McpToolset(connection_params=StreamableHTTPConnectionParams(url="https://radar.drizzle-forecast.dev/mcp", headers={"X-Api-Key": WEATHER_TOKEN}))


# smolagents
def station_tools():
    with MCPClient({"url": "https://stations.drizzle-forecast.dev/mcp", "transport": "streamable-http"}) as tools:
        return tools


def archive_tools():
    with ToolCollection.from_mcp({"url": "https://archive.drizzle-forecast.dev/sse"}, trust_remote_code=True) as collection:
        return collection.tools


# LlamaIndex
llama_client = BasicMCPClient("https://tides.drizzle-forecast.dev/mcp", headers={"Authorization": f"Bearer {WEATHER_TOKEN}"})


async def tide_tools():
    spec = McpToolSpec(client=llama_client)
    tools = await spec.to_tool_list_async()
    level = await llama_client.call_tool("tide_level", {"port": "harbor"})
    return tools, level


# AutoGen
async def pollen(city: str):
    params = StreamableHttpServerParams(url="https://pollen.drizzle-forecast.dev/mcp", headers={"Authorization": f"Bearer {WEATHER_TOKEN}"})
    async with McpWorkbench(server_params=params) as workbench:
        return await workbench.call_tool("pollen_count", {"city": city})


async def pollen_tools():
    return await mcp_server_tools(SseServerParams(url="https://pollen.drizzle-forecast.dev/sse"))

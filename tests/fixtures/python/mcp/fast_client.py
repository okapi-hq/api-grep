from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport


async def find_books(topic: str):
    async with Client("https://mcp.paper-trail.dev/mcp") as client:
        return await client.call_tool("search_books", {"topic": topic})


async def catalog(token: str):
    transport = StreamableHttpTransport("https://mcp.paper-trail.dev/mcp", headers={"X-Api-Key": token})
    async with Client(transport) as client:
        prompts = await client.list_prompts()
        summary = await client.get_prompt("summarize_shelf", {"shelf": "new"})
        return prompts, summary


async def alerts():
    async with Client("https://alerts.paper-trail.dev/sse") as client:
        return await client.list_tools()

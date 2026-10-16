from fastmcp import Client, FastMCP
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.server.fastmcp import FastMCP as SdkFastMCP

# MCP servers receive requests: their tools and `run` send none
garden = FastMCP("garden-planner")


@garden.tool()
def plant_dates(crop: str) -> str:
    return f"{crop}: spring"


notes = SdkFastMCP("note-keeper")


@notes.resource("notes://{slug}")
def note(slug: str) -> str:
    return slug


async def self_check():
    # an in-memory client of the server, and a local script over stdio
    async with Client(garden) as client:
        await client.call_tool("plant_dates", {"crop": "kale"})
    async with Client("tools/local_server.py") as local:
        await local.list_tools()


async def stdio_session():
    params = StdioServerParameters(command="python", args=["-m", "pocket_tools"])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await session.call_tool("count", {"what": "files"})


if __name__ == "__main__":
    garden.run()

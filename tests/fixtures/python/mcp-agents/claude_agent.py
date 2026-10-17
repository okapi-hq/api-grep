import os

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, create_sdk_mcp_server

helpers = create_sdk_mcp_server(name="helpers", version="1.0.0", tools=[])

options = ClaudeAgentOptions(
    model="claude-sonnet-4-5",
    mcp_servers={
        "tracker": {"type": "http", "url": "https://mcp.burrowtrack.dev/mcp", "headers": {"Authorization": f"Bearer {os.environ['BURROW_TOKEN']}"}},
        "docs": {"type": "sse", "url": "https://docs.burrowtrack.dev/sse"},
        "git": {"command": "npx", "args": ["-y", "@example/git-mcp"]},
        "helpers": helpers,
    },
)


async def review(diff: str):
    async with ClaudeSDKClient(options) as client:
        await client.query(f"Review this diff:\n{diff}")
        return [m async for m in client.receive_response()]


def options_for(token: str | None):
    return ClaudeAgentOptions(mcp_servers={"tracker": {"type": "http", "url": "https://mcp.burrowtrack.dev/mcp"}} if token else {})

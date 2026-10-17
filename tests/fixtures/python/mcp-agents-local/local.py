import json

from agents import HostedMCPTool
from agents.mcp import MCPServerStdio
from autogen_ext.tools.mcp import McpWorkbench, StdioServerParams
from claude_agent_sdk import ClaudeAgentOptions, create_sdk_mcp_server
from crewai_tools import MCPServerAdapter
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from langchain_mcp_adapters.client import MultiServerMCPClient
from llama_index.tools.mcp import BasicMCPClient
from mcp import StdioServerParameters
from pydantic_ai.mcp import MCPServerStdio as PydanticStdio
from smolagents import MCPClient

FILES = StdioServerParameters(command="uvx", args=["example-files-mcp"])

# local processes (stdio): no HTTP request
local_client = MultiServerMCPClient({"math": {"command": "python", "args": ["./math_server.py"], "transport": "stdio"}})
files_server = MCPServerStdio(params={"command": "npx", "args": ["-y", "@example/files-server"]})
pydantic_files = PydanticStdio("uvx", args=["example-files-mcp"])
adk_files = McpToolset(connection_params=StdioConnectionParams(server_params=FILES))
smol_files = MCPClient(FILES)
llama_files = BasicMCPClient("python", args=["./server.py"])
autogen_files = McpWorkbench(server_params=StdioServerParams(command="uvx", args=["example-files-mcp"]))
crew_files = MCPServerAdapter(FILES)
claude_local = ClaudeAgentOptions(mcp_servers={"git": {"command": "npx", "args": ["-y", "@example/git-mcp"]}, "helpers": create_sdk_mcp_server(name="helpers", tools=[])})
claude_file = ClaudeAgentOptions(mcp_servers="./mcp.json")


# a configuration the scan cannot read: maybe local processes only
def configured_client(path: str):
    with open(path) as f:
        return MultiServerMCPClient(json.load(f))


# a server OpenAI's platform connects to, on its side
wiki = HostedMCPTool(tool_config={"type": "mcp", "server_label": "wiki", "server_url": "https://mcp.example-wiki.dev/mcp"})

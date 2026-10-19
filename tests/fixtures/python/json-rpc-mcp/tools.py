import httpx
import requests

SERVER = "https://mcp.linear.app/mcp"


def search_web(query):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "web_search", "arguments": {"query": query}}}
    return requests.post("https://mcp.harborlight-search.dev/mcp", json=payload)


def read_issue(issue_id):
    return httpx.post(SERVER, json={"jsonrpc": "2.0", "id": 2, "method": "resources/read", "params": {"uri": f"issue://{issue_id}"}})


def subscribe(uri):
    return httpx.post(SERVER, json={"jsonrpc": "2.0", "id": 3, "method": "resources/subscribe", "params": {"uri": uri}})


def call_tool(tool):
    return requests.post(SERVER, json={"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": tool, "arguments": {}}})

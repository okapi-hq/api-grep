import httpx
from a2a.client import A2AClient


async def ask_concierge(request):
    async with httpx.AsyncClient() as http:
        client = A2AClient(httpx_client=http, url="https://concierge.voyage-desk.dev/a2a")
        response = await client.send_message(request)
        stream = client.send_message_streaming(request)
        return response, stream

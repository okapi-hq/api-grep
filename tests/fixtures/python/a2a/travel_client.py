import httpx
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory, create_client

PLANNER_URL = "https://planner.voyage-desk.dev"


async def plan_trip(message):
    client = await create_client("https://itinerary.voyage-desk.dev")
    async for event in client.send_message(message):
        print(event)


async def plan_with_factory(message):
    factory = ClientFactory(ClientConfig(streaming=False))
    client = await factory.create_from_url(PLANNER_URL)
    async for event in client.send_message(message):
        print(event)
    return await client.get_task(event.task_id)


async def resolve_card():
    async with httpx.AsyncClient() as http:
        resolver = A2ACardResolver(http, base_url="https://hotels.voyage-desk.dev")
        card = await resolver.get_agent_card()
        client = ClientFactory(ClientConfig()).create(card)
        await client.cancel_task("t-1")

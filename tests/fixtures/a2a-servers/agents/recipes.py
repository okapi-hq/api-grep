import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.types import AgentCapabilities, AgentCard, AgentSkill

card = AgentCard(
    name="Recipe finder",
    url="http://localhost:9999/",
    version="1.0.0",
    protocol_version="0.3.0",
    preferred_transport="JSONRPC",
    capabilities=AgentCapabilities(streaming=True),
    skills=[AgentSkill(id="find", name="Find a recipe", description="", tags=[])],
)

# A2AStarletteApplication(...) is built below
app = A2AStarletteApplication(agent_card=card, http_handler=DefaultRequestHandler(None, None)).build()

if __name__ == "__main__":
    uvicorn.run(app, port=9999)

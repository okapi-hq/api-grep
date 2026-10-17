from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, query

REVIEW_OPTIONS = ClaudeAgentOptions(model="claude-sonnet-4-5", allowed_tools=["Read", "Grep"], max_turns=4)


async def review(diff: str) -> str:
    async for message in query(prompt=f"Review this diff:\n{diff}", options=REVIEW_OPTIONS):
        if isinstance(message, ResultMessage):
            return message.result
    return ""


async def chat(question: str):
    async with ClaudeSDKClient(options=ClaudeAgentOptions(model="claude-haiku-4-5")) as client:
        await client.query(question)
        async for message in client.receive_response():
            print(message)


async def default_model(task: str):
    async for message in query(prompt=task):
        print(message)

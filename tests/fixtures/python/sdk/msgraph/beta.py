from msgraph_beta import GraphServiceClient


class Directory:
    def __init__(self, credential):
        self.client = GraphServiceClient(credentials=credential, scopes=["https://graph.microsoft.com/.default"])

    async def team_channels(self, team_id):
        return await self.client.teams.by_team_id(team_id).channels.get()

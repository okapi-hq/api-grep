import os

from gql import Client, gql
from gql.transport.aiohttp import AIOHTTPTransport
from gql.transport.requests import RequestsHTTPTransport

TOKEN = os.environ["WAREHOUSE_TOKEN"]

transport = RequestsHTTPTransport(
    url="https://api.example-warehouse.io/graphql",
    headers={"Authorization": f"Bearer {TOKEN}"},
)
client = Client(transport=transport, fetch_schema_from_transport=False)

LIST_BINS = gql(
    """
    query ListBins($aisle: Int!) {
      bins(aisle: $aisle) { id label stock { sku count } }
    }
    """
)


def list_bins(aisle):
    return client.execute(LIST_BINS, variable_values={"aisle": aisle})


def move_pallet(pallet_id, bin_id):
    return client.execute(gql("mutation MovePallet($p: ID!, $b: ID!) { movePallet(pallet: $p, bin: $b) { id } }"), variable_values={"p": pallet_id, "b": bin_id})


async def stock_levels():
    async with Client(transport=AIOHTTPTransport(url=os.environ["STOCK_GRAPHQL_URL"])) as session:
        return await session.execute(gql("query StockLevels { stockLevels { sku count } }"))


def watch_docks(dock_client: Client):
    return dock_client.subscribe(gql("subscription DockEvents { dockEvents { dock } }"))

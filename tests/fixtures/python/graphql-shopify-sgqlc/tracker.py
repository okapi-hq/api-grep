import os

from sgqlc.endpoint.http import HTTPEndpoint
from sgqlc.endpoint.requests import RequestsEndpoint
from sgqlc.operation import Operation

from .schema import tracker_schema as schema

TRACKER_URL = "https://api.example-tracker.dev/graphql"


def open_tickets(project):
    endpoint = HTTPEndpoint(TRACKER_URL, {"Authorization": "Bearer " + os.environ["TRACKER_TOKEN"]})
    op = Operation(schema.Query, name="OpenTickets")
    tickets = op.project(key=project).tickets(first=50, state="OPEN")
    tickets.nodes.number()
    tickets.nodes.created_at()
    tickets.nodes.assignee.__fields__("login", "display_name")
    tickets.page_info.__fields__()
    return endpoint(op)


def close_ticket(ticket_id):
    endpoint = RequestsEndpoint(url=os.environ["TRACKER_GRAPHQL_URL"])
    op = Operation(schema.Mutation)
    op.close_ticket(id=ticket_id).ticket.state()
    return endpoint(op, {"id": ticket_id})


def ticket_titles(endpoint: HTTPEndpoint):
    return endpoint("query TicketTitles { tickets(first: 10) { nodes { title } } }")

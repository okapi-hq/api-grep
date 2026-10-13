import httpx
import requests

API = "https://api.example-tracker.dev/graphql"

LIST_TICKETS = """
query ListTickets($team: ID!) {
  team(id: $team) {
    tickets(first: 50) {
      nodes { id title assignee { name } }
    }
  }
}
"""

TICKET_FIELDS = """
fragment TicketFields on Ticket { id state { name } }
"""


def list_tickets(team_id, token):
    return requests.post(API, json={"query": LIST_TICKETS, "variables": {"team": team_id}}, headers={"Authorization": token})


def close_ticket(ticket_id, token):
    query = "mutation CloseTicket($id: ID!) { ticketUpdate(id: $id, input: {state: CLOSED}) { success ticket { ...TicketFields } } }" + TICKET_FIELDS
    return requests.post(API, json={"query": query, "variables": {"id": ticket_id}}, headers={"Authorization": token})


def me(token):
    return httpx.post(API, json={"query": "{ me: viewer { id email } }"}, headers={"Authorization": token})


def run(query, variables, token):
    return requests.post(API, json={"query": query, "variables": variables}, headers={"Authorization": token}).json()


def team_names(token):
    return run("query TeamNames { teams { nodes { name } } }", {}, token)


def saved_view(token):
    return requests.post(API, json={"operationName": "SavedView", "extensions": {"persistedQuery": {"version": 1, "sha256Hash": "e3b0c44298fc1c14"}}}, headers={"Authorization": token})


def search(text):
    return requests.post("https://api.example-tracker.dev/search", json={"query": text})


def search_near(city, kind):
    return requests.post("https://api.example-tracker.dev/search", json={"query": f"{city} {kind}"})

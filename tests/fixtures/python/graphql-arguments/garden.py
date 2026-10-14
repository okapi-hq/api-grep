import requests

API = "https://api.example-greenhouse.dev/graphql"

RECENT = """
query RecentPlants($cursor: String) {
  plants(first: 20, after: $cursor, sortKey: CREATED_AT, filter: {tags: ["fern"], owner: null}) {
    nodes { id photos(size: 64) { url } }
  }
}
"""


def recent(cursor):
    return requests.post(API, json={"query": RECENT, "variables": {"cursor": cursor}})


def plant(plant_id):
    query = f'query PlantCard {{ plant(id: "{plant_id}") {{ name small: photo(size: 64) {{ url }} large: photo(size: 512) {{ url }} }} }}'
    return requests.post(API, json={"query": query})


def sign_in():
    query = 'mutation SignIn { signIn(email: "gardener@example.com", password: "hunter2") { session { id } } }'
    return requests.post(API, json={"query": query})


def invite():
    return requests.post(API, json={"query": '{ invite(code: "d41d8cd98f00b204e9800998ecf8427e") { id } }'})


def names():
    return requests.post(API, json={"query": "query PlantNames { plants { nodes { name } } }"})

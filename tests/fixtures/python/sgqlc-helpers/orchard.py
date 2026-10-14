from sgqlc.endpoint.http import HTTPEndpoint
from sgqlc.operation import Operation

from orchard_schema import orchard_schema as schema


def endpoint_for(token):
    return HTTPEndpoint("https://api.example-orchard.dev/graphql", {"Authorization": "bearer %s" % token})


def select_trees(op, first):
    trees = op.orchard(id="1").trees(first=first)
    trees.nodes.name()
    add_height(trees.nodes)


def add_height(node):
    node.height()


def tree_names(endpoint, first):
    op = Operation(schema.Query, name="TreeNames")
    select_trees(op, first)
    return endpoint(op)


def run(token):
    return tree_names(endpoint_for(token), 10)


def harvest(endpoint):
    """Its callers are elsewhere: the endpoint is sgqlc's, its URL unknown."""
    op = Operation(schema.Query)
    op.harvest.weight()
    return endpoint(op)


def notify(callback, value):
    """A callback, not an endpoint: nothing is reported."""
    return callback(value)

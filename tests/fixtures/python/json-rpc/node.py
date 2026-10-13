import json

import requests

NODE_URL = "https://eth.example-node.io"


def balance(address):
    return requests.post(NODE_URL, json={"jsonrpc": "2.0", "id": 1, "method": "eth_getBalance", "params": [address, "latest"]})


def rpc(method, params):
    return requests.post(NODE_URL, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).json()


def block_number():
    return rpc("eth_blockNumber", [])


def chain_id():
    return rpc("eth_chainId", [])


def gas_price():
    return rpc("eth_gasPrice", [])


def balance_and_height(address):
    return requests.post(NODE_URL, data=json.dumps([
        {"jsonrpc": "2.0", "id": 1, "method": "eth_getBalance", "params": [address, "latest"]},
        {"jsonrpc": "2.0", "id": 2, "method": "eth_blockNumber", "params": []},
    ]))


def transaction(pending, tx_hash):
    method = "eth_getTransactionByHash" if pending else "eth_getTransactionReceipt"
    return requests.post(NODE_URL, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": [tx_hash]})


def namespaced(namespace):
    return requests.post(NODE_URL, json={"jsonrpc": "2.0", "id": 1, "method": namespace + "_syncing", "params": []})


def pay(amount):
    # not JSON-RPC: a `method` with no envelope
    return requests.post("https://api.example-pay.com/v1/payments", json={"method": "card", "amount": amount})

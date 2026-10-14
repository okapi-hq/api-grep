import os

from solana.rpc.api import Client
from web3 import Web3

RPC_URLS = {1: "https://eth.example-node.io", 10: "https://op.example-node.io"}
_clients = {}


# one client per chain, built on first use: which node depends on the chain id
def get_w3(chain_id):
    if chain_id not in _clients:
        _clients[chain_id] = Web3(Web3.HTTPProvider(RPC_URLS[chain_id]))
    return _clients[chain_id]


def head(chain_id):
    return get_w3(chain_id).eth.get_block("latest")


_archives = {}


# every entry is built with the same URL
def archive(label):
    if label not in _archives:
        _archives[label] = Web3(Web3.HTTPProvider(os.environ["ARCHIVE_NODE_URL"]))
    return _archives[label]


def past_balance(address, block):
    w3 = archive("main")
    return w3.eth.get_balance(address, block_identifier=block)


_ledgers = {"main": Client("https://ledger.example-chain.net")}


def ledger(name):
    return _ledgers.get(name)


def add_ledger(name, url):
    _ledgers[name] = Client(url)


# the entries are built with different URLs: the host depends on the name
def lamports(name, owner):
    return ledger(name).get_balance(owner)

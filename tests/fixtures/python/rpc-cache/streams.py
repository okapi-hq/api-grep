from web3 import Web3

_streams = {}


# one of the entries is a socket: what a call sends is not known to be an HTTP request
def stream(kind):
    if kind not in _streams:
        if kind == "live":
            _streams[kind] = Web3(Web3.WebsocketProvider("wss://eth.example-node.io/ws"))
        else:
            _streams[kind] = Web3(Web3.HTTPProvider("https://eth.example-node.io"))
    return _streams[kind]


def pending_nonce(kind, address):
    return stream(kind).eth.get_transaction_count(address, "pending")


def local_cache(address):
    # a dict of the function's own: not the module's
    _streams = {"main": Web3(Web3.HTTPProvider("https://local.example-node.io"))}
    return _streams["main"].eth.get_code(address)

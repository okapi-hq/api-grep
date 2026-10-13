import os

from solana.rpc.api import Client
from solana.rpc.async_api import AsyncClient
from web3 import AsyncWeb3, Web3

w3 = Web3(Web3.HTTPProvider("https://eth.example-node.io"))
aw3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(os.environ["NODE_URL"]))
socket = Web3(Web3.WebsocketProvider("wss://eth.example-node.io/ws"))
ledger = Client("https://rpc.example-chain.net")


def balance(address):
    return w3.eth.get_balance(address)


def receipt(tx_hash):
    return w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)


async def nonce(address):
    return await aw3.eth.get_transaction_count(address)


def fee_history():
    return w3.provider.make_request("eth_feeHistory", [4, "latest", []])


def streamed_balance(address):
    return socket.eth.get_balance(address)


def lamports(owner):
    return ledger.get_balance(owner)


def signatures(owner):
    return ledger.get_signatures_for_address(owner, limit=10)


async def blockhash():
    async with AsyncClient("https://rpc.example-chain.net") as client:
        return await client.get_latest_blockhash()

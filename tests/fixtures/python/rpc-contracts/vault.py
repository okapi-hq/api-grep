import os

from web3 import AsyncWeb3, Web3

ERC20_ABI = [{"name": "balanceOf", "type": "function", "stateMutability": "view", "inputs": [], "outputs": []}]

w3 = Web3(Web3.HTTPProvider("https://eth.example-node.io"))
hosted = Web3(Web3.HTTPProvider(f"https://mainnet.infura.io/v3/{os.environ['INFURA_KEY']}"))
socket = Web3(Web3.LegacyWebSocketProvider("wss://eth.example-node.io/ws"))
token = w3.eth.contract(address="0x00000000000000000000000000000000000000aa", abi=ERC20_ABI)


def balance(owner):
    return token.functions.balanceOf(owner).call()


def pay(to, amount):
    return token.functions.transfer(to, amount).transact({"from": w3.eth.accounts[0]})


def transfer_cost(to, amount):
    return token.functions.transfer(to, amount).estimate_gas()


def supply():
    return token.caller.totalSupply()


def transfers(start):
    return token.events.Transfer().get_logs(from_block=start)


def head():
    return w3.eth.block_number


def chain():
    return hosted.eth.chain_id


async def fee(url):
    aw3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(url))
    return await aw3.eth.gas_price


def streamed_head():
    return socket.eth.block_number


def handler():
    # the bound method handed over sends nothing here
    return w3.eth.get_balance

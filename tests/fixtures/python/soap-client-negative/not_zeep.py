from inventory.remote import Client as RemoteClient


class Client:
    """A project class with a `service` attribute: not zeep's client."""

    def __init__(self, url):
        self.service = Registry(url)


class Registry:
    def __init__(self, url):
        self.url = url

    def Lookup(self, key):
        return key


def lookup(key):
    return Client("https://ws.example-inventory.com/registry?wsdl").service.Lookup(key)


def remote(key):
    return RemoteClient("https://ws.example-inventory.com/remote?wsdl").service.Lookup(key)

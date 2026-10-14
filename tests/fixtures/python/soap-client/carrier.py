import os

import zeep
from zeep import AsyncClient, Client

TRACK_WSDL = "https://ws.example-carrier.com/track?wsdl"

client = Client(TRACK_WSDL)


def track(tracking_id):
    return client.service.Track(Id=tracking_id)


def cancel(shipment_id):
    c = zeep.Client(wsdl=TRACK_WSDL)
    return c.service.CancelShipment(shipment_id, "customer")


async def rates(zip_code):
    async with AsyncClient("https://ws.example-carrier.com/rates.asmx?WSDL") as c:
        return await c.service.GetRates(Zip=zip_code)


def bound(tracking_id):
    service = client.bind("TrackService", "TrackPort")
    return service.Track(Id=tracking_id)


def regional(tracking_id):
    service = client.create_service("{urn:example-carrier}TrackBinding", "https://eu.example-carrier.com/soap/track")
    return service.Track(Id=tracking_id)


def label(label_id):
    labels = Client(os.path.join(os.path.dirname(__file__), "wsdl", "labels.wsdl"))
    return labels.service.PrintLabel(Id=label_id)


def configured(tracking_id):
    c = Client(os.environ["CARRIER_WSDL"])
    return c.service.Track(Id=tracking_id)


class Archive:
    def __init__(self):
        self.client = zeep.Client("https://ws.example-archive.com/archive?wsdl")

    def store(self, doc_id):
        return self.client.service.Store(DocumentId=doc_id)

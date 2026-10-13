import requests
import xml.etree.ElementTree as ET

SERVICE = "https://ws.example-carrier.com/track/v2"

ENVELOPE = """<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <CancelShipment>
      <ShipmentId>{shipment_id}</ShipmentId>
    </CancelShipment>
  </soapenv:Body>
</soapenv:Envelope>"""


def cancel(shipment_id):
    body = ENVELOPE.format(shipment_id=shipment_id)
    return requests.post(SERVICE, data=body, headers={"Content-Type": "text/xml; charset=utf-8"})


def track(tracking_id):
    envelope = f"""<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><Track><Id>{tracking_id}</Id></Track></soap:Body></soap:Envelope>"""
    return requests.post(SERVICE, data=envelope, headers={"Content-Type": 'application/soap+xml; charset=utf-8; action="http://example-carrier.com/Track"'})


def built(order_id):
    root = ET.Element("Order")
    ET.SubElement(root, "Id").text = order_id
    return requests.post("https://orders.example-shop.com/api/orders", data=ET.tostring(root), headers={"Content-Type": "application/xml"})


def queue():
    return requests.post("https://sqs.us-east-1.amazonaws.com/123456789012/jobs", data={"Action": "SendMessage", "MessageBody": "hello"})


def photos(tag):
    return requests.get("https://api.flickr.com/services/rest/", params={"method": "flickr.photos.search", "tags": tag, "format": "json"})


def page(title):
    html = f"<html><body><h1>{title}</h1></body></html>"
    return requests.post("https://render.example-docs.com/pdf", data=html, headers={"Content-Type": "text/html"})

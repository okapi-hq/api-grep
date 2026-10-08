import requests


class HubSpot:
    def __init__(self, token: str):
        self.session = requests.Session()
        self.token = token

    def contact(self, contact_id: str):
        return self.session.get(f"https://api.hubapi.com/crm/v3/objects/contacts/{contact_id}", headers={"Authorization": f"Bearer {self.token}"})


def send_sms(to: str, body: str):
    with requests.Session() as s:
        return s.post("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json", {"To": to, "Body": body}, auth=("AC123", "token"))

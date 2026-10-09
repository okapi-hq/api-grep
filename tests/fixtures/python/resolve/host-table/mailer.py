import requests

API_LOOKUP = {
    "us": "https://api.example-mailer.com/v3/",
    "eu": "https://api.eu.example-mailer.com/v3/",
}


class Mailer:
    def __init__(self, region, aws_region):
        self.region = region
        self.aws_region = aws_region

    def send(self, payload):
        return requests.post(API_LOOKUP[self.region] + "messages", data=payload)

    def publish(self, payload):
        return requests.post(f"https://sns.{self.aws_region}.amazonaws.com/", data=payload)

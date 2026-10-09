import requests


class BaseAPI:
    base_url = "http://localhost"

    def _get(self, path):
        return requests.get(self.base_url + path)

    def url(self, path):
        return self.base_url + path


class BillingAPI(BaseAPI):
    base_url = "https://billing.example.com/v2"

    def invoices(self):
        return self._get("/invoices")

    def refunds(self):
        return requests.post(self.url("/refunds"))

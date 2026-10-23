import os

import mercadopago
from mercadopago import SDK

sdk = mercadopago.SDK(os.environ["MP_ACCESS_TOKEN"])


def checkout(title, price):
    preference = {
        "items": [{"title": title, "quantity": 1, "unit_price": price}],
        "back_urls": {"success": "https://tidepool.example/ok"},
        "auto_return": "approved",
    }
    result = sdk.preference().create(preference)
    return result["response"]["init_point"]


def pay(token, amount, email):
    options = mercadopago.config.RequestOptions()
    options.custom_headers = {"x-idempotency-key": "tp-1"}
    data = {"transaction_amount": amount, "token": token, "installments": 1, "payer": {"email": email}}
    return sdk.payment().create(data, options)


def status(payment_id):
    return sdk.payment().get(payment_id)


def approved():
    return sdk.payment().search({"status": "approved", "limit": 20})


def refund(payment_id, amount):
    return sdk.refund().create(payment_id, {"amount": amount})


def shopper(email):
    customers = SDK(os.environ["MP_ACCESS_TOKEN"]).customer()
    customers.create({"email": email})
    return customers.search(filters={"email": email})


def subscribe(plan_id, email):
    return sdk.preapproval().create({"preapproval_plan_id": plan_id, "payer_email": email})


def order_capture(order_id):
    return sdk.order().capture(order_id)

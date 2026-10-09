import stripe
from stripe import StripeClient

stripe.api_key = "sk_test_placeholder"
client = StripeClient("sk_test_placeholder")


def create_customer(email: str):
    return stripe.Customer.create(email=email, name="Ada")


def intent(intent_id: str):
    return stripe.PaymentIntent.retrieve(intent_id)


def checkout(price: str):
    return stripe.checkout.Session.create(mode="subscription", line_items=[{"price": price, "quantity": 1}])


def modern(email: str):
    return client.customers.create(params={"email": email})


def modern_v1(sub_id: str):
    return client.v1.subscriptions.cancel(sub_id)

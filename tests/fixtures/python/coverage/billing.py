import stripe


def charge(customer: str, amount: int):
    return stripe.PaymentIntent.create(customer=customer, amount=amount, currency="eur")

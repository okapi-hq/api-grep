import shopify

from .models import Kite


def new_kite(title):
    kite = shopify.Product({"title": title, "vendor": "Example Kites"})
    kite.save()
    return kite


def rename_kite(kite_id, title):
    kite = shopify.Product.find(kite_id)
    kite.title = title
    kite.save()


def retag_kite(kite_id, tags):
    shopify.Product({"id": kite_id, "tags": tags}).save()


def drop_kite(kite_id):
    shopify.Product.find(kite_id).destroy()


def close_order(order_id):
    order = shopify.Order.find(order_id)
    order.close()


def colours(product_id):
    return shopify.Variant.find(product_id=product_id, limit=50)


def add_colour(product_id, colour):
    variant = shopify.Variant({"product_id": product_id, "option1": colour})
    variant.save()


def kite_notes(product_id):
    return shopify.Metafield.find(resource="products", resource_id=product_id)


def order_payments(order_id):
    return shopify.Transaction.find(order_id=order_id)


def remember_kite(title):
    """The app's own model, also saved with `save()`: a database write."""
    kite = Kite(title=title)
    kite.save()
    return kite

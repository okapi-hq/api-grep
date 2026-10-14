import shopify
from shopify import Order


def open_session(shop_url, token):
    session = shopify.Session(shop_url, "2024-07", token)
    shopify.ShopifyResource.activate_session(session)


def shop_name():
    return shopify.Shop.current().name


def recent_orders(limit):
    return Order.find(limit=limit, status="any")


def one_order(order_id):
    return Order.find(order_id)


def lamp_count():
    return shopify.Product.count(vendor="Example Lamps")


def new_page(title):
    return shopify.Page.create({"title": title, "body_html": "<p>soon</p>"})


def drop_webhook(webhook_id):
    return shopify.Webhook.delete(webhook_id)


class Ledger:
    """Not ShopifyAPI: a class of its own with a `find` method, given as an untyped parameter."""

    def find(self, key):
        return key


def lookup(books, key):
    return books.Order.find(key)

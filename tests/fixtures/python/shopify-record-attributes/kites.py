import shopify

from .models import Kite


def new_kite(title):
    kite = shopify.Product()
    kite.title = title
    kite.vendor = "Example Kites"
    kite.save()
    return kite


def tagged_kite(title, tags):
    kite = shopify.Product({"title": title})
    kite.tags = tags
    kite.save()
    return kite


def rename_kite(kite_id, title):
    kite = shopify.Product()
    kite.id = kite_id
    kite.title = title
    kite.save()


def retag_kite(kite_id, tags, featured):
    kite = shopify.Product.find(kite_id)
    kite.tags = tags
    if featured:
        kite.template_suffix = "featured"
    kite.save()


def remember_kite(title):
    """The app's own model, given its fields one by one too: a database write."""
    kite = Kite()
    kite.title = title
    kite.save()
    return kite

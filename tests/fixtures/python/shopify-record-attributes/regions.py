import shopify


def regions(country_id):
    return shopify.Province.find(country_id=country_id)


def retax_region(country_id, province_id, rate):
    region = shopify.Province.find(province_id, country_id=country_id)
    region.tax = rate
    region.save()


def top_up(card_id, amount):
    adjustment = shopify.GiftCardAdjustment({"gift_card_id": card_id})
    adjustment.amount = amount
    adjustment.note = "Kite festival refund"
    adjustment.save()

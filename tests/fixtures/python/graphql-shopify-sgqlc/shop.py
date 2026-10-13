import shopify


def low_stock(session, threshold):
    shopify.ShopifyResource.activate_session(session)
    query = """
    query LowStock($threshold: Int!) {
      productVariants(first: 50, query: "inventory_quantity:<10") { nodes { sku inventoryQuantity } }
    }
    """
    return shopify.GraphQL().execute(query, variables={"threshold": threshold})


def shop_name():
    client = shopify.GraphQL()
    return client.execute(query="{ shop { name currencyCode } }")

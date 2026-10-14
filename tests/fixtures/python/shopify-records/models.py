from django.db import models


class Kite(models.Model):
    title = models.CharField(max_length=200)


class Order(models.Model):
    """Named like ShopifyAPI's resource: closing it is a database write."""

    closed = models.BooleanField(default=False)

    def close(self):
        self.closed = True
        self.save()


def close_local(order_id):
    order = Order.objects.get(pk=order_id)
    order.close()

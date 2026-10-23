import os

from google.cloud import bigquery

client = bigquery.Client(project="orchard-metrics")


def daily_orders(day):
    job = client.query("SELECT sku, qty FROM `orchard-metrics.sales.orders` WHERE day = @day")
    return job.result()


def top_skus():
    return client.query_and_wait("SELECT sku FROM sales.top_skus LIMIT 10")


def record_events(rows):
    return client.insert_rows_json("orchard-metrics.telemetry.events", rows)


def record_clicks(rows):
    return client.insert_rows_json("telemetry.clicks", rows)


def record_env(rows):
    return client.insert_rows_json(os.environ["EVENTS_TABLE"], rows)


def describe(dataset):
    return client.get_table(f"{dataset}.orders")


def preview():
    return client.list_rows("sales.orders", max_results=20)


def drop_staging():
    client.delete_table("sales.orders_staging", not_found_ok=True)


def create(schema):
    return client.create_table(bigquery.Table("orchard-metrics.sales.returns", schema=schema))


def load_export(uri):
    return client.load_table_from_uri(uri, "sales.imports")


def load_frame(frame):
    return client.load_table_from_dataframe(frame, "sales.forecast")


def datasets():
    return client.get_dataset("archive.sales_2023"), client.list_datasets()

import json

from google.cloud import secretmanager, storage

client = storage.Client()


def save_report(report_id: str, report: dict) -> None:
    bucket = client.bucket("acme-reports")
    blob = bucket.blob(f"reports/{report_id}.json")
    blob.upload_from_string(json.dumps(report), content_type="application/json")


def load_report(report_id: str) -> dict:
    return json.loads(client.bucket("acme-reports").blob(f"reports/{report_id}.json").download_as_text())


def old_reports(prefix: str):
    return list(client.list_blobs("acme-reports", prefix=prefix))


def drop(report_id: str) -> None:
    client.get_bucket("acme-reports").delete_blob(f"reports/{report_id}.json")


secrets = secretmanager.SecretManagerServiceClient()


def api_key(project: str) -> str:
    name = f"projects/{project}/secrets/partner-api-key/versions/latest"
    return secrets.access_secret_version(request={"name": name}).payload.data.decode()


def signing_key() -> str:
    return secrets.access_secret_version(name="projects/acme/secrets/signing-key/versions/3").payload.data.decode()

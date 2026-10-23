import os

import sendgrid
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Content, Email, Mail, To

sg = SendGridAPIClient(os.environ["SENDGRID_API_KEY"])


def send_welcome(address, name):
    message = Mail(
        from_email="hello@lumen-notes.test",
        to_emails=address,
        subject="Welcome to Lumen Notes",
        html_content="<strong>Welcome aboard</strong>",
    )
    message.template_id = "d-5f1e0c2a9b7d4e3f"
    message.dynamic_template_data = {"first_name": name}
    return sg.send(message)


def send_digest(addresses, text):
    message = Mail(Email("digest@lumen-notes.test", "Lumen Digest"), [To(a) for a in addresses], "Your weekly digest", Content("text/plain", text))
    return sg.send(message)


def send_raw(address):
    data = {"personalizations": [{"to": [{"email": address}]}], "from": {"email": "ops@lumen-notes.test"}, "subject": "Report", "content": [{"type": "text/plain", "value": "ready"}]}
    return sg.client.mail.send.post(request_body=data)


def list_templates():
    return sg.client.templates.get(query_params={"generations": "dynamic", "page_size": 20})


def upsert_contact(address, city):
    return sg.client.marketing.contacts.put(request_body={"list_ids": ["a1b2"], "contacts": [{"email": address, "city": city}]})


def add_recipient(address):
    return sg.client.contactdb.recipients.post(request_body=[{"email": address}])


def forget_bounce(address):
    return sg.client.suppression.bounces._(address).delete()


def template_versions(template_id):
    return sg.client.templates._(template_id).versions.get()


eu = sendgrid.SendGridAPIClient(api_key=os.environ.get("SENDGRID_API_KEY"), host="https://api.eu.sendgrid.com")


def suppress(group_id, address):
    return eu.client.asm.groups._(group_id).suppressions.post({"recipient_emails": [address]})

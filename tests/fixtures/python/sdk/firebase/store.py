import firebase_admin
from firebase_admin import auth, credentials, firestore, messaging

firebase_admin.initialize_app(credentials.Certificate("service-account.json"))
db = firestore.client()


def users():
    return db.collection("users").stream()


def save(uid: str, data: dict):
    db.collection("users").document(uid).set(data)


def add_post(uid: str, text: str):
    return db.collection("users").document(uid).collection("posts").add({"text": text})


def signup(email: str):
    return auth.create_user(email=email, email_verified=False)


def notify(token: str):
    return messaging.send(messaging.Message(token=token, notification=messaging.Notification(title="Hi")))


def token(uid: str):
    return auth.create_custom_token(uid)

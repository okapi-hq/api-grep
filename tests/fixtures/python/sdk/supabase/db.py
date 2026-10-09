import os

from supabase import Client, create_client

supabase: Client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])


def open_tasks(user_id: str):
    return supabase.table("tasks").select("*").eq("user_id", user_id).eq("done", False).execute()


def add_task(title: str):
    return supabase.table("tasks").insert({"title": title, "done": False}).execute()


def upsert_profile(profile: dict):
    supabase.from_("profiles").upsert(profile).execute(); supabase.table("audit").insert({"event": "profile"}).execute()


def stats(day: str):
    return supabase.rpc("daily_stats", {"day": day}).execute()


def me():
    return supabase.auth.get_user()


def login(email: str, password: str):
    return supabase.auth.sign_in_with_password({"email": email, "password": password})


def avatar(path: str, data: bytes):
    return supabase.storage.from_("avatars").upload(path, data)


def welcome(user_id: str):
    return supabase.functions.invoke("send-welcome", invoke_options={"body": {"user_id": user_id}})


def remove(ctx, task_id: int):
    db: Client = ctx.db
    return db.table("tasks").delete().eq("id", task_id).execute()


def from_param(db: Client, name: str):
    return db.table("teams").select("id").eq("name", name).single().execute()

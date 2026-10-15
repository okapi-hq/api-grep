def pick_route(text: str) -> str:
    return "support" if "help" in text else "sales"

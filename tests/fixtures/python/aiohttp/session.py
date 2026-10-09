import aiohttp


async def send_email(to: str, subject: str):
    async with aiohttp.ClientSession() as session:
        async with session.post("https://api.sendgrid.com/v3/mail/send", json={"personalizations": [{"to": [{"email": to}]}], "subject": subject}) as resp:
            return await resp.json()


async def weather(lat: float, lon: float):
    async with aiohttp.ClientSession("https://api.open-meteo.com") as session:
        async with session.get("/v1/forecast", params={"latitude": lat, "longitude": lon}) as resp:
            return await resp.json()

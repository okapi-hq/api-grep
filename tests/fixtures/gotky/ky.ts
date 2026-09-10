import ky from "ky";

export function shorten(url: string) {
  return ky.post("https://api.dub.co/links", { json: { url, domain: "dub.sh" }, headers: { Authorization: `Bearer ${process.env.DUB_KEY}` } }).json();
}

const cal = ky.create({ prefixUrl: "https://api.cal.com/v1" });

export const bookings = () => cal.get("bookings", { searchParams: { apiKey: "x" } }).json();

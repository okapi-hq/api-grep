const API = "https://api.example-weather.com/v2/forecast";

export function forecastDefault(city: string, version = "2024-06-01") {
  return fetch(`${API}?city=${city}`, { headers: { "X-Api-Version": version } });
}

export function forecastPinned(city: string, version = "2024-06-01") {
  return fetch(`${API}?city=${city}`, { headers: { "X-Api-Version": version } });
}

export function forecastAny(city: string, version = "2024-06-01") {
  return fetch(`${API}?city=${city}`, { headers: { "X-Api-Version": version } });
}

export async function pinned(city: string) {
  await forecastPinned(city);
  return forecastPinned(city, "2025-01-15");
}

export async function anyVersion(city: string, requested: string) {
  await forecastAny(city);
  return forecastAny(city, requested);
}

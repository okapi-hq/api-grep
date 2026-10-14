export async function forecast(city: string) {
  return fetch(`${process.env.WEATHER_API_URL}/forecast?city=${city}`);
}

import { weather } from "./weather";

const RADAR = /* GraphQL */ `
  query Radar { radar { tiles } }
`;

export async function radar() {
  return weather.request(RADAR);
}

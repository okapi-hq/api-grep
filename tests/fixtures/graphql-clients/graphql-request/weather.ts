import { GraphQLClient, gql, rawRequest, request } from "graphql-request";

const ENDPOINT = "https://graph.example-weather.net/v2/graphql";

const FORECAST = gql`
  query Forecast($city: String!) { forecast(city: $city) { day high low } }
`;

export const weather = new GraphQLClient(ENDPOINT, { headers: { "x-api-key": process.env.WEATHER_KEY ?? "" } });

export const forecast = (city: string) => weather.request(FORECAST, { city });

export const alerts = () => weather.rawRequest(`query Alerts { alerts { level } }`, {}, { "x-trace": "1" });

export const stations = () => request("https://stations.example-weather.net/graphql", gql`{ stations { id } }`);

export const sensors = () => request({ url: ENDPOINT, document: gql`query Sensors { sensors { id } }` });

export const raw = () => rawRequest(ENDPOINT, FORECAST, { city: "Lyon" });

import { print } from "graphql";
import { gql } from "graphql-tag";
import { ArchivedPlantsDocument } from "./generated";

const API = "https://api.example-greenhouse.dev/graphql";

const RECENT_PLANTS = gql`
  query RecentPlants($cursor: String) {
    plants(first: 20, after: $cursor, sortKey: CREATED_AT, reverse: true, filter: { tags: ["fern", "moss"], price: { lt: 9.5 }, owner: null }) {
      nodes {
        id
        photos(size: 64) { url }
      }
    }
  }
`;

export function recentPlants(cursor: string | null) {
  return fetch(API, { method: "POST", body: JSON.stringify({ query: RECENT_PLANTS, variables: { cursor } }) });
}

export function plantCard(id: string) {
  const query = `query PlantCard { plant(id: "${id}") { name small: photo(size: 64) { url } large: photo(size: 512) { url } photo { url } } }`;
  return fetch(API, { method: "POST", body: JSON.stringify({ query }) });
}

export function signIn() {
  const query = `mutation SignIn { signIn(email: "gardener@example.com", password: "hunter2", device: { name: "kiosk", apiKey: "kiosk-1" }) { session { id } } }`;
  return fetch(API, { method: "POST", body: JSON.stringify({ query }) });
}

export function lookupInvite() {
  return fetch(API, { method: "POST", body: JSON.stringify({ query: `{ invite(code: "d41d8cd98f00b204e9800998ecf8427e") { id } }` }) });
}

export function archived() {
  return fetch(API, { method: "POST", body: JSON.stringify({ query: print(ArchivedPlantsDocument) }) });
}

export function names() {
  return fetch(API, { method: "POST", body: JSON.stringify({ query: "query PlantNames { plants { nodes { name } } }" }) });
}

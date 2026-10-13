import { gql } from "graphql-tag";
import { PROFILE_FIELDS } from "@example/profile-fragments";

const GET_PROFILE = gql`
  query GetProfile {
    profile { ...ProfileFields }
  }
  ${PROFILE_FIELDS}
`;

export const profile = () => fetch("https://api.example-store.com/graphql", { method: "POST", body: JSON.stringify({ query: GET_PROFILE }) });

export const nearby = (city: string, kind: string) => fetch("https://api.example-store.com/search", { method: "POST", body: JSON.stringify({ query: `${city} ${kind}` }) });

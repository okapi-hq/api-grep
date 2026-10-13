import { gql, useQuery } from "@apollo/client";
import { adminClient, storeClient } from "./clients";

const PLANTS = gql`
  query Plants { plants { id species } }
`;

const SEEDS = gql`
  query Seeds { seeds { id } }
`;

// two clients and no `client` option: the hook's endpoint is unknown
export const usePlants = () => useQuery(PLANTS);

export const useSeedsAsAdmin = () => useQuery(SEEDS, { client: adminClient });

export const plantCount = () => storeClient.query({ query: gql`{ plantCount }` });

export const unreadable = (doc: never) => storeClient.query({ query: doc });

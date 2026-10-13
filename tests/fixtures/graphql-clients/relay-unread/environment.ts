import axios from "axios";
import { graphql, useLazyLoadQuery } from "react-relay";
import { Environment, Network, RecordSource, Store } from "relay-runtime";

// the network layer sends through axios, not `fetch`: its endpoint is not read, and no host is guessed
const network = Network.create((params, variables) => axios.post("/api/graphql", { query: params.text, variables }).then((r) => r.data));

export const environment = new Environment({ network, store: new Store(new RecordSource()) });

export const useOrders = () => useLazyLoadQuery(graphql`query OrdersQuery { orders { id total } }`, {});

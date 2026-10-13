import { Environment, Network, RecordSource, Store, type FetchFunction } from "relay-runtime";
import { fetchGraphQL } from "./fetchGraphQL";

const fetchRelay: FetchFunction = async (params, variables) => fetchGraphQL(params.text ?? "", variables);

export default new Environment({ network: Network.create(fetchRelay), store: new Store(new RecordSource()) });

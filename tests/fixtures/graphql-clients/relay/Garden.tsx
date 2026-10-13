import { commitMutation, graphql, useLazyLoadQuery, useMutation, usePreloadedQuery, useRelayEnvironment, type PreloadedQuery } from "react-relay";
import { fetchQuery, requestSubscription } from "relay-runtime";
import environment from "./RelayEnvironment";
import CompostQuery from "./CompostQuery.graphql";
import SeedListQuery from "./SeedListQuery.graphql";

export function PlantList({ bed }: { bed: string }) {
  return useLazyLoadQuery(graphql`query PlantListQuery($bed: ID!) { bed(id: $bed) { plants { id name ...PlantCard_plant } } }`, { bed });
}

export const SeedList = ({ queryRef }: { queryRef: PreloadedQuery<any> }) => usePreloadedQuery(SeedListQuery, queryRef);

export const Compost = ({ queryRef }: { queryRef: PreloadedQuery<any> }) => usePreloadedQuery(CompostQuery, queryRef);

export function useWater() {
  const [commit] = useMutation(graphql`mutation WaterPlantMutation($id: ID!) { waterPlant(id: $id) { plant { id lastWatered } } }`);
  return commit;
}

export function useHarvest() {
  const env = useRelayEnvironment();
  return (id: string) => commitMutation(env, { mutation: graphql`mutation HarvestMutation($id: ID!) { harvest(id: $id) { weight } }`, variables: { id } });
}

export const forecast = () => fetchQuery(environment, graphql`query ForecastQuery { forecast { rain } }`, {}).toPromise();

export const watchFrost = () =>
  requestSubscription(environment, { subscription: graphql`subscription FrostAlertSubscription { frostAlert { level } }`, variables: {} });

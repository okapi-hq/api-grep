import React from "react";
import { QueryRenderer, createFragmentContainer, createPaginationContainer, createRefetchContainer, graphql, loadQuery } from "react-relay";
import environment from "./environment";

export function Orchard({ orchardId }) {
  return (
    <QueryRenderer
      environment={environment}
      query={graphql`
        query OrchardQuery($id: ID!) { orchard(id: $id) { name ...TreeList_orchard } }
      `}
      variables={{ id: orchardId }}
      render={({ props }) => (props ? <h1>{props.orchard.name}</h1> : null)}
    />
  );
}

export const harvestRef = (season) => loadQuery(environment, graphql`query HarvestQuery($season: String!) { harvest(season: $season) { weight } }`, { season });

export const seasonRef = (year) => loadQuery(environment, require("./SeasonQuery.graphql"), { year }, { fetchPolicy: "store-or-network" });

// a fragment container sends nothing by itself
export const TreeCard = createFragmentContainer(() => null, { tree: graphql`fragment TreeCard_tree on Tree { id name }` });

export const TreeDetails = createRefetchContainer(
  () => null,
  { tree: graphql`fragment TreeDetails_tree on Tree { id height }` },
  graphql`query TreeDetailsRefetchQuery($id: ID!) { node(id: $id) { ...TreeDetails_tree } }`,
);

export const TreeList = createPaginationContainer(
  () => null,
  { orchard: graphql`fragment TreeList_orchard on Orchard { trees(first: $count, after: $cursor) @connection(key: "TreeList_trees") { edges { node { id } } } }` },
  {
    getVariables: (props, { count, cursor }) => ({ count, cursor, id: props.orchard.id }),
    query: graphql`query TreeListPaginationQuery($id: ID!, $count: Int!, $cursor: String) { orchard(id: $id) { ...TreeList_orchard } }`,
  },
);

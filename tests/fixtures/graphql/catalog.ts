import { gql } from "@apollo/client";
import ListCategories from "./list-categories.graphql";
import { GetCategory } from "./categories.graphql";

const API = "https://api.example-catalog.com/graphql";

const ITEM_FIELDS = gql`
  fragment ItemFields on Item {
    id
    title
    price { amount currency }
    ... on DigitalItem { downloadUrl }
  }
`;

const LIST_ITEMS = gql`
  query ListItems($first: Int!) {
    items(first: $first) {
      nodes { ...ItemFields }
      pageInfo { hasNextPage }
    }
  }
  ${ITEM_FIELDS}
`;

export const listItems = () => fetch(API, { method: "POST", body: JSON.stringify({ query: LIST_ITEMS, variables: { first: 20 } }) });

export const listCategories = () => fetch(API, { method: "POST", body: JSON.stringify({ query: ListCategories }) });

export const getCategory = (id: string) => fetch(API, { method: "POST", body: JSON.stringify({ query: GetCategory, variables: { id } }) });

const TWO_OPERATIONS = gql`
  query CountItems { itemCount }
  query CountCategories { categoryCount }
`;

export const countCategories = () =>
  fetch(API, { method: "POST", body: JSON.stringify({ query: TWO_OPERATIONS, operationName: "CountCategories" }) });

export const countEither = () => fetch(API, { method: "POST", body: JSON.stringify({ query: TWO_OPERATIONS }) });

import { gql } from "@apollo/client";

export const LIST_CAKES = gql`
  query ListCakes($first: Int!) {
    cakes(first: $first) {
      id
      name
      price { amount }
    }
  }
`;

export const ORDER_CAKE = gql`
  mutation OrderCake($cakeId: ID!) {
    orderCake(cakeId: $cakeId) { id status }
  }
`;

export const OVEN_STATUS = gql`
  subscription OvenStatus { oven { temperature } }
`;

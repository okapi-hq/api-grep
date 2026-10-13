import { gql, useMutation, useQuery, useSubscription } from "urql";
import { client } from "./client";

const BOOKS = gql`
  query Books($shelf: String) { books(shelf: $shelf) { isbn title author { name } } }
`;

const BORROW = gql`
  mutation Borrow($isbn: String!) { borrow(isbn: $isbn) { dueDate } }
`;

export function useBooks(shelf: string) {
  return useQuery({ query: BOOKS, variables: { shelf } });
}

export function useBorrow() {
  return useMutation(BORROW);
}

export function useReturns() {
  return useSubscription({ query: gql`subscription Returns { returned { isbn } }` });
}

export async function borrowNow(isbn: string) {
  return client.mutation(BORROW, { isbn }).toPromise();
}

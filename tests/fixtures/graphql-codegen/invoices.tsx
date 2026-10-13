import { useMutation, useQuery, useSubscription } from "@apollo/client";
import { print } from "graphql";
import { request } from "graphql-request";
import { client } from "./client";
import { GetInvoiceDocument, InvoiceUpdatedDocument, ListInvoicesDocument, PayInvoiceDocument, ViewerDocument } from "./graphql";

const ENDPOINT = "https://api.example-invoicing.com/graphql";

export function getInvoice(id: string, token: string) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: print(GetInvoiceDocument), variables: { id } }),
  });
}

export function useInvoices() {
  return useQuery(ListInvoicesDocument, { variables: { first: 50 } });
}

export function usePayInvoice() {
  return useMutation(PayInvoiceDocument);
}

export function useInvoiceUpdates() {
  return useSubscription(InvoiceUpdatedDocument);
}

export async function payNow(id: string) {
  return client.mutate({ mutation: PayInvoiceDocument, variables: { id } });
}

export const viewer = () => request(ENDPOINT, ViewerDocument);

// an object with a `kind` is not a document unless it has `definitions`
export function saveNote(name: string) {
  return fetch("https://api.example-invoicing.com/notes", { method: "POST", body: JSON.stringify({ kind: "Document", name }) });
}

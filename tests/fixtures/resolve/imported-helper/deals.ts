import { apiUrl } from "./urls";

export function getDeal(id: string) {
  return fetch(apiUrl(`/deals/${id}`));
}

export function updateThing(id: number) {
  return fetch(process.env.API_URL + "/v1/things/" + id, {
    method: "PUT",
    body: JSON.stringify({ id, tags: ["a", "b"], nested: { deep: true, count: 2.5 } }),
  });
}

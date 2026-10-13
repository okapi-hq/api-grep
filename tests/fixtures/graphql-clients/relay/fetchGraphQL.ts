export async function fetchGraphQL(text: string, variables: Record<string, unknown>) {
  const response = await fetch("https://api.example-garden.dev/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GARDEN_TOKEN}` },
    body: JSON.stringify({ query: text, variables }),
  });
  return response.json();
}

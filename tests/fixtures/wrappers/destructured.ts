function request({ path, method }: { path: string; method: string }) {
  return fetch(`https://api.linear.app${path}`, { method });
}

export const gql = () => request({ path: "/graphql", method: "POST" });

import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function openIssues(owner: string, name: string) {
  return octokit.graphql(
    `query OpenIssues($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { issues(states: OPEN, first: 10) { nodes { number title } } }
    }`,
    { owner, name },
  );
}

export const viewer = () => octokit.graphql({ query: "{ viewer { login } }" });

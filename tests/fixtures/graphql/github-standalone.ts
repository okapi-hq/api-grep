import { graphql } from "@octokit/graphql";

export const releases = (owner: string, name: string) =>
  graphql(`query LatestRelease($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { latestRelease { tagName } } }`, {
    owner,
    name,
    headers: { authorization: `token ${process.env.GITHUB_TOKEN}` },
  });

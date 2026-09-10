import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export function openIssue(owner: string, repo: string, title: string) {
  return octokit.rest.issues.create({ owner, repo, title, body: "auto", labels: ["bug"] });
}

export const getRepo = (owner: string, repo: string) => octokit.request("GET /repos/{owner}/{repo}", { owner, repo });

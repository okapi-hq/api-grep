export async function listIssues(owner: string, repo: string, token: string) {
  const headers = { Authorization: `token ${token}`, Accept: "application/vnd.github+json" };
  return fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=50`, { headers });
}

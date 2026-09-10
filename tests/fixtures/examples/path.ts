export function getUser(userId: number, section: "posts" | "likes") {
  return fetch(`https://api.example.com/users/${userId}/${section}`);
}

export function removeMember(orgId: string, memberEmail: string) {
  return fetch(`https://api.example.com/orgs/${orgId}/members/${encodeURIComponent(memberEmail)}`, { method: "DELETE" });
}

export function dynamicHost(baseUrl: string, id: string) {
  return fetch(`${baseUrl}/v2/records/${id}`, { headers: { Authorization: `Bearer ${process.env.RECORDS_TOKEN}` } });
}

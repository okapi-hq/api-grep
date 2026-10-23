import { Client } from "@microsoft/microsoft-graph-client";

const client = Client.init({ authProvider: (done) => done(null, process.env.GRAPH_TOKEN ?? "") });

export async function latestMessages() {
  return client.api("/me/messages").select("subject,from").top(10).orderby("receivedDateTime desc").get();
}

export async function sendNotice(userId: string, subject: string) {
  await client.api(`/users/${userId}/sendMail`).post({ message: { subject, toRecipients: [] }, saveToSentItems: false });
}

export async function markRead(id: string) {
  const request = client.api(`/me/messages/${id}`);
  return request.patch({ isRead: true });
}

export async function removeMessage(id: string) {
  await client.api(`/me/messages/${id}`).del();
}

async function graphGet(path: string) {
  return client.api(path).get();
}

export const profile = () => graphGet("/me");

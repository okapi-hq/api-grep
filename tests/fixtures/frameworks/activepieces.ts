import { AuthenticationType, httpClient, HttpMethod } from "@activepieces/pieces-common";

export async function sendMessage(botToken: string, channel: string, text: string) {
  return httpClient.sendRequest({
    method: HttpMethod.POST,
    url: "https://slack.com/api/chat.postMessage",
    body: { channel, text },
    authentication: { type: AuthenticationType.BEARER_TOKEN, token: botToken },
  });
}

export async function listFiles(botToken: string, page: number) {
  return httpClient.sendRequest<{ files: unknown[] }>({
    method: HttpMethod.GET,
    url: "https://slack.com/api/files.list",
    queryParams: { page: String(page), count: "100" },
    headers: { Authorization: `Bearer ${botToken}` },
  });
}

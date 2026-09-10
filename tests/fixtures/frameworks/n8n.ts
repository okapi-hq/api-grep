interface IExecuteFunctions {
  helpers: { httpRequest(o: unknown): Promise<unknown>; httpRequestWithAuthentication: { call(t: unknown, cred: string, o: unknown): Promise<unknown> }; request(o: unknown): Promise<unknown> };
  getNodeParameter(name: string): string;
}

export async function githubApiRequest(this: IExecuteFunctions, method: string, endpoint: string, body: object, query?: { per_page?: number }) {
  const options = {
    method,
    headers: { "User-Agent": "n8n" },
    body,
    qs: query,
    uri: `https://api.github.com${endpoint}`,
    json: true,
  };
  return this.helpers.httpRequestWithAuthentication.call(this, "githubApi", options);
}

export class SlackNode {
  async execute(this: IExecuteFunctions) {
    const channel = this.getNodeParameter("channel");
    return this.helpers.httpRequest({
      method: "POST",
      url: "https://slack.com/api/chat.postMessage",
      body: { channel, text: "hello" },
      headers: { Authorization: `Bearer ${this.getNodeParameter("token")}` },
    });
  }
}

export class GithubNode {
  async execute(this: IExecuteFunctions) {
    const owner = this.getNodeParameter("owner");
    return githubApiRequest.call(this, "GET", `/repos/${owner}/issues`, {}, { per_page: 50 });
  }
}

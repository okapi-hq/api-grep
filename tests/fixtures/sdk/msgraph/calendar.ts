import { Client } from "@microsoft/microsoft-graph-client";
import type { AuthenticationProvider } from "@microsoft/microsoft-graph-client";

export class CalendarService {
  private graph: Client;

  constructor(provider: AuthenticationProvider) {
    this.graph = Client.initWithMiddleware({ authProvider: provider });
  }

  upcoming(userId: string, from: string) {
    return this.graph.api(`/users/${userId}/events`).version("beta").filter(`start/dateTime ge '${from}'`).expand("attachments").count().top(25).get();
  }

  groups() {
    return this.graph.api("/groups").query({ $search: '"displayName:harbor"' }).header("ConsistencyLevel", "eventual").get();
  }

  driveRoot() {
    return this.graph.api("https://graph.microsoft.com/beta/me/drive/root/children").get();
  }

  replaceSchedule(id: string, body: object) {
    return this.graph.api(`/me/calendars/${id}`).put(body);
  }
}

const sovereign = Client.init({ baseUrl: "https://graph.microsoft.us/", defaultVersion: "beta", authProvider: (done) => done(null, "") });

export const sovereignMe = () => sovereign.api("/me").get();

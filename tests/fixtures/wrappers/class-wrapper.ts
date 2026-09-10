import axios from "axios";

class NotionClient {
  private http = axios.create({ baseURL: "https://api.notion.com/v1" });

  post(path: string, data: object) {
    return this.http.post(path, data);
  }
}

const notion = new NotionClient();

export const createPage = (dbId: string) => notion.post("/pages", { parent: { database_id: dbId }, properties: {} });

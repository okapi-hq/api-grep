const BASE = "https://api.notion.com/v1";

export const getPage = (pageId: string) => fetch(`${BASE}/pages/${pageId}`, { headers: { "Notion-Version": "2022-06-28" } });

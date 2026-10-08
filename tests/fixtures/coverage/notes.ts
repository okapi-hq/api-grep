import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export const addNote = (databaseId: string, title: string) =>
  notion.pages.create({ parent: { database_id: databaseId }, properties: { Name: { title: [{ text: { content: title } }] } } });

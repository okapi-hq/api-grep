import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function addEntry(dataSourceId: string, title: string) {
  return notion.pages.create({ parent: { data_source_id: dataSourceId }, properties: { Name: { title: [{ text: { content: title } }] } } });
}

export const readEntry = (pageId: string) => notion.pages.retrieve({ page_id: pageId });

export const entries = (dataSourceId: string) => notion.dataSources.query({ data_source_id: dataSourceId, page_size: 50 });

export const content = (blockId: string) => notion.blocks.children.list({ block_id: blockId });

export const find = (text: string) => notion.search({ query: text });

// a local object with the same member names is not the SDK
const cache = { pages: { create: (x: unknown) => x } };
export const local = () => cache.pages.create({ id: 1 });

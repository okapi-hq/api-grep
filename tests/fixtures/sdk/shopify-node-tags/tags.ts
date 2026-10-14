import Shopify from "shopify-api-node";

const shop = new Shopify({ shopName: "example-kites", accessToken: process.env.KITE_TOKEN ?? "", apiVersion: "2024-07" });

interface TagQuery {
  limit?: number;
  popular?: number;
}

export async function blogTags(blogId: number) {
  return shop.article.tags(blogId, { limit: 20 });
}

export async function allTags() {
  return shop.article.tags({ popular: 1 });
}

export async function popularTags(query: TagQuery) {
  return shop.article.tags(query);
}

export async function tagsOf(blogId: number) {
  return shop.article.tags(blogId);
}

export async function everyTag() {
  return shop.article.tags(null, { limit: 250 });
}

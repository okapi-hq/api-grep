import { RequestedTokenType } from "@shopify/shopify-api";
import shopify from "./shopify.js";

export async function exchange(shop, sessionToken) {
  const { session } = await shopify.auth.tokenExchange({ shop, sessionToken, requestedTokenType: RequestedTokenType.OfflineAccessToken });
  return session;
}

export async function refresh(session) {
  const { session: fresh } = await shopify.auth.refreshToken({ shop: session.shop, refreshToken: session.refreshToken });
  return fresh;
}

export async function finishOAuth(req, res) {
  const { session } = await shopify.auth.callback({ rawRequest: req, rawResponse: res });
  return session;
}

/** Builds the redirect to Shopify's consent page: no request from the app. */
export async function startOAuth(req, res, shop) {
  return shopify.auth.begin({ shop, callbackPath: "/auth/callback", isOnline: false, rawRequest: req, rawResponse: res });
}

export async function proxy(req, res, session) {
  const response = await shopify.clients.graphqlProxy({ session, rawBody: req.body });
  res.status(200).send(response.body);
}

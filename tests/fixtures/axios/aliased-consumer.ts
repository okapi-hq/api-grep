import { hubspot } from "@app/client";

export const listDeals = () => hubspot.get("/crm/v3/objects/deals");

import { AdAccount, Campaign, FacebookAdsApi, User } from "facebook-nodejs-business-sdk";

FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);

const account = new AdAccount("act_4815162342");

export const listCampaigns = () => account.getCampaigns(["name", "status"], { limit: 25 });

export const launch = (name: string) => account.createCampaign([], { name, objective: "OUTCOME_SALES", status: "PAUSED" });

export const insights = () => account.getInsights(["spend", "impressions"], { date_preset: "last_7d" });

export async function pause(campaignId: string) {
  const campaign = new Campaign(campaignId);
  await campaign.get(["name"]);
  await campaign.update([], { status: "PAUSED" });
  return campaign.delete();
}

export const myAccounts = () => new User("me").getAdAccounts(["name"]);

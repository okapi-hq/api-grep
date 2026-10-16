// URLs that name an API's host without calling it: none counts in coverage.hosts
import chalk from "chalk";

export const BOTS = [
  { name: "Slackbot", url: "https://api.slack.com/robots", pattern: "Slackbot" },
  { name: "Ledgerbot", homepage: "https://api.ledger-demo.io/v1" },
];

export function signIn(res: { redirect(url: string): void }, clientId: string) {
  console.log(chalk.green(`Open https://api.ledger-demo.io/v1/status to check the service`));
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=code`);
  if (!clientId) throw new Error("Create a client at https://api.ledger-demo.io/v2/apps");
  return "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
}

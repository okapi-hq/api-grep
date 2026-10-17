import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });

export async function readBudget(spreadsheetId: string) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Budget!A1:D20" });
  return res.data.values;
}

export const appendRow = (spreadsheetId: string, row: string[]) =>
  sheets.spreadsheets.values.append({ spreadsheetId, range: "Log!A1", valueInputOption: "RAW", requestBody: { values: [row] } });

export async function listInvoices(folderId: string) {
  const drive = google.drive({ version: "v3", auth });
  return drive.files.list({ q: `'${folderId}' in parents`, fields: "files(id, name)" });
}

export const doc = (documentId: string) => google.docs({ version: "v1", auth }).documents.get({ documentId });

const bot = new google.auth.JWT({ email: process.env.BOT_EMAIL, key: process.env.BOT_KEY, scopes: ["https://www.googleapis.com/auth/chat.bot"] });
export const botToken = () => bot.authorize();

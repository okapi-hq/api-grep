const token = process.env.BOT_TOKEN;

const apiUrl = (method: string) => `https://api.telegram.org/bot${token}/${method}`;

export function notify(chatId: number, text: string) {
  return fetch(apiUrl("sendMessage"), { method: "POST", body: JSON.stringify({ chat_id: chatId, text }) });
}

function invoiceEndpoint(path: string) {
  return "https://api.mercury.example.com/v2" + path;
}

export const listInvoices = () => fetch(invoiceEndpoint("/invoices"));

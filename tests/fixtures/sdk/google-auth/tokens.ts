import { GoogleAuth, JWT, OAuth2Client } from "google-auth-library";

const serviceAccount = new JWT({
  email: process.env.SA_EMAIL,
  key: process.env.SA_KEY,
  scopes: ["https://www.googleapis.com/auth/chat.bot"],
});

export async function chatToken() {
  const { token } = await serviceAccount.getAccessToken();
  return token;
}

const oauth = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, "https://app.example.com/callback");

export const exchange = (code: string) => oauth.getToken(code);

export async function verify(idToken: string) {
  const ticket = await oauth.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}

// application default credentials: a metadata server or a key file, decided at run time
const adc = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
export const adcToken = () => adc.getAccessToken();

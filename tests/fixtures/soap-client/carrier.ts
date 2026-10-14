import * as soap from "soap";
import { createClientAsync } from "soap";
import path from "node:path";

const TRACK_WSDL = "https://ws.example-carrier.com/track?wsdl";

export async function track(id: string) {
  const client = await soap.createClientAsync(TRACK_WSDL);
  const [result] = await client.TrackAsync({ Id: id });
  return result;
}

export function cancel(id: string) {
  soap.createClient(TRACK_WSDL, (err, client) => {
    if (err) throw err;
    client.CancelShipment({ Id: id, Reason: "customer" }, () => undefined);
  });
}

export async function rates(zip: string) {
  const client = await createClientAsync("https://ws.example-carrier.com/rates.asmx?WSDL", { endpoint: "https://rates.example-carrier.com/soap" });
  client.addSoapHeader({ Token: "t" });
  client.describe();
  return client.RateService.RateSoap.GetRatesAsync({ Zip: zip });
}

export async function label(id: string) {
  const client = await soap.createClientAsync(path.join(__dirname, "wsdl", "labels.wsdl"));
  return client.PrintLabelAsync({ Id: id });
}

export async function labelLocal(id: string) {
  const client = await soap.createClientAsync("./wsdl/labels.wsdl");
  await client.UnknownOperationAsync({ Id: id });
  return client.VoidLabelAsync({ Id: id });
}

export class Archive {
  private client?: soap.Client;

  async store(docId: string) {
    this.client ??= await soap.createClientAsync(process.env.ARCHIVE_WSDL!);
    return this.client.StoreAsync({ DocumentId: docId });
  }
}

async function pickupClient() {
  return soap.createClientAsync("https://ws.example-carrier.com/pickup?wsdl");
}

export async function schedulePickup(date: string) {
  const client = await pickupClient();
  return client.SchedulePickupAsync({ Date: date });
}

export class CrmClient {
  constructor(private readonly token: string) {}

  private get baseUrl(): string {
    return "https://api.example-crm.com/v1";
  }

  listDeals() {
    return fetch(`${this.baseUrl}/deals`, { headers: { authorization: `Bearer ${this.token}` } });
  }
}

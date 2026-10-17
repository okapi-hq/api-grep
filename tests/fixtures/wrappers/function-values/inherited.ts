abstract class BaseProvider {
  protected abstract readonly baseUrl: string;

  protected async request(url: string, init: RequestInit = {}) {
    const res = await fetch(url, { ...init, headers: { authorization: "Bearer demo" } });
    return res.json();
  }
}

// the request is sent by a method the class inherits
export class QuoteProvider extends BaseProvider {
  protected readonly baseUrl = "https://api.quotely-demo.io";

  latest() {
    return this.request(`${this.baseUrl}/v1/quotes/latest`);
  }
}

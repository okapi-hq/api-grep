export class PartnerSync {
  constructor(private fetchFn: (url: string) => Promise<Response>) {}

  async push(url: string) {
    return this.fetchFn(url);
  }
}

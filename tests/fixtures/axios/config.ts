import axios from "axios";

export function charge(amount: number) {
  return axios({ method: "post", url: "https://api.stripe.com/v1/charges", data: { amount, currency: "usd" } });
}

export function request() {
  return axios.request({ url: "/v1/refunds", baseURL: "https://api.stripe.com", method: "POST", data: { charge: "ch_123" } });
}

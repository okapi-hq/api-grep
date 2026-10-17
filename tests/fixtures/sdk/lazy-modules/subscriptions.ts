type NativeSdk = { getCustomerInfo(): Promise<unknown>; restorePurchases(): Promise<unknown> };
type WebSdk = { Purchases: { configure(o: object): { getCustomerInfo(): Promise<unknown> } } };

// SDKs loaded on demand to keep the web bundle small
let NativeStore: NativeSdk | null = null;
let WebStore: WebSdk | null = null;

try {
  NativeStore = require("react-native-purchases").default as NativeSdk;
} catch {
  // not available on the web
}

const nativeStore = (): NativeSdk => {
  if (!NativeStore) throw new Error("store unavailable");
  return NativeStore;
};

async function loadWebStore() {
  if (WebStore) return WebStore;
  return import("@revenuecat/purchases-js").then((mod) => {
    WebStore = mod as unknown as WebSdk;
    return WebStore;
  });
}

export async function membership(onWeb: boolean) {
  if (!onWeb) return nativeStore().getCustomerInfo();
  await loadWebStore();
  const store = WebStore!.Purchases.configure({ apiKey: "rcb_demo", appUserId: "reader-1" });
  return store.getCustomerInfo();
}

export async function restore() {
  return NativeStore?.restorePurchases();
}

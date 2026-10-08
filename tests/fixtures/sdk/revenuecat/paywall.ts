import Purchases, { type PurchasesPackage } from "react-native-purchases";

export async function loadOfferings() {
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

export const buy = (pkg: PurchasesPackage) => Purchases.purchasePackage(pkg);

export const entitlements = () => Purchases.getCustomerInfo();

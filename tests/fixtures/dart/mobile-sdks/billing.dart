import 'package:purchases_flutter/purchases_flutter.dart';

class Membership {
  Future<void> start(String member) async {
    await Purchases.configure(PurchasesConfiguration('appl_kilnclub_demo')..appUserID = member);
  }

  Future<Offerings> plans() => Purchases.getOfferings();

  Future<CustomerInfo> status() => Purchases.getCustomerInfo();

  Future<void> join(Package package) async {
    await Purchases.purchasePackage(package);
  }

  Future<void> buy(StoreProduct product) async {
    await Purchases.purchase(PurchaseParams.storeProduct(product));
  }

  Future<CustomerInfo> restore() => Purchases.restorePurchases();

  Future<LogInResult> login(String member) => Purchases.logIn(member);

  Future<CustomerInfo> logout() => Purchases.logOut();

  Future<List<StoreProduct>> products() => Purchases.getProducts(['kiln_monthly']);
}

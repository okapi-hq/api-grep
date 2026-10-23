import 'package:flutter_stripe/flutter_stripe.dart';

void configureStripe() {
  Stripe.publishableKey = 'pk_test_kilnclub_demo';
}

class Checkout {
  Future<void> openSheet(String secret) async {
    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(paymentIntentClientSecret: secret, merchantDisplayName: 'Kiln Club'),
    );
    await Stripe.instance.presentPaymentSheet();
  }

  Future<PaymentMethod> card() => Stripe.instance.createPaymentMethod(params: const PaymentMethodParams.card(paymentMethodData: PaymentMethodData()));

  Future<PaymentIntent> pay(String secret) => Stripe.instance.confirmPayment(paymentIntentClientSecret: secret);

  Future<TokenData> token() => Stripe.instance.createToken(const CreateTokenParams.card(params: CardTokenParams()));

  Future<SetupIntent> saveCard(String secret) => Stripe.instance.confirmSetupIntent(paymentIntentClientSecret: secret, params: const PaymentMethodParams.card(paymentMethodData: PaymentMethodData()));

  Future<PaymentIntent> lookup(String secret) => Stripe.instance.retrievePaymentIntent(secret);

  Future<PaymentIntent> authenticate(String secret) => Stripe.instance.handleNextAction(secret);
}

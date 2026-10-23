import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:posthog_flutter/posthog_flutter.dart';

Future<void> boot() async {
  final config = PostHogConfig('phc_kilnclub_lite');
  config.host = 'https://analytics.kilnclub.example';
  await Posthog().setup(config);
}

Future<void> saveCard(String secret) async {
  await Stripe.instance.initPaymentSheet(
    paymentSheetParameters: SetupPaymentSheetParameters(setupIntentClientSecret: secret, merchantDisplayName: 'Kiln Club'),
  );
  await Stripe.instance.presentPaymentSheet();
  await Posthog().capture(eventName: 'card_saved');
}

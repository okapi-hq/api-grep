import 'package:posthog_flutter/posthog_flutter.dart';

Future<void> startAnalytics() async {
  final config = PostHogConfig('phc_kilnclub_demo')..host = 'https://eu.i.posthog.com';
  config.captureApplicationLifecycleEvents = true;
  await Posthog().setup(config);
}

class Tracker {
  final Posthog _posthog = Posthog();

  Future<void> firing(String glaze) => _posthog.capture(eventName: 'kiln_fired', properties: {'glaze': glaze});

  Future<void> opened() => Posthog().screen(screenName: 'studio');

  Future<void> signedIn(String member) async {
    await Posthog().identify(userId: member, userProperties: {'plan': 'potter'});
    await Posthog().alias(alias: member);
    await Posthog().group(groupType: 'studio', groupKey: 'east-wing');
  }

  Future<bool> beta() async {
    await Posthog().reloadFeatureFlags();
    return Posthog().isFeatureEnabled('glaze-lab');
  }

  Future<void> signedOut() => Posthog().reset();
}

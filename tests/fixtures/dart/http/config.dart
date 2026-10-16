import 'package:flutter_dotenv/flutter_dotenv.dart';

class TideConfig {
  static const String apiBase = 'https://api.tideplanner.example/v2';
  static const String openAiKey = String.fromEnvironment('OPENAI_API_KEY');
}

const String kMarineHost = 'marine.example-weather.org';

final String chartsBase = dotenv.env['CHARTS_URL'] ?? 'https://charts.tideplanner.example';

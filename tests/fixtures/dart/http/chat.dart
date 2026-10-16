import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';

final _client = http.Client();

/// Summarizes a tide report with a chat model.
Future<String> summarize(String text) async {
  final res = await _client.post(
    Uri.parse('https://api.openai.com/v1/chat/completions'),
    headers: {
      'Authorization': 'Bearer ${TideConfig.openAiKey}',
      'Content-Type': 'application/json',
    },
    body: json.encode({
      'model': 'gpt-4o-mini',
      'messages': [
        {'role': 'user', 'content': text},
      ],
    }),
  );
  return res.body;
}

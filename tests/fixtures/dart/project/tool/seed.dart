import 'dart:convert';

import 'package:field_notes/api/endpoints.dart';
import 'package:http/http.dart' as http;

Future<void> main(List<String> args) async {
  await http.post(
    Uri.parse('${Endpoints.base}/api/seed'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({'notes': args}),
  );
}

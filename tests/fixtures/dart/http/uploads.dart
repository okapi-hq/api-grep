import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';

Future<int> uploadLogbook(String token, String path, String harbor) async {
  final request = http.MultipartRequest('POST', Uri.parse('${TideConfig.apiBase}/logbooks'));
  request.headers['Authorization'] = 'Bearer $token';
  request.fields['harbor'] = harbor;
  request.files.add(await http.MultipartFile.fromPath('logbook', path));
  final response = await request.send();
  return response.statusCode;
}

Future<void> reportIncident(http.Client client, String kind) async {
  var req = http.Request('PUT', Uri.parse('${TideConfig.apiBase}/incidents'));
  req.headers.addAll({'Content-Type': 'application/json'});
  req.body = jsonEncode({'kind': kind});
  await client.send(req);
}

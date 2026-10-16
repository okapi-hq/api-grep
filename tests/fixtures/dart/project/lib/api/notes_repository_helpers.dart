part of 'notes_repository.dart';

Map<String, String> _headers() => {'X-Client': 'field-notes'};

Future<http.Response> ping() => http.head(Uri.parse('${Endpoints.base}/ping'));

import 'package:http/http.dart' as http;

import 'endpoints.dart';

part 'notes_repository_helpers.dart';

class NotesRepository {
  Future<http.Response> fetch(String id) => http.get(Uri.parse(Endpoints.note(id)), headers: _headers());
}

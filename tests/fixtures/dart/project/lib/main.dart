import 'package:field_notes/api/api.dart';
import 'package:http/http.dart' as http;
import 'package:notes_shared/shared.dart';

Future<void> main() async {
  final repo = NotesRepository();
  await repo.fetch('welcome');
  await http.get(Uri.parse('$sharedHost/status'));
}

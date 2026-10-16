import 'package:http/http.dart' as http;

void cached() => http.get(Uri.parse('https://cache.fieldnotes.example/never'));

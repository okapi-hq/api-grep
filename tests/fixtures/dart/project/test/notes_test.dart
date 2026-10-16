import 'package:http/http.dart' as http;

void main() {
  http.get(Uri.parse('https://test.fieldnotes.example/never'));
}

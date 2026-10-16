import 'package:url_launcher/url_launcher.dart';

/// A local cache keyed by URL: its `get` and `post` send nothing.
class PageCache {
  final Map<String, String> _pages = {};

  String? get(String url) => _pages[url];

  void post(String url, String body) => _pages[url] = body;
}

final cache = PageCache();

Future<void> openHelp() async {
  await launchUrl(Uri.parse('https://help.lanternnotes.example/getting-started'));
}

void remember() {
  cache.post('https://api.lanternnotes.example/v1/notes', '{}');
  final page = cache.get('https://api.lanternnotes.example/v1/notes');
  print('GET https://api.lanternnotes.example/v1/notes -> $page');
  // http.post(Uri.parse('https://api.lanternnotes.example/v1/old'));
}

class Router {
  void get(String path, void Function() handler) {}
}

void routes(Router router) {
  router.get('/notes', () {});
}

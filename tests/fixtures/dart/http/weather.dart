import 'package:http/http.dart';

import 'config.dart';

Future<Response> forecast(String harbor, int days) {
  final uri = Uri.https(kMarineHost, '/v1/forecast', {'harbor': harbor, 'days': '$days'});
  return get(uri, headers: {'User-Agent': 'tide-planner'});
}

class ChartsApi {
  Future<Response> _get(String path) => get(Uri.parse('$chartsBase$path'));

  Future<Response> stations() => _get('/stations');

  Future<Response> station(String id) => _get('/stations/$id');
}

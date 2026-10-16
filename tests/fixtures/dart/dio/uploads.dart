import 'package:dio/dio.dart' as d;

final uploader = d.Dio();

Future<void> uploadLabel(String path) async {
  final form = d.FormData.fromMap({'file': await d.MultipartFile.fromFile(path), 'kind': 'label'});
  await uploader.post('https://files.parcelhub.example/upload', data: form);
}

Future<void> ping() async {
  final dio = d.Dio()..options.connectTimeout = const Duration(seconds: 3);
  await dio.head('https://status.parcelhub.example/health');
}

import 'package:dio/dio.dart';

class ParcelApiClient {
  ParcelApiClient(String token)
      : _dio = Dio(
          BaseOptions(
            baseUrl: 'https://api.parcelhub.example/v1',
            connectTimeout: const Duration(seconds: 10),
            headers: {'Authorization': 'Bearer $token', 'Accept': 'application/json'},
          ),
        );

  final Dio _dio;

  Future<Response<dynamic>> track(String code) => _dio.get('/parcels/$code', queryParameters: {'lang': 'en'});

  Future<Response<dynamic>> create(Map<String, dynamic> parcel) => _dio.post('/parcels', data: parcel);

  Future<void> cancel(String code, String reason) async {
    await _dio.patch(
      '/parcels/$code',
      data: {'status': 'cancelled', 'reason': reason},
      options: Options(headers: {'X-Request-Source': 'app'}),
    );
  }

  Future<void> remove(String code) => _dio.request('/parcels/$code', options: Options(method: 'DELETE'));
}

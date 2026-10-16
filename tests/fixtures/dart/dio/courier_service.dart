import 'package:dio/dio.dart';

class CourierService {
  final Dio _dio = Dio();
  String? _token;

  CourierService() {
    _dio.options.baseUrl = 'https://couriers.parcelhub.example/api/';
    _dio.options.headers['Accept-Language'] = 'en';
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (_token != null) {
            options.headers['Authorization'] = 'Bearer $_token';
          }
          handler.next(options);
        },
      ),
    );
    _dio.interceptors.add(DeviceInterceptor());
  }

  Future<Response<dynamic>> couriers() => _dio.get('couriers', queryParameters: {'active': true});

  Future<Response<dynamic>> assign(String parcel, String courier) {
    return _dio.post('assignments', data: {'parcel': parcel, 'courier': courier});
  }
}

class DeviceInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.headers.addAll({'X-Device': 'handheld'});
    super.onRequest(options, handler);
  }
}

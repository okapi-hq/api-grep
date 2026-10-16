import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:get_it/get_it.dart';

final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(BaseOptions(baseUrl: 'https://depots.parcelhub.example/api'));
  return dio;
});

class DepotRepository {
  DepotRepository(this._dio);

  final Dio _dio;

  Future<Response<dynamic>> depots() => _dio.get('/depots');
}

final depotRepositoryProvider = Provider((ref) => DepotRepository(ref.watch(dioProvider)));

final getIt = GetIt.instance;

void setupLocator() {
  getIt.registerLazySingleton<Dio>(() => Dio(BaseOptions(baseUrl: 'https://routes.parcelhub.example')));
}

Future<void> optimize(List<String> stops) async {
  await getIt<Dio>().post('/optimize', data: {'stops': stops});
}

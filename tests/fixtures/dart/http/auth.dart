import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';

class AuthApi {
  Future<String?> signIn(String email, String password) async {
    final response = await http.post(
      Uri.parse('${TideConfig.apiBase}/auth/sign-in'),
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    if (response.statusCode != 200) return null;
    return jsonDecode(response.body)['token'] as String?;
  }

  Future<void> register(String name, String email) async {
    await http.post(
      Uri.parse(TideConfig.apiBase + '/auth/register'),
      body: {'name': name, 'email': email},
    );
  }

  Future<http.Response> profile(String token) {
    return http.get(
      Uri.parse('${TideConfig.apiBase}/me'),
      headers: {'Authorization': 'Bearer $token'},
    );
  }
}

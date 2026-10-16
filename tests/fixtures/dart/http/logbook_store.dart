import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> bootstrap() async {
  await Supabase.initialize(url: 'https://tideplanner-demo.supabase.co', anonKey: 'public-anon-key');
}

final supabase = Supabase.instance.client;

class LogbookStore {
  LogbookStore(this._db);

  final SupabaseClient _db;

  Future<List<Map<String, dynamic>>> entries(String harbor) {
    return _db.from('logbook_entries').select('id, harbor, note').eq('harbor', harbor).order('created_at');
  }

  Future<void> add(String harbor, String note) async {
    await supabase.from('logbook_entries').insert({'harbor': harbor, 'note': note});
  }

  Future<void> signIn(String email, String password) async {
    await Supabase.instance.client.auth.signInWithPassword(email: email, password: password);
  }

  Future<void> attach(String path, List<int> bytes) async {
    await supabase.storage.from('logbook-photos').uploadBinary(path, bytes);
  }

  Future<dynamic> tideStats(String harbor) => supabase.rpc('tide_stats', params: {'harbor_name': harbor});
}

class Endpoints {
  static const base = 'https://notes.fieldnotes.example';

  static String note(String id) => '$base/api/notes/$id';
}

import 'api.dart';
import 'offline_cache.dart';

Map<String, dynamic> decodeCachedNote(Object? value) {
  if (value is! Map) throw const FormatException('Invalid cached note');
  return Map<String, dynamic>.from(value);
}

List<Map<String, dynamic>> decodeCachedNotes(Object? value) {
  if (value is! List) throw const FormatException('Invalid cached notes');
  return value.map(decodeCachedNote).toList();
}

OfflineResource<Map<String, dynamic>> noteResource(
  MulticaApi api,
  String machine,
  String id,
) => OfflineResource(
  scope: OfflineCacheScope.capture(api, machine: machine),
  key: 'note:$id',
  decode: decodeCachedNote,
);

/// Flutter port of Multica IM's im-search-utils.rankChats. Network and local
/// message hits share one row per chat; authoritative network hits replace
/// local counts so matching the same message twice never boosts its rank.
List<Map<String, dynamic>> rankConversationSearch(
  List<Map<String, dynamic>> chats,
  List<Map<String, dynamic>> localHits,
  List<Map<String, dynamic>> networkHits,
  String query,
) {
  final hits = <Object?, Map<String, dynamic>>{
    for (final hit in localHits) hit['chat_id']: hit,
    for (final hit in networkHits) hit['chat_id']: hit,
  };
  final rows = <Map<String, dynamic>>[];
  for (final chat in chats) {
    final titleHits = countConversationMatches(
      chat['title'] as String? ?? '',
      query,
    );
    final hit = hits[chat['id']];
    if (titleHits == 0 && hit == null) continue;
    rows.add({
      ...chat,
      '_title_match': titleHits > 0,
      '_hits': titleHits + (hit?['hit_count'] as int? ?? 0),
      '_snippet': hit?['snippet'] ?? '',
    });
  }
  rows.sort((a, b) {
    final title = (b['_title_match'] == true ? 1 : 0).compareTo(
      a['_title_match'] == true ? 1 : 0,
    );
    if (title != 0) return title;
    final count = (b['_hits'] as int).compareTo(a['_hits'] as int);
    if (count != 0) return count;
    return '${b['last_comment_at'] ?? b['created_at'] ?? ''}'.compareTo(
      '${a['last_comment_at'] ?? a['created_at'] ?? ''}',
    );
  });
  return rows;
}

int countConversationMatches(String text, String query) {
  final q = query.toLowerCase();
  if (q.isEmpty) return 0;
  final haystack = text.toLowerCase();
  var count = 0;
  for (
    var at = haystack.indexOf(q);
    at >= 0;
    at = haystack.indexOf(q, at + q.length)
  ) {
    count++;
  }
  return count;
}

Map<String, dynamic>? findDirectConversation(
  List<Map<String, dynamic>> chats,
  String? userId,
  String type,
  String id,
) {
  Map<String, dynamic>? found;
  for (final chat in chats) {
    final members = (chat['members'] as List? ?? [])
        .whereType<Map<String, dynamic>>();
    if (chat['is_direct'] != true ||
        userId == null ||
        !members.any(
          (m) => m['member_type'] == 'member' && m['member_id'] == userId,
        )) {
      continue;
    }
    final peer = members
        .where(
          (m) => !(m['member_type'] == 'member' && m['member_id'] == userId),
        )
        .firstOrNull;
    if (peer?['member_type'] != type || peer?['member_id'] != id) continue;
    if (found == null ||
        '${chat['created_at'] ?? ''}'.compareTo(
              '${found['created_at'] ?? ''}',
            ) <
            0) {
      found = chat;
    }
  }
  return found;
}

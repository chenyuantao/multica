import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/conversation_search.dart';

void main() {
  test(
    'uses IM title, count, activity ranking and authoritative network counts',
    () {
      Map<String, dynamic> chat(String id, String title, String at) => {
        'id': id,
        'title': title,
        'last_comment_at': at,
      };
      final chats = [
        chat('body', 'Other', '2026-11-03'),
        chat('old', 'Plan', '2026-11-01'),
        chat('new', 'Plan', '2026-11-02'),
      ];
      final rows = rankConversationSearch(
        chats,
        [
          {'chat_id': 'body', 'hit_count': 50, 'snippet': 'cached plan'},
          {'chat_id': 'old', 'hit_count': 100, 'snippet': 'cached'},
        ],
        [
          {'chat_id': 'old', 'hit_count': 0, 'snippet': 'network'},
          {'chat_id': 'outside', 'hit_count': 1000, 'snippet': 'ignored'},
        ],
        'plan',
      );
      expect(rows.map((r) => r['id']), ['new', 'old', 'body']);
      expect(rows[1]['_hits'], 1);
      expect(rows[1]['_snippet'], 'network');
      expect(countConversationMatches('PLAN plan plans', 'plan'), 3);
    },
  );

  test(
    'direct lookup keeps type identity and oldest peer chat, excluding groups',
    () {
      Map<String, dynamic> chat(
        String id,
        String type,
        String at, {
        bool direct = true,
      }) => {
        'id': id,
        'is_direct': direct,
        'created_at': at,
        'members': [
          {'member_type': 'member', 'member_id': 'me'},
          {'member_type': type, 'member_id': 'peer'},
        ],
      };
      final chats = [
        chat('group', 'agent', '0', direct: false),
        chat('new', 'agent', '2'),
        chat('person', 'member', '1'),
        chat('old', 'agent', '1'),
      ];
      expect(
        findDirectConversation(chats, 'me', 'agent', 'peer')?['id'],
        'old',
      );
      expect(
        findDirectConversation(chats, 'me', 'member', 'peer')?['id'],
        'person',
      );
      expect(findDirectConversation(chats, 'other', 'agent', 'peer'), isNull);
    },
  );
}

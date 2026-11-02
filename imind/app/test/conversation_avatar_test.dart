import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/conversation_avatar.dart';

const selfId = 'self';

Map<String, dynamic> member(String id) => {
  'member_type': 'member',
  'member_id': id,
};

Map<String, dynamic> agent(String id) => {
  'member_type': 'agent',
  'member_id': id,
};

List<ConversationActor> select(
  List<Map<String, dynamic>> members, {
  String? userId = selfId,
  bool direct = false,
}) => conversationAvatarActors(
  members: members,
  currentUserId: userId,
  isDirect: direct,
);

void main() {
  group('ConversationActorAvatar rendering', () {
    Widget host(Widget child) => MaterialApp(
      home: Scaffold(body: Center(child: child)),
    );

    testWidgets('renders avatar emojis and exposes the profile name', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(
          const ConversationActorAvatar(
            actor: ConversationActor(type: 'agent', id: 'a'),
            profiles: {
              'agent:a': {'name': 'Helper', 'avatar_url': 'emoji: 🚀 '},
            },
            baseUrl: 'https://api.example.test',
          ),
        ),
      );

      expect(find.text('🚀'), findsOneWidget);
      final semantics = tester.widget<Semantics>(
        find.byWidgetPredicate(
          (widget) =>
              widget is Semantics && widget.properties.label == 'Helper',
        ),
      );
      expect(semantics.properties.image, isTrue);
    });

    testWidgets(
      'uses member initials and the web URL rule for profile images',
      (tester) async {
        await tester.pumpWidget(
          host(
            const ConversationActorAvatar(
              actor: ConversationActor(type: 'member', id: 'm'),
              profiles: {
                'member:m': {
                  'name': 'Ada Lovelace',
                  'avatar_url': '/uploads/ada.png',
                },
              },
              baseUrl: 'https://api.example.test/prefix',
            ),
          ),
        );
        final image = tester.widget<Image>(find.byType(Image));
        expect(
          (image.image as NetworkImage).url,
          'https://api.example.test/uploads/ada.png',
        );

        await tester.pumpWidget(
          host(
            const ConversationActorAvatar(
              actor: ConversationActor(type: 'member', id: 'm'),
              profiles: {
                'member:m': {'name': 'Ada Lovelace'},
              },
              baseUrl: 'https://api.example.test',
            ),
          ),
        );
        expect(find.text('AL'), findsOneWidget);
      },
    );

    testWidgets('falls back to initials when an avatar image cannot load', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(
          const ConversationActorAvatar(
            actor: ConversationActor(type: 'member', id: 'm'),
            profiles: {
              'member:m': {
                'name': 'Lee',
                'avatar_url': 'https://example.invalid/missing.png',
              },
            },
            baseUrl: 'https://api.example.test',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('L'), findsOneWidget);
    });
  });

  group('conversationAvatarActors', () {
    test('returns an empty set for no participants', () {
      expect(select([]), isEmpty);
    });

    test('keeps a sole actor as the single avatar', () {
      expect(select([agent('a')]), [
        const ConversationActor(type: 'agent', id: 'a'),
      ]);
    });

    test('uses the peer for a direct chat only when self is present', () {
      expect(select([member(selfId), agent('peer')], direct: true), [
        const ConversationActor(type: 'agent', id: 'peer'),
      ]);
      expect(select([agent('peer')], direct: true), [
        const ConversationActor(type: 'agent', id: 'peer'),
      ]);
    });

    test('keeps all actors through four, appending self last', () {
      final actors = select([
        member('m1'),
        agent('a1'),
        member(selfId),
        agent('a2'),
      ]);
      expect(actors.map((actor) => actor.key), [
        'member:m1',
        'agent:a1',
        'agent:a2',
        'member:self',
      ]);
    });

    test('selects the first eight other actors and self as the ninth', () {
      final members = [
        for (var index = 1; index <= 12; index++) agent('a$index'),
        member(selfId),
      ];
      final actors = select(members);
      expect(actors, hasLength(9));
      expect(actors.first.key, 'agent:a1');
      expect(actors[7].key, 'agent:a8');
      expect(actors.last.key, 'member:self');
    });

    test(
      'caps groups without self at nine and keeps same ids type-distinct',
      () {
        final actors = select([
          member('shared'),
          agent('shared'),
          for (var index = 1; index <= 10; index++) agent('a$index'),
        ], userId: null);
        expect(actors, hasLength(9));
        expect(actors.take(2).map((actor) => actor.key), [
          'member:shared',
          'agent:shared',
        ]);
        expect(actors.toSet(), hasLength(actors.length));
      },
    );

    test('a direct chat needs the actual current member rather than an arbitrary member', () {
      final actors = select([
        member('someone-else'),
        agent('bot'),
      ], direct: true);
      expect(actors.map((actor) => actor.key), [
        'member:someone-else',
        'agent:bot',
      ]);
    });
  });

  testWidgets('centers the incomplete final row of a five-actor mosaic', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: ConversationAvatar(
              actors: [
                for (var index = 1; index <= 5; index++)
                  ConversationActor(type: 'agent', id: 'a$index'),
              ],
              profiles: const {},
              baseUrl: 'https://api.example.test',
            ),
          ),
        ),
      ),
    );

    final fourth = tester.getRect(find.byKey(const ValueKey('agent:a4')));
    final fifth = tester.getRect(find.byKey(const ValueKey('agent:a5')));
    final mosaic = tester.getRect(find.byType(ConversationAvatar));
    expect(
      (fourth.center.dx + fifth.center.dx) / 2,
      closeTo(mosaic.center.dx, .01),
    );
  });
}

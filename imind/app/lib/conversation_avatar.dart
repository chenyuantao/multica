import 'package:flutter/material.dart';

/// One actor in a group conversation. Type is part of identity because member
/// and agent IDs occupy separate namespaces.
class ConversationActor {
  const ConversationActor({required this.type, required this.id});

  final String type;
  final String id;

  String get key => '$type:$id';

  @override
  bool operator ==(Object other) =>
      other is ConversationActor && other.type == type && other.id == id;

  @override
  int get hashCode => Object.hash(type, id);
}

/// Mirrors the web chat sidebar's avatar selection, including the requirement
/// that a direct chat contain the actual current member before it is treated
/// as a peer avatar.
List<ConversationActor> conversationAvatarActors({
  required List<Map<String, dynamic>> members,
  required String? currentUserId,
  required bool isDirect,
}) {
  bool self(Map<String, dynamic> member) =>
      member['member_type'] == 'member' &&
      currentUserId != null &&
      member['member_id'] == currentUserId;

  final hasSelf = members.any(self);
  if (isDirect && hasSelf) {
    final peer = members.where((member) => !self(member)).firstOrNull;
    if (peer != null) return [_actor(peer)];
  }

  final own = hasSelf ? members.firstWhere(self) : null;
  final others = members.where((member) => !self(member));
  final shown = <Map<String, dynamic>>[
    ...others.take(own == null ? 9 : 8),
    ?own,
  ];
  return shown.map(_actor).toList(growable: false);
}

ConversationActor _actor(Map<String, dynamic> member) => ConversationActor(
  type: member['member_type'] as String,
  id: member['member_id'] as String,
);

/// Flutter rendering of the web ActorAvatar primitive for member/agent actors.
/// Profiles are passed in so callers can load each directory once per list.
class ConversationActorAvatar extends StatelessWidget {
  const ConversationActorAvatar({
    super.key,
    required this.actor,
    required this.profiles,
    required this.baseUrl,
    this.size = 40,
    this.square = false,
  });

  final ConversationActor actor;
  final Map<String, Map<String, dynamic>> profiles;
  final String baseUrl;
  final double size;
  final bool square;

  @override
  Widget build(BuildContext context) {
    final profile = profiles[actor.key];
    final name = _name(profile, actor.type);
    final avatarUrl = profile?['avatar_url'];
    final emoji = avatarUrl is String && avatarUrl.startsWith('emoji:')
        ? avatarUrl.substring('emoji:'.length).trim()
        : '';
    final imageUrl =
        avatarUrl is String && avatarUrl.isNotEmpty && emoji.isEmpty
        ? (avatarUrl.startsWith('/')
              ? Uri.tryParse(baseUrl)?.resolve(avatarUrl).toString()
              : avatarUrl)
        : null;
    final radius = square ? 2.0 : 6.0;
    const muted = Color(0xFFF4F4F5);
    const mutedForeground = Color(0xFF71717A);

    Widget fallback() => Container(
      color: muted,
      alignment: Alignment.center,
      child: actor.type == 'agent'
          ? Icon(
              Icons.smart_toy_outlined,
              size: size * .55,
              color: mutedForeground,
            )
          : Text(
              _initials(name),
              maxLines: 1,
              style: TextStyle(
                fontSize: size * .45,
                fontWeight: FontWeight.w500,
                color: mutedForeground,
              ),
            ),
    );

    return Semantics(
      label: name,
      image: true,
      child: ExcludeSemantics(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(radius),
          child: SizedBox(
            width: size,
            height: size,
            child: emoji.isNotEmpty
                ? Container(
                    color: muted,
                    alignment: Alignment.center,
                    child: Text(emoji, style: TextStyle(fontSize: size * .58)),
                  )
                : imageUrl != null
                ? Image.network(
                    imageUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => fallback(),
                  )
                : fallback(),
          ),
        ),
      ),
    );
  }
}

/// Forty-pixel messenger mosaic matching chat-sidebar.tsx (2px padding,
/// 1.5px gaps, two columns through four actors and three thereafter).
class ConversationAvatar extends StatelessWidget {
  const ConversationAvatar({
    super.key,
    required this.actors,
    required this.profiles,
    required this.baseUrl,
    this.size = 40,
  });

  final List<ConversationActor> actors;
  final Map<String, Map<String, dynamic>> profiles;
  final String baseUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (actors.length <= 1) {
      return actors.isEmpty
          ? Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                color: const Color(0xFFF4F4F5),
                borderRadius: BorderRadius.circular(6),
              ),
            )
          : ConversationActorAvatar(
              actor: actors.single,
              profiles: profiles,
              baseUrl: baseUrl,
              size: size,
            );
    }
    final columns = actors.length <= 4 ? 2 : 3;
    final tile = (size - 4 - (columns - 1) * 1.5) / columns;
    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: const Color(0xFFE4E4E7),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Wrap(
        alignment: WrapAlignment.center,
        runAlignment: WrapAlignment.center,
        spacing: 1.5,
        runSpacing: 1.5,
        children: [
          for (final actor in actors)
            ConversationActorAvatar(
              key: ValueKey(actor.key),
              actor: actor,
              profiles: profiles,
              baseUrl: baseUrl,
              size: tile,
              square: true,
            ),
        ],
      ),
    );
  }
}

String _name(Map<String, dynamic>? profile, String type) {
  final candidate = type == 'agent'
      ? (profile?['custom_name'] ?? profile?['name'])
      : profile?['name'];
  return candidate is String && candidate.trim().isNotEmpty
      ? candidate.trim()
      : type == 'agent'
      ? 'Unknown Agent'
      : 'Unknown';
}

String _initials(String name) => name
    .split(' ')
    .map((word) => word.isEmpty ? '' : word.characters.first)
    .join()
    .toUpperCase()
    .characters
    .take(2)
    .join();

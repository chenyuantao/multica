import 'dart:async';

import 'package:flutter/material.dart';

import 'ai_chat.dart';
import 'api.dart';
import 'action_button.dart';
import 'chat_time.dart';
import 'chat_unread.dart';
import 'conversation_avatar.dart';
import 'conversation_search.dart';
import 'home_chrome.dart';
import 'offline_cache.dart';

/// Lists the conversations the current member has joined in this workspace.
class ConversationsPage extends StatefulWidget {
  const ConversationsPage({
    super.key,
    required this.api,
    required this.machine,
  });

  final MulticaApi api;
  final String? machine;

  @override
  State<ConversationsPage> createState() => _ConversationsPageState();
}

class _ConversationsPageState extends State<ConversationsPage>
    with WidgetsBindingObserver {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  late OfflineResource<List<Map<String, dynamic>>> _chatResource;
  bool _listReady = false;
  Object? _listError;
  Future<_Contacts>? _contacts;
  StreamSubscription<Map<String, dynamic>>? _eventSubscription;
  Timer? _refreshTimer;
  Map<String, Map<String, dynamic>> _profiles = const {};
  String? _currentUserId;
  int _profileLoadGeneration = 0;
  var _searching = false;
  var _openingContact = false;
  final _searchInput = TextEditingController();
  Timer? _searchTimer;
  int _searchGeneration = 0;
  List<Map<String, dynamic>> _loadedChats = [];
  List<Map<String, dynamic>> _networkHits = [];
  List<Map<String, dynamic>> _localHits = [];
  String? _searchError;

  void _searchChanged(String value) {
    _searchTimer?.cancel();
    final generation = ++_searchGeneration;
    setState(() {
      _networkHits = [];
      _localHits = [];
      _searchError = null;
    });
    final q = value.trim();
    if (q.isEmpty) return;
    unawaited(_searchLocal(q, generation));
    _searchTimer = Timer(const Duration(milliseconds: 200), () async {
      try {
        final hits = await widget.api.searchGroupChats(q);
        if (!mounted || generation != _searchGeneration) return;
        setState(() => _networkHits = hits);
      } catch (_) {
        if (mounted && generation == _searchGeneration) {
          setState(() => _searchError = '网络搜索失败，显示本地结果');
        }
      }
    });
  }

  void _closeSearch() {
    _searchTimer?.cancel();
    _searchGeneration++;
    _searchInput.clear();
    setState(() {
      _searching = false;
      _networkHits = [];
      _localHits = [];
      _searchError = null;
    });
  }

  Future<void> _openContact(String type, Map<String, dynamic> contact) async {
    if (_openingContact || !_chatResource.allowAction(context)) return;
    final id = contact[type == 'agent' ? 'id' : 'user_id'];
    if (id is! String) return;
    if (type == 'member' && id == _currentUserId) return;
    setState(() => _openingContact = true);
    try {
      final existing = findDirectConversation(
        _loadedChats,
        _currentUserId,
        type,
        id,
      );
      final chat =
          existing ??
          await widget.api.openDirectGroupChat(memberType: type, memberId: id);
      if (!mounted) return;
      _scaffoldKey.currentState?.closeDrawer();
      _openConversation(chat);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('无法打开会话：$error')));
      }
    } finally {
      if (mounted) setState(() => _openingContact = false);
    }
  }

  Widget _header() {
    if (!_searching) {
      return HomeHeader(
        title: '会话',
        leadingLabel: '联系人',
        onLeadingPressed: () => _scaffoldKey.currentState?.openDrawer(),
        trailing: HomeRoundButton(
          label: '搜索',
          onTap: () => setState(() => _searching = true),
          child: const Icon(Icons.search, size: 22),
        ),
      );
    }
    return SizedBox(
      height: 54,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            HomeRoundButton(
              label: '返回',
              onTap: _closeSearch,
              child: const Icon(Icons.arrow_back, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _searchInput,
                autofocus: true,
                textInputAction: TextInputAction.search,
                decoration: const InputDecoration(
                  hintText: '搜索标题或内容',
                  border: InputBorder.none,
                ),
                onChanged: _searchChanged,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _createResource();
    unawaited(_refresh());
    unawaited(_loadProfiles());
  }

  void _createResource() {
    _chatResource = OfflineResource(
      scope: OfflineCacheScope.capture(
        widget.api,
        machine: widget.machine ?? '',
      ),
      key: 'conversations',
      decode: (value) => (value as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList(),
    );
  }

  @override
  void didUpdateWidget(covariant ConversationsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_chatResource.scope.matches(
      widget.api,
      machine: widget.machine ?? '',
    )) {
      _chatResource.dispose();
      _createResource();
      _listReady = false;
      _listError = null;
      _loadedChats = [];
      _contacts = null;
      _profiles = const {};
      _currentUserId = null;
      _searchGeneration++;
      _networkHits = [];
      _localHits = [];
      unawaited(_refresh(refreshProfiles: true));
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_refresh(refreshProfiles: true));
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _eventSubscription?.cancel();
    _eventSubscription = ChatUnreadScope.maybeOf(context)?.events
        .listen((frame) {
          if (const {
            'comment:created',
            'comment:deleted',
            'group_chat:updated',
            'inbox:batch-read',
            'inbox:read',
            'inbox:unread',
          }.contains(frame['type'])) {
            _refreshTimer?.cancel();
            _refreshTimer = Timer(const Duration(milliseconds: 250), _refresh);
          }
        });
  }

  Future<_Contacts> _loadContacts() async {
    final results = await Future.wait([
      widget.api.workspaceAgents(),
      widget.api.workspaceMembers(),
    ]);
    return _Contacts(agents: results[0], members: results[1]);
  }

  Future<void> _loadProfiles() async {
    final generation = ++_profileLoadGeneration;
    final results = await Future.wait<Object?>([
      widget.api
          .getMe()
          .then<Object?>((value) => value)
          .catchError((_) => null),
      widget.api
          .workspaceMembers()
          .then<Object?>((value) => value)
          .catchError((_) => null),
      widget.api
          .workspaceAgents()
          .then<Object?>((value) => value)
          .catchError((_) => null),
    ]);
    if (!mounted || generation != _profileLoadGeneration) return;
    final profiles = Map<String, Map<String, dynamic>>.of(_profiles);
    final me = results[0];
    if (me is Map<String, dynamic> && me['id'] is String) {
      _currentUserId = me['id'] as String;
      profiles['member:${me['id']}'] = me;
    }
    final members = results[1];
    if (members is List<Map<String, dynamic>>) {
      profiles.removeWhere(
        (key, _) =>
            key.startsWith('member:') && key != 'member:$_currentUserId',
      );
      for (final member in members) {
        final id = member['user_id'];
        if (id is String) profiles['member:$id'] = member;
      }
    }
    final agents = results[2];
    if (agents is List<Map<String, dynamic>>) {
      profiles.removeWhere((key, _) => key.startsWith('agent:'));
      for (final agent in agents) {
        final id = agent['id'];
        if (id is String) profiles['agent:$id'] = agent;
      }
    }
    setState(() => _profiles = profiles);
  }

  Future<void> _refresh({bool refreshProfiles = false}) async {
    if (refreshProfiles) unawaited(_loadProfiles());
    await _chatResource.load(
      network: widget.api.groupChats,
      onData: (chats, fromCache) {
        if (!mounted) return;
        setState(() {
          _loadedChats = chats;
          _listReady = true;
          _listError = null;
        });
        if (_searchInput.text.trim().isNotEmpty) {
          unawaited(_searchLocal(_searchInput.text.trim(), _searchGeneration));
        }
      },
      onError: (error) {
        if (mounted) setState(() => _listError = error);
      },
    );
  }

  Future<void> _searchLocal(String q, int generation) async {
    final scope = _chatResource.scope;
    final hits = <Map<String, dynamic>>[];
    await Future.wait(
      _loadedChats.map((chat) async {
        final cached = await OfflineCache.instance.read(
          scope,
          'chat:${chat['id']}:history',
        );
        final messages = cached is Map && cached['comments'] is List
            ? (cached['comments'] as List).whereType<Map>()
            : const <Map>[];
        var count = 0;
        String snippet = '';
        for (final message in messages) {
          final content = message['content'] as String? ?? '';
          if (countConversationMatches(content, q) == 0) continue;
          count++;
          if (snippet.isEmpty) snippet = content;
        }
        if (count > 0) {
          hits.add({
            'chat_id': chat['id'],
            'hit_count': count,
            'snippet': snippet,
          });
        }
      }),
    );
    if (mounted && generation == _searchGeneration) {
      setState(() => _localHits = hits);
    }
  }

  void _openConversation(Map<String, dynamic> conversation) {
    unawaited(
      Navigator.of(context)
          .push(
            MaterialPageRoute<void>(
              builder: (_) => ConversationChatPage(
                api: widget.api,
                machine: widget.machine ?? '',
                conversation: conversation,
              ),
            ),
          )
          .then((_) {
            if (mounted) unawaited(_refresh());
          }),
    );
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_searching,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop && _searching) _closeSearch();
    },
    child: Scaffold(
      key: _scaffoldKey,
      backgroundColor: homeBackground,
      onDrawerChanged: (opened) {
        if (opened && _contacts == null) {
          setState(() {
            _contacts = _loadContacts();
          });
        }
      },
      drawer: _ContactsDrawer(
        contacts: _contacts,
        baseUrl: widget.api.baseUrl,
        currentUserId: _currentUserId,
        opening: _openingContact,
        onContact: _openContact,
        onRetry: () => setState(() {
          _contacts = _loadContacts();
        }),
      ),
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            if (_searchError != null)
              Padding(
                padding: const EdgeInsets.all(8),
                child: Text(_searchError!),
              ),
            Expanded(
              child: Builder(
                builder: (context) {
                  if (_listError != null && !_listReady) {
                    return Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('会话加载失败'),
                          const SizedBox(height: 8),
                          AppActionButton(
                            tooltip: '重试',
                            onPressed: () => _refresh(refreshProfiles: true),
                            icon: const Icon(Icons.refresh),
                          ),
                        ],
                      ),
                    );
                  }
                  if (!_listReady) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final q = _searchInput.text.trim();
                  final chats = q.isEmpty
                      ? _loadedChats
                      : rankConversationSearch(
                          _loadedChats,
                          _localHits,
                          _networkHits,
                          q,
                        );
                  if (chats.isEmpty) {
                    return Center(child: Text(q.isEmpty ? '暂无会话' : '没有匹配的会话'));
                  }
                  return RefreshIndicator(
                    onRefresh: () => _refresh(refreshProfiles: true),
                    child: ListView.builder(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
                      itemCount: chats.length,
                      itemBuilder: (context, index) => _ConversationRow(
                        conversation: chats[index],
                        profiles: _profiles,
                        currentUserId: _currentUserId,
                        baseUrl: widget.api.baseUrl,
                        onTap: () => _openConversation(chats[index]),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    ),
  );

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    _searchTimer?.cancel();
    _searchInput.dispose();
    _chatResource.dispose();
    unawaited(_eventSubscription?.cancel());
    super.dispose();
  }
}

class _Contacts {
  const _Contacts({required this.agents, required this.members});
  final List<Map<String, dynamic>> agents;
  final List<Map<String, dynamic>> members;
}

class _ContactsDrawer extends StatelessWidget {
  const _ContactsDrawer({
    required this.contacts,
    required this.onRetry,
    required this.baseUrl,
    required this.currentUserId,
    required this.opening,
    required this.onContact,
  });
  final String baseUrl;
  final String? currentUserId;
  final bool opening;
  final void Function(String, Map<String, dynamic>) onContact;

  final Future<_Contacts>? contacts;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Drawer(
    width: 318,
    backgroundColor: homeBackground,
    child: SafeArea(
      child: FutureBuilder<_Contacts>(
        future: contacts,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('联系人加载失败'),
                  AppActionButton(
                    tooltip: '重试',
                    onPressed: onRetry,
                    icon: const Icon(Icons.refresh),
                  ),
                ],
              ),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final data = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              const AppDrawerHeading('联系人'),
              _ContactSection(
                title: '智能体',
                contacts: data.agents,
                type: 'agent',
                baseUrl: baseUrl,
                opening: opening,
                onContact: onContact,
                name: _agentName,
              ),
              _ContactSection(
                title: '成员',
                contacts: data.members
                    .where((m) => m['user_id'] != currentUserId)
                    .toList(),
                type: 'member',
                baseUrl: baseUrl,
                opening: opening,
                onContact: onContact,
                name: (contact) => _contactText(contact['name'], '成员'),
              ),
            ],
          );
        },
      ),
    ),
  );
}

class _ContactSection extends StatelessWidget {
  const _ContactSection({
    required this.title,
    required this.contacts,
    required this.name,
    required this.type,
    required this.baseUrl,
    required this.opening,
    required this.onContact,
  });

  final String title;
  final String type;
  final String baseUrl;
  final bool opening;
  final void Function(String, Map<String, dynamic>) onContact;
  final List<Map<String, dynamic>> contacts;
  final String Function(Map<String, dynamic>) name;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(title, style: Theme.of(context).textTheme.titleSmall),
      ),
      if (contacts.isEmpty)
        const ListTile(dense: true, title: Text('暂无'))
      else
        for (final contact in contacts)
          ListTile(
            enabled: !opening,
            onTap: () => onContact(type, contact),
            leading: ConversationActorAvatar(
              actor: ConversationActor(
                type: type,
                id: '${contact[type == 'agent' ? 'id' : 'user_id']}',
              ),
              profiles: {
                '$type:${contact[type == 'agent' ? 'id' : 'user_id']}': contact,
              },
              baseUrl: baseUrl,
            ),
            title: Text(
              name(contact),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
    ],
  );
}

class _ConversationRow extends StatelessWidget {
  const _ConversationRow({
    required this.conversation,
    required this.profiles,
    required this.currentUserId,
    required this.baseUrl,
    required this.onTap,
  });

  final Map<String, dynamic> conversation;
  final Map<String, Map<String, dynamic>> profiles;
  final String? currentUserId;
  final String baseUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final title = _contactText(conversation['title'], '未命名会话');
    final lastMessage = conversation['last_message'];
    final preview =
        conversation['_snippet'] is String &&
            (conversation['_snippet'] as String).isNotEmpty
        ? conversation['_snippet'] as String
        : lastMessage is Map<String, dynamic>
        ? _contactText(lastMessage['content'], '')
        : _contactText(conversation['description'], '');
    final timestamp =
        conversation['last_comment_at'] is String &&
            (conversation['last_comment_at'] as String).isNotEmpty
        ? conversation['last_comment_at']
        : lastMessage is Map<String, dynamic>
        ? lastMessage['created_at']
        : conversation['created_at'];
    final timeLabel = chatTimeLabel(timestamp);
    final unread = conversation['unread_count'];
    final members = conversation['members'] is List
        ? (conversation['members'] as List)
              .whereType<Map<String, dynamic>>()
              .toList()
        : const <Map<String, dynamic>>[];
    final actors = conversationAvatarActors(
      members: members,
      currentUserId: currentUserId,
      isDirect: conversation['is_direct'] == true,
    );
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 15, 10, 15),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: homeLine)),
        ),
        child: Row(
          children: [
            ConversationAvatar(
              actors: actors,
              profiles: profiles,
              baseUrl: baseUrl,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 15.5, height: 1.4),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    preview.isEmpty
                        ? ' '
                        : preview.replaceAll(RegExp(r'\s+'), ' '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: homeSecondary),
                  ),
                ],
              ),
            ),
            if (timeLabel.isNotEmpty || unread is int && unread > 0) ...[
              const SizedBox(width: 8),
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (timeLabel.isNotEmpty)
                    Text(
                      timeLabel,
                      maxLines: 1,
                      softWrap: false,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: homeSecondary,
                      ),
                    ),
                  if (unread is int && unread > 0) ...[
                    const SizedBox(height: 5),
                    Container(
                      constraints: const BoxConstraints(minWidth: 20),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE5484D),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        unread > 99 ? '99+' : '$unread',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          height: 1.2,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String _agentName(Map<String, dynamic> contact) =>
    _contactText(contact['custom_name'], _contactText(contact['name'], '智能体'));

String _contactText(Object? value, String fallback) =>
    value is String && value.trim().isNotEmpty ? value.trim() : fallback;

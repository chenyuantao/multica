import 'dart:async';

import 'api.dart';

/// A detail-page-owned preparation; never marks unread messages as read.
class NoteChatPrefetch {
  NoteChatPrefetch(this.api, this.machine, Map<String, dynamic> note)
    : noteId = '${note['id']}',
      revision = '${note['revision']}',
      token = api.token,
      workspaceId = api.workspaceId {
    chat = _observe(api.ensureNoteChat(machine, noteId, revision: revision));
    me = _observe(api.getMe());
    agents = _observe(api.workspaceAgents());
    history = _observe(
      chat.then((chat) => api.noteChatHistory(chat['issue_id'] as String)),
    );
    runs = _observe(
      chat.then((chat) => api.noteChatRuns(chat['issue_id'] as String)),
    );
  }

  final MulticaApi api;
  final String machine, noteId, revision;
  final String? token, workspaceId;
  late final Future<Map<String, dynamic>> chat, me, history;
  late final Future<List<Map<String, dynamic>>> agents, runs;

  bool matches(
    MulticaApi currentApi,
    String currentMachine,
    Map<String, dynamic> note,
  ) =>
      identical(api, currentApi) &&
      machine == currentMachine &&
      noteId == note['id'] &&
      revision == note['revision'] &&
      token == api.token &&
      workspaceId == api.workspaceId;

  // Preparation may finish before anyone opens the sheet. Observe errors now,
  // while preserving the original failed future for the sheet's retry UI.
  static Future<T> _observe<T>(Future<T> future) {
    unawaited(future.then<void>((_) {}, onError: (Object _, StackTrace _) {}));
    return future;
  }
}

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:imind_app/agent_mentions.dart';

TextEditingValue value(String text, [int? caret]) => TextEditingValue(
  text: text,
  selection: TextSelection.collapsed(offset: caret ?? text.length),
);

void main() {
  test(
    'detects a mention at the caret, excluding email and composing text',
    () {
      final draft = AgentMentionDraft();
      expect(draft.active(value('mail@host')), isNull);
      expect(draft.active(value('hello @Dev tail', 10))?.query, 'Dev');
      expect(draft.active(value('@'))?.query, '');
      expect(
        draft.active(
          value('@Dev').copyWith(composing: const TextRange(start: 1, end: 4)),
        ),
        isNull,
      );
    },
  );
  test(
    'replaces only the active query and leaves the cursor after the space',
    () {
      final draft = AgentMentionDraft();
      final picked = draft.pick(value('hello @De tail', 9), 'id-1', 'Dev Ops');
      expect(picked.text, 'hello @Dev Ops  tail');
      expect(picked.selection.extentOffset, 15);
      expect(
        draft.encode(picked.text),
        'hello [@Dev Ops](mention://agent/id-1)  tail',
      );
    },
  );
  test(
    'retains distinct identities for same names and adjusts surrounding edits',
    () {
      final draft = AgentMentionDraft();
      final first = draft.pick(value('@'), 'id-1', 'Dev');
      draft.update('${first.text}@');
      final second = draft.pick(value('${first.text}@'), 'id-2', 'Dev');
      expect(
        draft.encode(second.text),
        '[@Dev](mention://agent/id-1) [@Dev](mention://agent/id-2) ',
      );
      draft.update('prefix ${second.text}');
      expect(
        draft.encode('prefix ${second.text}'),
        'prefix [@Dev](mention://agent/id-1) [@Dev](mention://agent/id-2) ',
      );
      draft.update('prefix @De @Dev ');
      expect(
        draft.encode('prefix @De @Dev '),
        'prefix @De [@Dev](mention://agent/id-2) ',
      );
      draft.update('');
      expect(draft.encode('@Dev'), '@Dev');
    },
  );
  test(
    'extending a picked name does not silently mention the original agent',
    () {
      final draft = AgentMentionDraft();
      final picked = draft.pick(value('@'), 'id', 'Dev');
      expect(
        draft.encode(picked.text.replaceFirst('Dev', 'Developer')),
        '@Developer ',
      );
    },
  );
}

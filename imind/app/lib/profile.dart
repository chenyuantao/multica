import 'package:flutter/material.dart';

import 'api.dart';
import 'action_button.dart';
import 'session.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key, required this.api, required this.session});

  final MulticaApi api;
  final SessionController session;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  late Future<Map<String, dynamic>> _me;

  @override
  void initState() {
    super.initState();
    _me = widget.api.getMe();
  }

  String _displayName(Map<String, dynamic> user) {
    for (final key in ['name', 'display_name', 'email']) {
      final value = user[key];
      if (value is String && value.trim().isNotEmpty) return value.trim();
    }
    return '用户';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF2F2F6),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Center(
                child: FutureBuilder<Map<String, dynamic>>(
                  future: _me,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const CircularProgressIndicator();
                    }
                    if (snapshot.hasError || !snapshot.hasData) {
                      return const Text('无法加载个人资料');
                    }
                    final user = snapshot.data!;
                    final avatarUrl = user['avatar_url'];
                    final avatarUri =
                        avatarUrl is String && avatarUrl.isNotEmpty
                        ? Uri.tryParse(widget.api.baseUrl)?.resolve(avatarUrl)
                        : null;
                    final hasAvatar =
                        avatarUri != null &&
                        (avatarUri.scheme == 'http' ||
                            avatarUri.scheme == 'https');
                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircleAvatar(
                          radius: 44,
                          backgroundColor: Colors.white,
                          foregroundImage: hasAvatar
                              ? NetworkImage(avatarUri.toString())
                              : null,
                          onForegroundImageError: hasAvatar
                              ? (exception, stackTrace) {}
                              : null,
                          child: const Icon(
                            Icons.person,
                            size: 42,
                            color: Color(0xFF9A9AA0),
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          _displayName(user),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w600,
                            color: Color(0xFF1C1C1E),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 14),
              child: AppActionButton(
                tooltip: '退出登录',
                onPressed: widget.session.logout,
                icon: const Icon(Icons.logout, color: Color(0xFFE5484D)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

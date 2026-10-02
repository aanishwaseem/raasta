import 'dart:async';

import 'package:flutter/services.dart';

/// Copies text without ever blocking or failing the screen: clipboard access can be slow or denied.
void copyText(String text) {
  unawaited(Clipboard.setData(ClipboardData(text: text)).catchError((Object _) {}));
}

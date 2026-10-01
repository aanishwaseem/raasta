import 'package:flutter/material.dart';

const raastaTeal = Color(0xFF0F766E);
const raastaAmber = Color(0xFFF59E0B);
const raastaDanger = Color(0xFFB91C1C);

ThemeData raastaTheme({Brightness brightness = Brightness.light, double minButtonHeight = 48}) {
  final scheme = ColorScheme.fromSeed(seedColor: raastaTeal, brightness: brightness, primary: raastaTeal, secondary: raastaAmber);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    cardTheme: CardThemeData(elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: scheme.outlineVariant))),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: Size.fromHeight(minButtonHeight), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(minButtonHeight), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
    inputDecorationTheme: InputDecorationTheme(border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
  );
}

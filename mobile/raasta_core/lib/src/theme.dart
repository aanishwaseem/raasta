import 'package:flutter/material.dart';

const raastaTeal = Color(0xFF0F766E);
const raastaInk = Color(0xFF0B1F24);
const raastaAmber = Color(0xFFF59E0B);
const raastaDanger = Color(0xFFB91C1C);
const raastaMint = Color(0xFFE6F4F1);

/// Rider theme is light and airy; driver theme is dark with larger touch targets for night driving.
ThemeData raastaTheme({Brightness brightness = Brightness.light, double minButtonHeight = 52}) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(seedColor: raastaTeal, brightness: brightness, primary: dark ? const Color(0xFF2DD4BF) : raastaTeal, secondary: raastaAmber, surface: dark ? const Color(0xFF0E1A1D) : Colors.white);
  final radius = BorderRadius.circular(16);
  final text = Typography.material2021().black.apply(fontFamily: null);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? const Color(0xFF081214) : const Color(0xFFF6F8F8),
    textTheme: (dark ? Typography.material2021().white : text).copyWith(
      headlineSmall: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: -0.4),
      titleLarge: const TextStyle(fontWeight: FontWeight.w700, letterSpacing: -0.2),
      titleMedium: const TextStyle(fontWeight: FontWeight.w600),
    ),
    appBarTheme: AppBarTheme(centerTitle: false, elevation: 0, scrolledUnderElevation: 0, backgroundColor: Colors.transparent, foregroundColor: dark ? Colors.white : raastaInk, titleTextStyle: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: dark ? Colors.white : raastaInk)),
    cardTheme: CardThemeData(elevation: 0, margin: EdgeInsets.zero, color: dark ? const Color(0xFF12262A) : Colors.white, shape: RoundedRectangleBorder(borderRadius: radius, side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.6)))),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: Size.fromHeight(minButtonHeight), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700), shape: RoundedRectangleBorder(borderRadius: radius))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(minButtonHeight), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600), shape: RoundedRectangleBorder(borderRadius: radius))),
    inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: dark ? const Color(0xFF12262A) : Colors.white, border: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: scheme.outlineVariant)), enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: scheme.outlineVariant)), contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16)),
    navigationBarTheme: NavigationBarThemeData(height: 68, backgroundColor: dark ? const Color(0xFF0E1A1D) : Colors.white, indicatorColor: dark ? const Color(0xFF123B3A) : raastaMint, labelTextStyle: WidgetStatePropertyAll(const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
    chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)), side: BorderSide(color: scheme.outlineVariant)),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
    bottomSheetTheme: const BottomSheetThemeData(showDragHandle: true, shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24)))),
  );
}

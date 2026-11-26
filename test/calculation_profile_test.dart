import 'package:adhan/adhan.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:vaqtpro/design_system/design_system.dart';
import 'package:vaqtpro/features/prayer_times/models/calculation_profile.dart';
import 'package:vaqtpro/features/prayer_times/screens/settings_screen.dart';
import 'package:vaqtpro/features/prayer_times/view_models/calculation_profile_view_model.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('calculation profile choices persist between view models', () async {
    final previous = SharedPreferencesAsyncPlatform.instance;
    final platform = _MemoryPreferences();
    SharedPreferencesAsyncPlatform.instance = platform;
    addTearDown(() => SharedPreferencesAsyncPlatform.instance = previous);
    final profile = CalculationProfile(
      method: CalculationMethod.turkey,
      madhab: Madhab.hanafi,
      highLatitudeRule: HighLatitudeRule.seventh_of_the_night,
    );

    final first = CalculationProfileViewModel(SharedPreferencesAsync());
    await first.initialize();
    expect(first.profile.method, CalculationMethod.muslim_world_league);
    expect(await first.save(profile), isTrue);
    first.dispose();

    final restored = CalculationProfileViewModel(SharedPreferencesAsync());
    await restored.initialize();
    expect(restored.profile.method, CalculationMethod.turkey);
    expect(restored.profile.madhab, Madhab.hanafi);
    expect(
      restored.profile.highLatitudeRule,
      HighLatitudeRule.seventh_of_the_night,
    );
    restored.dispose();
  });

  testWidgets('settings exposes the profile editor as a bottom sheet', (
    tester,
  ) async {
    final viewModel = CalculationProfileViewModel();
    await viewModel.initialize();
    await tester.pumpWidget(
      AppRoot(
        title: 'Vaqtpro',
        home: SettingsScreen(viewModel: viewModel),
      ),
    );
    await tester.tap(find.text('Профиль расчёта'));
    await tester.pumpAndSettle();

    expect(find.text('Метод расчёта'), findsOneWidget);
    expect(find.text('Правило расчёта Асра'), findsOneWidget);
    expect(find.text('Правило для высоких широт'), findsOneWidget);
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();
    expect(viewModel.profile.method, CalculationMethod.muslim_world_league);
    expect(tester.takeException(), isNull);
    viewModel.dispose();
  });
}

final class _MemoryPreferences extends SharedPreferencesAsyncPlatform {
  final Map<String, String> values = {};

  @override
  Future<String?> getString(
    String key,
    SharedPreferencesOptions options,
  ) async => values[key];

  @override
  Future<void> setString(
    String key,
    String value,
    SharedPreferencesOptions options,
  ) async {
    values[key] = value;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

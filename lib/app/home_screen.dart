import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import '../design_system/components.dart';
import '../design_system/tokens.dart';
import '../features/location/models/geolocation_state.dart';
import '../features/location/models/prayer_location.dart';
import '../features/location/view_models/location_view_model.dart';
import '../features/prayer_times/widgets/prayer_times_card.dart';
import '../features/prayer_times/screens/settings_screen.dart';
import '../features/prayer_times/services/prayer_times_calculator.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.viewModel});

  final LocationViewModel viewModel;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  LocationViewModel get viewModel => widget.viewModel;
  final _prayerTimesCalculator = PrayerTimesCalculator();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(viewModel.initialize());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(viewModel.refreshPermission());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    viewModel.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: viewModel,
    builder: (context, _) {
      final selected = viewModel.selected;
      return AppPage(
        title: 'Времена намаза',
        titleContent: selected == null
            ? _defaultTitle(context)
            : _locationTitle(context, selected),
        floatingActionButton: AppActionButton(
          tooltip: 'Настройки',
          icon: const m.Icon(m.Icons.settings),
          onPressed: () => Navigator.of(context).push(
            m.MaterialPageRoute<void>(
              builder: (_) => SettingsScreen(
                countryCode: selected?.countryCode,
                regionCode: selected?.regionCode,
              ),
            ),
          ),
        ),
        child: _buildBody(context),
      );
    },
  );

  Widget _defaultTitle(BuildContext context) {
    if (!viewModel.isResolvingLocation) return const Text('Времена намаза');
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(
          width: 18,
          height: 18,
          child: m.CircularProgressIndicator(strokeWidth: 2),
        ),
        const SizedBox(width: AppTokens.space12),
        Flexible(
          child: Text(
            'Определяем место…',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: m.Theme.of(context).textTheme.titleMedium,
          ),
        ),
      ],
    );
  }

  Widget _locationTitle(BuildContext context, PrayerLocation location) {
    final offset = viewModel.timezoneDifferenceLabel();
    return AppActionButton(
      onPressed: _openLocationPicker,
      label: location.displayName,
      icon: const m.Icon(m.Icons.location_on),
      detail: offset,
    );
  }

  Widget _buildBody(BuildContext context) {
    return switch (viewModel.loadState) {
      LocationLoadState.loading => const Center(
        child: m.CircularProgressIndicator(),
      ),
      LocationLoadState.failed => Center(
        child: AppStateMessage(
          title: 'Не удалось загрузить сохранённые места',
          message: viewModel.storageMessage,
          actionLabel: 'Повторить',
          onAction: () => unawaited(viewModel.initialize()),
        ),
      ),
      LocationLoadState.ready =>
        viewModel.selected == null
            ? _unknownLocationBody(context)
            : _prayerTimesCard(viewModel.selected!),
    };
  }

  Widget _prayerTimesCard(PrayerLocation location) {
    final schedule = _prayerTimesCalculator.calculate(
      latitude: location.latitude,
      longitude: location.longitude,
      countryCode: location.countryCode,
      regionCode: location.regionCode,
      timeZoneId: location.timeZoneId,
    );
    return PrayerTimesCard(
      times: schedule?.entries.map((entry) => entry.time).toList(),
      isApproximate: schedule?.isApproximate ?? false,
    );
  }

  Widget _unknownLocationBody(BuildContext context) {
    final manualPrimary = viewModel.manualSelectionIsPrimary;
    final manualButton = AppActionButton(
      label: 'Выбрать вручную',
      onPressed: _openLocationPicker,
    );
    final detectButton = AppActionButton(
      label: 'Определить местоположение',
      onPressed: viewModel.isResolvingLocation
          ? null
          : () => unawaited(_determineLocation()),
    );

    return Center(
      child: SingleChildScrollView(
        padding: AppTokens.pagePadding,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              manualPrimary ? manualButton : detectButton,
              const SizedBox(height: AppTokens.space8),
              manualPrimary ? detectButton : manualButton,
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openLocationPicker() async {
    viewModel.collapseFavoriteList();
    unawaited(viewModel.search(''));
    await m.showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _LocationPickerSheet(
        viewModel: viewModel,
        onSelected: (location) async {
          await viewModel.selectLocation(location);
          if (!context.mounted) return;
          if (viewModel.storageMessage == null) {
            Navigator.of(context).pop();
          } else {
            InternalNotification.show(
              context,
              'Не удалось сохранить место. Попробуйте ещё раз.',
              type: NotificationType.error,
            );
          }
        },
        onDetectLocation: () async {
          final saved = await _determineLocation();
          if (saved && context.mounted) {
            Navigator.of(context).pop();
          }
        },
      ),
    );
    if (mounted) viewModel.cancelLocationDetection();
  }

  Future<bool> _determineLocation() async {
    final saved = await viewModel.determineLocation();
    if (!mounted) return saved;
    if (saved) {
      if (viewModel.selected?.name == null) {
        InternalNotification.show(
          context,
          'Место сохранено по координатам',
          type: NotificationType.info,
        );
      } else {
        InternalNotification.show(
          context,
          'Местоположение определено: ${viewModel.selected!.displayName}',
          type: NotificationType.success,
        );
      }
    } else if (viewModel.permission == GeoPermissionState.permanentlyDenied) {
      await _showLocationPermissionDialog();
    } else {
      final message = viewModel.permission == GeoPermissionState.denied
          ? 'Нет доступа к геолокации. Можно выбрать место вручную.'
          : viewModel.permission == GeoPermissionState.servicesDisabled
          ? 'Включите службы геолокации и попробуйте ещё раз.'
          : viewModel.storageMessage ??
                viewModel.permissionMessage ??
                'Не удалось определить местоположение. Попробуйте ещё раз.';
      InternalNotification.show(context, message, type: NotificationType.error);
    }
    return saved;
  }

  Future<void> _showLocationPermissionDialog() async {
    final canOpenSettings = viewModel.canOpenSettings;
    await m.showDialog<void>(
      context: context,
      builder: (dialogContext) => m.AlertDialog(
        title: const Text('Нет доступа к геолокации'),
        content: Text(
          canOpenSettings
              ? 'Доступ к геолокации запрещён. Разрешите его в настройках приложения, чтобы определить местоположение.'
              : 'Доступ к геолокации запрещён. Разрешите его в настройках сайта браузера, чтобы определить местоположение.',
        ),
        actions: [
          m.TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Отмена'),
          ),
          if (canOpenSettings)
            m.TextButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                final opened = await viewModel.openSettings();
                if (!mounted || opened) return;
                InternalNotification.show(
                  context,
                  'Не удалось открыть настройки. Разрешите доступ к геолокации вручную.',
                  type: NotificationType.error,
                );
              },
              child: const Text('Открыть настройки'),
            ),
        ],
      ),
    );
  }
}

class _LocationPickerSheet extends StatefulWidget {
  const _LocationPickerSheet({
    required this.viewModel,
    required this.onSelected,
    required this.onDetectLocation,
  });

  final LocationViewModel viewModel;
  final ValueChanged<PrayerLocation> onSelected;
  final Future<void> Function() onDetectLocation;

  @override
  State<_LocationPickerSheet> createState() => _LocationPickerSheetState();
}

class _LocationPickerSheetState extends State<_LocationPickerSheet> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final viewModel = widget.viewModel;
    final screenHeight = MediaQuery.sizeOf(context).height;
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: keyboardInset),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: SizedBox(
            height: math.min((screenHeight - keyboardInset) * 0.88, 760),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTokens.space24,
                    AppTokens.space16,
                    AppTokens.space16,
                    AppTokens.space8,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Выбрать местоположение',
                          style: m.Theme.of(context).textTheme.titleLarge,
                        ),
                      ),
                      m.IconButton(
                        tooltip: 'Закрыть',
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const m.Icon(m.Icons.close),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTokens.space16,
                  ),
                  child: m.TextField(
                    controller: _controller,
                    autofocus: !viewModel.hasQuickPlaces,
                    textInputAction: m.TextInputAction.search,
                    onChanged: viewModel.search,
                    decoration: const m.InputDecoration(
                      labelText: 'Населённый пункт',
                      hintText: 'Например, Казань',
                      prefixIcon: m.Icon(m.Icons.search),
                      border: m.OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(height: AppTokens.space8),
                Expanded(
                  child: ListenableBuilder(
                    listenable: viewModel,
                    builder: (context, _) => _buildResults(context),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTokens.space16,
                    AppTokens.space8,
                    AppTokens.space16,
                    AppTokens.space12,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Данные мест: GeoNames · CC BY 4.0',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: m.Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                      ListenableBuilder(
                        listenable: viewModel,
                        builder: (context, _) => AppActionButton(
                          tooltip: 'Определить местоположение',
                          icon: const m.Icon(m.Icons.my_location),
                          isLoading: viewModel.isResolvingLocation,
                          onPressed: () => unawaited(widget.onDetectLocation()),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildResults(BuildContext context) {
    return Column(children: [Expanded(child: _buildResultContent(context))]);
  }

  Widget _buildResultContent(BuildContext context) {
    final viewModel = widget.viewModel;
    if (viewModel.searchQuery.trim().isEmpty) {
      final favorites = viewModel.showAllFavorites
          ? viewModel.favorites
          : viewModel.favorites.take(5).toList();
      final favoriteIds = viewModel.favorites
          .map((place) => place.identityKey)
          .toSet();
      final recents = viewModel.recents
          .where((place) => !favoriteIds.contains(place.identityKey))
          .take(5)
          .toList();
      if (favorites.isEmpty && recents.isEmpty) {
        return const Center(
          child: Padding(
            padding: AppTokens.pagePadding,
            child: Text('Начните вводить название населённого пункта'),
          ),
        );
      }
      final sectionChildren = <Widget>[];
      void addHeading(String title) {
        sectionChildren.add(
          _SectionHeading(
            title: title,
            padding: EdgeInsets.fromLTRB(
              AppTokens.space16,
              sectionChildren.isEmpty ? AppTokens.space8 : AppTokens.space16,
              AppTokens.space16,
              AppTokens.space4,
            ),
          ),
        );
      }

      if (favorites.isNotEmpty) {
        addHeading('Избранное');
        sectionChildren.addAll([
          for (final place in favorites) _placeTile(context, place),
          if (viewModel.hasMoreFavorites)
            m.TextButton(
              onPressed: viewModel.showAllSavedFavorites,
              child: Text('Все избранные (${viewModel.favorites.length})'),
            ),
        ]);
      }
      if (recents.isNotEmpty) {
        addHeading('Недавние');
        sectionChildren.addAll([
          for (final place in recents) _placeTile(context, place),
        ]);
      }
      return ListView(
        padding: const EdgeInsets.symmetric(horizontal: AppTokens.space8),
        children: sectionChildren,
      );
    }

    if (viewModel.searchResults.isEmpty) {
      if (viewModel.isSearching || viewModel.isOnlineSearchPending) {
        return const Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: m.CircularProgressIndicator(strokeWidth: 2),
          ),
        );
      }
      return const Center(child: Text('Ничего не найдено'));
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: AppTokens.space8),
      itemCount: viewModel.searchResults.length,
      itemBuilder: (context, index) =>
          _placeTile(context, viewModel.searchResults[index]),
    );
  }

  Widget _placeTile(BuildContext context, PrayerLocation place) {
    final favorite = widget.viewModel.isFavorite(place);
    return m.ListTile(
      title: m.Semantics(
        identifier: 'location-result-${place.geonameId ?? 'coordinates'}',
        child: Text(place.displayName),
      ),
      subtitle: place.subtitle == null ? null : Text(place.subtitle!),
      onTap: () => widget.onSelected(place),
      trailing: m.IconButton(
        tooltip: favorite ? 'Убрать из избранного' : 'Добавить в избранное',
        onPressed: () => unawaited(_toggleFavorite(context, place)),
        icon: m.Icon(
          favorite ? m.Icons.star : m.Icons.star_border,
          color: favorite ? m.Theme.of(context).colorScheme.primary : null,
        ),
      ),
    );
  }

  Future<void> _toggleFavorite(
    BuildContext context,
    PrayerLocation place,
  ) async {
    final result = await widget.viewModel.toggleFavorite(place);
    if (!context.mounted) return;
    final message = switch (result) {
      FavoriteChangeResult.added => '${place.displayName} — в избранном',
      FavoriteChangeResult.removed =>
        '${place.displayName} — удалено из избранного',
      FavoriteChangeResult.failed => 'Не удалось обновить избранное',
    };
    InternalNotification.show(
      context,
      message,
      type: result == FavoriteChangeResult.failed
          ? NotificationType.error
          : NotificationType.success,
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title, required this.padding});

  final String title;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Padding(
    padding: padding,
    child: Text(title, style: m.Theme.of(context).textTheme.titleSmall),
  );
}

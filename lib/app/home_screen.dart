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

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.viewModel});

  final LocationViewModel viewModel;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  LocationViewModel get viewModel => widget.viewModel;

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
    return m.FilledButton.tonal(
      onPressed: _openLocationPicker,
      style: m.FilledButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: AppTokens.space8),
        minimumSize: const Size(48, 48),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              location.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (offset != null) ...[
            const SizedBox(width: AppTokens.space8),
            Text(offset, style: m.Theme.of(context).textTheme.labelMedium),
          ],
        ],
      ),
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
            : const PrayerTimesCard(),
    };
  }

  Widget _unknownLocationBody(BuildContext context) {
    final manualPrimary = viewModel.manualSelectionIsPrimary;
    final manualButton = AppButton(
      label: 'Выбрать вручную',
      primary: manualPrimary,
      onPressed: _openLocationPicker,
    );
    final detectButton = AppButton(
      label: 'Определить местоположение',
      primary: !manualPrimary,
      onPressed: viewModel.isResolvingLocation
          ? null
          : () => unawaited(viewModel.determineLocation()),
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
              if (viewModel.permissionMessage case final message?) ...[
                const SizedBox(height: AppTokens.space16),
                m.Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppTokens.space16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(message),
                        if (viewModel.canOpenSettings) ...[
                          const SizedBox(height: AppTokens.space8),
                          m.TextButton(
                            onPressed: () =>
                                unawaited(viewModel.openSettings()),
                            child: Text(
                              viewModel.permission ==
                                      GeoPermissionState.servicesDisabled
                                  ? 'Открыть настройки геолокации'
                                  : 'Открыть настройки приложения',
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
              if (viewModel.storageMessage case final message?) ...[
                const SizedBox(height: AppTokens.space12),
                Text(message, textAlign: TextAlign.center),
              ],
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
          if (viewModel.storageMessage == null && context.mounted) {
            Navigator.of(context).pop();
          }
        },
        onDetectLocation: () async {
          final saved = await viewModel.determineLocation();
          if (saved && context.mounted) {
            Navigator.of(context).pop();
          }
        },
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
                        builder: (context, _) => AppIconButton(
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
    final viewModel = widget.viewModel;
    final message = viewModel.storageMessage;
    return Column(
      children: [
        if (message != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppTokens.space16,
              AppTokens.space4,
              AppTokens.space16,
              AppTokens.space8,
            ),
            child: Text(
              message,
              style: m.Theme.of(context).textTheme.bodySmall
                  ?.copyWith(color: m.Theme.of(context).colorScheme.error),
            ),
          ),
        Expanded(child: _buildResultContent(context)),
      ],
    );
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
      return ListView(
        padding: const EdgeInsets.symmetric(horizontal: AppTokens.space8),
        children: [
          if (favorites.isNotEmpty) ...[
            _SectionHeading(
              title: 'Избранное',
              padding: const EdgeInsets.fromLTRB(
                AppTokens.space16,
                AppTokens.space8,
                AppTokens.space16,
                AppTokens.space4,
              ),
            ),
            for (final place in favorites) _placeTile(context, place),
            if (viewModel.hasMoreFavorites)
              m.TextButton(
                onPressed: viewModel.showAllSavedFavorites,
                child: Text('Все избранные (${viewModel.favorites.length})'),
              ),
          ],
          if (recents.isNotEmpty) ...[
            _SectionHeading(
              title: 'Недавние',
              padding: const EdgeInsets.fromLTRB(
                AppTokens.space16,
                AppTokens.space16,
                AppTokens.space16,
                AppTokens.space4,
              ),
            ),
            for (final place in recents) _placeTile(context, place),
          ],
        ],
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
      title: Text(place.displayName),
      subtitle: place.subtitle == null ? null : Text(place.subtitle!),
      onTap: () => widget.onSelected(place),
      trailing: m.IconButton(
        tooltip: favorite ? 'Убрать из избранного' : 'Добавить в избранное',
        onPressed: () => unawaited(widget.viewModel.toggleFavorite(place)),
        icon: m.Icon(
          favorite ? m.Icons.star : m.Icons.star_border,
          color: favorite ? m.Theme.of(context).colorScheme.primary : null,
        ),
      ),
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

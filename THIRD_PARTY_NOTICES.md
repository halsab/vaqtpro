# Third-party notices

VaqtPro включает данные, шрифт и программные зависимости третьих сторон. Лицензия
самого приложения — [MIT](LICENSE); она не заменяет лицензии сторонних данных.
Короткая атрибуция доступна в интерфейсе и на статической странице конфиденциальности.
Технические преобразования перечислены ниже.

## Данные

### GeoNames

- Лицензия географических данных: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- `public/data/cities/offline-seed.json` — компактная производная выборка из 657 мест,
  размером около 110 КБ. Она хранит имена, координаты, население и часовые пояса
  для ограниченного поиска без сети; это не полный каталог и не база данных.
- Онлайн-поиск выполняется напрямую браузером через официальный
  [GeoNames Search Webservice](https://www.geonames.org/export/geonames-search.html):
  запрос `searchJSON` с `featureClass=P` ищет имена населённых мест по всем странам.
  VaqtPro не скачивает `allCountries.zip`, не разворачивает его и не поддерживает
  собственный глобальный индекс или серверную базу поиска.
- Браузер отправляет в GeoNames введённое название и настроенное имя учётной записи;
  провайдер получает обычные сетевые метаданные, включая IP-адрес. Сырые GPS-координаты
  в поиск не передаются. Запросы и ответы VaqtPro не сохраняет в IndexedDB,
  Service Worker или на собственном сервере.
- GeoNames требует зарегистрированное имя пользователя в каждом API-запросе;
  демонстрационный `demo` запрещён для приложений и тестов. Имя задаётся сборке через
  `VITE_GEONAMES_USERNAME` и является публичным параметром запроса, а не секретом.
  Бесплатный сервис учитывает один кредит за поиск и ограничен 10 000 запросов в день
  и 1 000 в час на имя приложения; SLA доступен у премиального сервиса. Источник
  публикует данные «как есть», без гарантии точности, актуальности и полноты.

### OpenStreetMap через geoBoundaries

- © OpenStreetMap contributors. Атрибуция: [OpenStreetMap](https://www.openstreetmap.org/copyright).
- Источник: OpenStreetMap / Wambacher, geoBoundaries gbOpen `RUS-ADM1-28173009`,
  снимок территории 2017 года, сборка 12 декабря 2023 года, фиксированная версия `9469f09`.
  [Метаданные источника](https://www.geoboundaries.org/api/current/gbOpen/RUS/ADM1/).
- Лицензия исходной и производной базы границ: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  Лицензия MIT к геоданным не применяется. Полный текст ODbL поставляется в `public/data/ODbL-1.0.txt`.
- Производная база — только feature `RU-TA`, MultiPolygon с сохранением колец, островов и отверстий.
  Исходная извлечённая геометрия находится в `scripts/geography/tatarstan-source.geojson`,
  происхождение, URL и SHA-256 — в `scripts/geography/provenance.json` и `source-metadata.json`.
  Эти файлы доступны в открытом исходном коде проекта для воспроизведения производной базы.
- Компактный результат `public/data/tatarstan-boundary.json` создаётся
  `scripts/buildLocalGeography.ts`: упрощение 100 м и округление до 5 знаков,
  полоса неопределённости 2 км плюс точность GPS. Запас не является оценкой
  гарантированной точности исходного снимка. Подробнее: [облачная документация](https://drive.google.com/drive/folders/1Mj0e00ee7n7R3rGS-oTZresvmA7uZ7Vp?usp=drive_link).
- Runtime Nominatim удалён. Исторические текстовые названия сохраняются локально
  при миграции; новых запросов к Nominatim приложение не делает.

### Часовые пояса

- Timezone городов берутся из поля GeoNames `timezone` (тот же CC BY 4.0),
  административные имена admin1 не доказывают принадлежность GPS-точки региону.
- IANA timezone `Europe/Moscow`: [IANA tzdb](https://www.iana.org/time-zones),
  таблица `zone1970.tab` (public domain); Татарстан относится к московской зоне.
  Правила DST/исторических переходов выполняет `Intl` браузера; фиксированные offsets не сохраняются.

## Шрифт: Old Timey Mono

- Автор: Darren Embry, © 2024.
- Источник: https://github.com/dse/old-timey-mono-font
- Версия: `58d9c1b35168cc2162b0dc5274332432a535aee8`, `dist/ttf/OldTimeyMono.ttf`.
- Лицензия: SIL Open Font License 1.1; полный текст — `public/old-timey-mono-license.txt`.
- Шрифт используется без изменений.

## Производный код: Jelly UI

- Источник: [jelly-org/ui](https://github.com/jelly-org/ui), API-справочник
  [jelly-ui.com/api](https://jelly-ui.com/api/). Пакет, `package.js` и CDN не
  подключаются; внешних runtime-запросов Jelly UI нет.
- Версия: 1.1.0, зафиксированный upstream-коммит
  `1b775385b17884ecb48374615c96ec6ee1b58d21` (30 сентября 2026 года).
- Лицензия: MIT; copyright принадлежит авторам Jelly UI. Лицензия приложения
  MIT не заменяет эту атрибуцию.
- Перенесено: только soft-body алгоритм из upstream `src/core/body.ts`,
  `src/core/config.ts`, `src/core/engine.ts` и `traceSmoothPath`. Файлы
  `src/ui/jelly/softBody.ts` и `src/ui/jelly/engine.ts` — производный vendor-слой.
- Локальные изменения задокументированы в шапке этих файлов: удалены не нужные
  action-компонентам каналы depth/tilt/rotation/press и заготовки под слайдеры,
  `JellyConfig` сокращён до используемых полей, индексация кольца оформлена
  явно для `noUncheckedIndexedAccess`. Числовые параметры мембраны не менялись;
  пресеты `subtle`/`standard`/`expressive` — собственная настройка VaqtPro
  (`src/ui/jelly/presets.ts`).
- Граница производного слоя: vendor-код существует только в `src/ui/jelly/`.
  Feature-модули используют собственные action-компоненты
  `ActionButton`, `ActionRow`, `IconActionButton` из `src/ui/controls.tsx` и не
  импортируют Jelly UI напрямую.
- Обновление upstream выполнять сверкой с перечисленными файлами; локальные
  расхождения намеренно ограничены удалением неиспользуемых ветвей и типизацией.

## Прямые runtime и поставляемые зависимости

- [React / ReactDOM 19.2.8](https://github.com/react/react) — MIT.
- [Scheduler 0.27.0](https://github.com/facebook/react) — MIT.
- [adhan 4.4.6](https://github.com/batoulapps/adhan-js) — MIT.
- [idb 8.0.3](https://github.com/jakearchibald/idb) — ISC.
- [vite-plugin-pwa 1.3.0](https://github.com/vite-pwa/vite-plugin-pwa) — MIT
  (интеграция сборки и service worker).
- [Workbox 7.4.1](https://github.com/googlechrome/workbox) — MIT
  (сгенерированный service worker и offline cache).

Лицензии прямых runtime-зависимостей сверяются с установленными пакетами из
`package-lock.json`; все транзитивные и инструменты сборки проверяет
`npm run license:check`. Тексты ODbL и OFL поставляются отдельно, ссылки на исходники
и преобразования сохраняются.

Первичные сведения о [GeoNames](https://www.geonames.org/about.html),
[лицензии всего дампа](https://download.geonames.org/export/dump/readme.txt),
[OpenStreetMap](https://www.openstreetmap.org/copyright),
[GeoNames Search Webservice](https://www.geonames.org/export/geonames-search.html),
[условия API и квоты](https://www.geonames.org/export/), и
[источнике geoBoundaries](scripts/geography/source-metadata.json) проверены
5 ноября 2026 года. Модель не включает мировой набор timezone-полигонов;
зона устройства вне поддержанного локального покрытия не является такой базой.

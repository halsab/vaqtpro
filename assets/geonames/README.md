# GeoNames offline catalog

`places.json` is generated from the GeoNames `cities15000` and `RU` country
dumps. The RU dump is filtered to Tatarstan, Moscow, Moscow Oblast, St.
Petersburg, Leningrad Oblast, Dagestan, and Chechnya.

GeoNames data is licensed under Creative Commons Attribution 4.0:
https://creativecommons.org/licenses/by/4.0/

Source data and updates: https://download.geonames.org/export/dump/

Regenerate from the repository root with:

```sh
python3 tooling/build_geonames_catalog.py
```

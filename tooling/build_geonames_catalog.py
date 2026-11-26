#!/usr/bin/env python3
"""Build the compact offline place catalog from the CC-BY GeoNames dumps."""

from __future__ import annotations

import argparse
import io
import json
import urllib.request
import zipfile
from pathlib import Path


BASE_URL = "https://download.geonames.org/export/dump/"
REGIONAL_ADMIN1 = {"73", "48", "47", "42", "66", "17", "12"}
REGIONAL_NAMES = {
    "RU.73": "Республика Татарстан",
    "RU.48": "Москва",
    "RU.47": "Московская область",
    "RU.42": "Ленинградская область",
    "RU.66": "Санкт-Петербург",
    "RU.17": "Дагестан",
    "RU.12": "Чечня",
}
DISPLAY_NAME_OVERRIDES = {
    "498817": "Санкт-Петербург",
    "524901": "Москва",
    "532096": "Махачкала",
    "551487": "Казань",
    "558418": "Грозный",
}
ALIAS_OVERRIDES = {
    "498817": ["Санкт-Петербург"],
    "524901": ["Москва"],
    "532096": ["Махачкала"],
    "551487": ["Казань"],
    "558418": ["Грозный"],
}


def download_zip(filename: str) -> zipfile.ZipFile:
    request = urllib.request.Request(
        BASE_URL + filename,
        headers={"User-Agent": "Vaqtpro offline place catalog builder"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return zipfile.ZipFile(io.BytesIO(response.read()))


def read_dump(archive: zipfile.ZipFile, filename: str):
    with archive.open(filename) as source:
        for line in source:
            fields = line.decode("utf-8").rstrip("\r\n").split("\t")
            if len(fields) >= 19:
                yield fields


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/geonames/places.json"),
    )
    args = parser.parse_args()

    records: dict[str, list[str | int | float | list[str]]] = {}
    countries: dict[str, str] = {}
    regions: dict[str, str] = {}

    def add(fields: list[str], regional: bool) -> None:
        if fields[6] != "P":
            return
        if regional and not (fields[8] == "RU" and fields[10] in REGIONAL_ADMIN1):
            return

        country = fields[8]
        region_code = f"{country}.{fields[10]}" if fields[10] else ""
        alternates = fields[3].split(",") if fields[3] else []
        # Russian and other non-Latin names are otherwise easy to lose in the
        # GeoNames convenience field, so retain them before transliterations.
        alternates.sort(
            key=lambda value: (
                not any("\u0400" <= char <= "\u04ff" for char in value),
                len(value),
            )
        )
        aliases: list[str] = []
        for value in alternates:
            value = value.strip()
            if value and value.casefold() != fields[1].casefold() and value not in aliases:
                aliases.append(value)
            if len(aliases) == 12:
                break
        for value in ALIAS_OVERRIDES.get(fields[0], []):
            if value.casefold() != fields[1].casefold() and value not in aliases:
                aliases.insert(0, value)
        localized_name = next(
            (
                value
                for value in aliases
                if any("\u0400" <= char <= "\u04ff" for char in value)
            ),
            fields[1],
        )

        try:
            latitude = round(float(fields[4]), 6)
            longitude = round(float(fields[5]), 6)
            population = int(fields[14] or 0)
        except ValueError:
            return
        records[fields[0]] = [
            fields[0],
            DISPLAY_NAME_OVERRIDES.get(fields[0], localized_name),
            aliases,
            latitude,
            longitude,
            country,
            fields[10],
            fields[17],
            population,
        ]
        if region_code and region_code not in regions:
            regions[region_code] = fields[10]

    print("Downloading worldwide cities15000 dump...")
    for row in read_dump(download_zip("cities15000.zip"), "cities15000.txt"):
        add(row, regional=False)
    print("Downloading Russia dump for priority regions...")
    for row in read_dump(download_zip("RU.zip"), "RU.txt"):
        add(row, regional=True)

    print("Downloading country and region display names...")
    countries_text = urllib.request.urlopen(BASE_URL + "countryInfo.txt", timeout=30).read()
    for line in countries_text.decode("utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) > 4 and fields[0]:
            countries[fields[0]] = fields[4]

    admin1_text = urllib.request.urlopen(BASE_URL + "admin1CodesASCII.txt", timeout=30).read()
    for line in admin1_text.decode("utf-8").splitlines():
        fields = line.split("\t")
        if len(fields) >= 2 and fields[0] in regions:
            regions[fields[0]] = fields[1]
    regions.update(REGIONAL_NAMES)

    data = {
        "version": 1,
        "attribution": "GeoNames (CC BY 4.0), geonames.org",
        "countries": countries,
        "regions": regions,
        "places": sorted(records.values(), key=lambda place: str(place[0])),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(records):,} places to {args.output} ({args.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

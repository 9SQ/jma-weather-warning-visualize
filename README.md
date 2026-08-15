# jma-weather-warning-visualize

新たな防災気象情報に対応した気象警報・注意報をMapLibreを使用して地図上に重ねます。

- 注意報/レベル２注意報: 黄
- 警報/レベル３警報: 赤
- レベル４危険警報: 紫
- 特別警報/レベル５特別警報: 黒

警報データとの結合キーはShapefileの `regioncode` と `weather_warning.json` の `areas[].code` です。MapLibreの `feature-state` 用IDには `area_id` を使います。`regioncode` がある地域では `area_id` と `regioncode` は同じ値です。

## PMTilesの生成

以下の方法により、[気象庁が提供しているShapefile](https://www.data.jma.go.jp/developer/gis.html)からPMTiles形式に変換しています。

GDALの `ogr2ogr` と `tippecanoe` が必要です。

```sh
ogr2ogr \
  -f GeoJSON "jma-warning-areas.geojson" \
  "/vsizip/20260226_AreaInformationCity_weather_GIS.zip/気象警報等/市町村等（気象警報等）.shp" \
  -dialect SQLite \
  -sql "SELECT geometry, COALESCE(NULLIF(regioncode,''), 'uncoded:' || name) AS area_id, regioncode, name, regionname FROM '市町村等（気象警報等）'" \
  -s_srs EPSG:4326 \
  -t_srs EPSG:4326 \
  -lco RFC7946=YES
```

```
tippecanoe \
  --force \
  --output="jma-warning-areas.pmtiles" \
  --layer=jma_warning_areas \
  --name="JMA weather warning areas" \
  --description="City-level areas used for JMA weather warnings and advisories" \
  --attribution="気象庁" \
  --minimum-zoom=4 \
  --maximum-zoom=11 \
  --low-detail=10 \
  --full-detail=12 \
  --detect-shared-borders \
  --grid-low-zooms \
  --no-feature-limit \
  --no-tile-size-limit \
  --include=regioncode \
  --include=area_id \
  --include=name \
  --include=regionname \
  "jma-warning-areas.geojson"
```

## ローカルでの地図表示

PMTilesの表示にはHTTP Rangeリクエストに対応したWebサーバーが必要です。

ローカルで表示するための簡易Webサーバー `scripts/serve.py` を同梱しています。

```sh
python3 scripts/serve.py
```

ブラウザで `http://localhost:8000/` にアクセスすると表示されます。
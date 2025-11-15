# 衛星トラッカー設計書

## 1. 概要
- **目的**: TLE（Two-Line Element）と観測地点（緯度・経度・高度）を入力すると、衛星の方位角・仰角・距離を 1 秒ごとに算出し、数値とポーラーチャートで可視化します。
- **構成ファイル**: `index.html`（UI）、`styles.css`（スタイル）、`main.js`（ロジック）、`satellite.min.js`（SGP4 計算ライブラリ／WGS84 定数に改造済み）。

## 2. 主要コンポーネント
| ファイル | 役割 |
| --- | --- |
| `index.html` | フォーム、結果表示、キャンバスを定義。スクリプトを `<script defer>` で読み込むためローカルファイル起動でも動作。 |
| `styles.css` | ダークテーマ、レスポンシブグリッド、カード、ポーラーチャート枠のデザイン。 |
| `main.js` | 入力検証、TLE 読み込み、sgp4 計算、方位角／仰角算出、ポーラーチャート描画ループ。 |
| `satellite.min.js` | satellite.js v5 のミニファイ版。先頭の物理定数を WGS84（半径 6378.137 km, μ=398600.5 km³/s² 等）に書き換え済み。 |

## 3. データフロー
1. ユーザーがフォームに観測地点と TLE を入力し「トラッキング開始」を押す。
2. `startTracking()` → `updateSatelliteRecord()` が `satellite.twoline2satrec` を呼び satrec（SGP4 状態）を生成。エラーコードが返った場合は UI に表示。
3. `tick()` が 1 秒ごとに走り、`satellite.propagate(satrec, now)` で ECI 位置、`eciToEcf` + `ecfToLookAngles` で観測地点基準の方位角・仰角を計算。
4. `setStatus()` が数値カードを更新し、同じ結果を `drawPolarChart()` に渡してポーラーチャートを再描画。ポーラーチャートは可視状態なら現在のパス、不可視状態なら次回パスの点描線ルートを描き、点描線のサンプル間隔は 30 秒。
5. 可視状態のときは `computeCurrentPassInfo()` が AOS（過去方向の 0° 交差）、LOS（未来方向、最大 24 時間先まで探索）、および同パス中の最大仰角と発生時刻を求め、`updateCurrentPassDisplay()` が現在カードに AOS/LOS/最大仰角を表示する（LOS が見つからなければ「ー」）。
6. 現在が仰角 0° 未満の場合は `findNextVisiblePass()` が 30 秒刻み＋二分探索で AOS（仰角 0°以上になる瞬間）を求め、10 秒刻みで最大仰角と LOS（再び 0°を割る瞬間）を探索し、`updateNextPassDisplay()` が AOS/LOS の時刻＋方位角と最大仰角を表示する。
7. トラッキング開始時に `renderUpcomingPasses()` が 7 日先までの可視パスをリスト化してフォーム直下に描画し、停止時には `hideUpcomingPasses()` がリストを隠す。
8. `stopTracking()` またはタブ非表示時は `setInterval` を停止し、UI を「停止しました」に更新。

## 4. ポーラーチャート設計
- Canvas 要素 `#polar-canvas` はウィンドウサイズに応じて `resizePolarCanvas()` が DPI 対応でリサイズ。
- チャートは中心が観測者位置、外周が地平線。仰角 90° で中心、0° で外周。負の仰角も中心→外周外にクリップ。
- 方位角は北を 0°、時計回り。`drawPolarChart()` で方位線と同心円を描いてから最新位置を水色のポイントで表示。

## 5. 主要関数
- `updateSatelliteRecord()`：TLE 入力チェック → satrec 生成。失敗時は UI にエラーをセット。
- `computeLookAngles()`：観測者座標（ラジアン）と高度 km を作り、SGP4 から算出した角度を度単位で返却。
- `tick()`：計算結果をカード・チャート双方へ反映。`setInterval` にバインド。
- `resizePolarCanvas()`：`devicePixelRatio` を考慮したキャンバス解像度調整。ロード時とリサイズ時に実行。
- `findNextVisiblePass()`：現在が不可視の場合に 24 時間先まで 30 秒間隔で走査し、仰角 0° 以上になる最初の時刻を二分探索で絞り込む。可視パス中は 10 秒刻みで最大仰角を更新し、仰角が再び 0° 未満になる瞬間を二分探索で求めて LOS とし、全区間の軌道点列を 30 秒刻みで生成する。
- `findAosBefore()` / `findLosAfter()`：現在可視状態の際に、過去方向と未来方向に 24 時間まで走査して AOS/LOS を検出するヘルパー。
- `computeCurrentPassInfo()`：AOS/LOS・最大仰角情報・現在パスの軌道点列を求め、ポーラーチャートや UI に共有する。
- `updateCurrentPassDisplay()`：可視中に AOS/LOS/最大仰角をカードへ出力（LOS が見つからなければ「ー」表記）。
- `updateNextPassDisplay()`：予測結果を UI に反映（AOS/LOS の時刻＋方位角、最大仰角）し、ポーラーチャートに表示する点描線ルート用の座標列をキャッシュ。可視状態ならカードを非表示にする。
- `computeUpcomingPasses()` / `renderUpcomingPasses()`：トラッキング開始時に 7 日先までの可視パスを探索し、AOS/LOS/最大仰角をリストとしてフォーム下に表示。
- `hideUpcomingPasses()`：トラッキングを停止またはリセットした際に上記リストを非表示にする。

## 6. 依存関係と制約
- 外部ライブラリは `satellite.min.js` のみ。ローカルにバンドルしているためオフライン閲覧でも動作。
- ネットワークを使わずにテストできるが、TLE の取得は別途 NASA/NORAD などから最新値を入手する必要がある。
- ブラウザで `file:///` から開いても動作するよう ES Modules は使っていない。

## 7. 今後の拡張案
1. 複数衛星の同時トラッキングとカラーレジェンド対応。
2. 地図（Leaflet 等）を用いた軌跡表示や可視パス予測。
3. Service Worker を使った PWA 化、TLE 自動更新機能。
4. 計算結果の履歴蓄積と CSV/JSON エクスポート。

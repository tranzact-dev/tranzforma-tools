# XML Import Spec Generator — ツール仕様書

## 1. 概要

fusion_placeのフォーム定義XMLにおける `<import-spec>` 内の `<source-field-specs>` を、Excelカラム定義ファイルから自動生成するツール。

### 背景・課題

- フォーム定義XMLの `<source-field-specs>` は手動記述が必要
- カラム数が多い場合（20列超など）、手作業では時間がかかりミスも生じやすい
- カラム定義はExcelで管理されていることが多く、そこから自動変換したい

### ゴール

Excelカラム定義をアップロードするだけで、`<source-field-spec>` 要素群を自動生成し、元のXML内に正しく追記する。

---

## 2. 処理フロー

```
Step 1: フォーム定義XMLをアップロード（テキスト貼り付け or ファイル選択）
   ↓  XMLをパース、import-specの存在を確認
Step 2: カラム定義Excelをアップロード
   ↓  Excelを読み込み、カラム定義テーブルをプレビュー表示
Step 3: 「生成」ボタン → source-field-specsを差し替え → 結果XMLをコピー
```

---

## 3. Excelカラム定義のスキーマ

### ファイル形式

- `.xlsx` 形式
- 1シート目を使用
- 1行目はヘッダー行

### カラム定義

| 列 | ヘッダー名 | 必須 | 説明 |
|----|-----------|------|------|
| A | column_id | Yes | CSV上の列位置（A, B, C, ...） |
| B | field_label | Yes | source-field-specのlabel属性に使用 |
| C | field_name | No | source-field-specのname要素に使用（日本語名称） |
| D | is_value | No | "TRUE"の場合、値フィールドであることを示す（将来利用） |
| E | field_key | No | フィールドのキー名称（将来利用） |

### サンプルデータ

```
column_id  field_label  field_name    is_value  field_key
A          YYYYMM
B          B            製造実績ID
C          C            行番号
H          PRD
K          K            数量           TRUE      QTY
M          M            単価           TRUE      UNITPRICE
```

---

## 4. XML生成ルール

### 4.1 source-field-spec の生成

Excelの各データ行（ヘッダー行を除く）から1つの `<source-field-spec>` を生成する。

**field_nameが存在する場合:**
```xml
<source-field-spec label="{field_label}">
    <name>ja;"{field_name}"</name>
</source-field-spec>
```

**field_nameが空の場合:**
```xml
<source-field-spec label="{field_label}">
    <name/>
</source-field-spec>
```

### 4.2 XMLへの追記ルール

1. 元XMLの `<import-spec> > <transformation-spec> > <source-field-specs>` を探す
2. `<source-field-specs>` 内の**既存の子要素を全て削除**する
3. Excelの行順に `<source-field-spec>` 要素を新規追加する
4. `<derived-field-specs>` は**一切変更しない**
5. `<import-spec>` が存在しない場合は**エラーを表示**して処理中断

### 4.3 変更しない要素

以下の要素・属性はそのまま維持する:
- `<import-spec>` の `<enabled>` 値（false/trueそのまま）
- `<derived-field-specs>` とその内容
- `<export-spec>` 以下
- XML内のその他全ての要素

---

## 5. Before/After XMLサンプル

### Before（import-specが空の状態）

```xml
<import-spec>
    <enabled>false</enabled>
    <transformation-spec>
        <source-field-specs/>
        <derived-field-specs/>
    </transformation-spec>
</import-spec>
```

### After（Excelから23行生成した結果）

```xml
<import-spec>
    <enabled>false</enabled>
    <transformation-spec>
        <source-field-specs>
            <source-field-spec label="YYYYMM">
                <name/>
            </source-field-spec>
            <source-field-spec label="B">
                <name>ja;"製造実績ID"</name>
            </source-field-spec>
            <source-field-spec label="C">
                <name>ja;"行番号"</name>
            </source-field-spec>
            <source-field-spec label="D">
                <name>ja;"リンク種別"</name>
            </source-field-spec>
            <source-field-spec label="E">
                <name>ja;"品目区分"</name>
            </source-field-spec>
            <source-field-spec label="F">
                <name>ja;"HPL"</name>
            </source-field-spec>
            <source-field-spec label="G">
                <name>ja;"AGC"</name>
            </source-field-spec>
            <source-field-spec label="PRD">
                <name/>
            </source-field-spec>
            <source-field-spec label="I">
                <name>ja;"品目名称"</name>
            </source-field-spec>
            <source-field-spec label="WH">
                <name/>
            </source-field-spec>
            <source-field-spec label="K">
                <name>ja;"数量"</name>
            </source-field-spec>
            <source-field-spec label="L">
                <name>ja;"単位コード"</name>
            </source-field-spec>
            <source-field-spec label="M">
                <name>ja;"単価"</name>
            </source-field-spec>
            <source-field-spec label="N">
                <name>ja;"金額"</name>
            </source-field-spec>
            <source-field-spec label="O">
                <name>ja;"主材"</name>
            </source-field-spec>
            <source-field-spec label="P">
                <name>ja;"補助材"</name>
            </source-field-spec>
            <source-field-spec label="Q">
                <name>ja;"仕損"</name>
            </source-field-spec>
            <source-field-spec label="R">
                <name>ja;"加工費"</name>
            </source-field-spec>
            <source-field-spec label="S">
                <name>ja;"主材料費"</name>
            </source-field-spec>
            <source-field-spec label="T">
                <name>ja;"補助材料費"</name>
            </source-field-spec>
            <source-field-spec label="U">
                <name>ja;"仕損費"</name>
            </source-field-spec>
            <source-field-spec label="V">
                <name>ja;"材料費計"</name>
            </source-field-spec>
            <source-field-spec label="W">
                <name>ja;"加工金額"</name>
            </source-field-spec>
        </source-field-specs>
        <derived-field-specs/>
    </transformation-spec>
</import-spec>
```

---

## 6. UI設計

### ファイル構成

```
tranzforma/xml-import/
  index.html    ← UI（ステップ型ウィザード）
  import-gen.js ← ビジネスロジック
```

### レイアウト

```
+--------------------------------------------------------------+
| [logo] XML import spec generator    v0.1        [theme-btn]  |
+--------------------------------------------------------------+
|                        |                                      |
|  ┌─ XML Input ───────┐ |  ┌─ Step 2: カラム定義 ────────────┐ |
|  │ [textarea]         │ |  │ [Excel upload zone]             │ |
|  │                    │ |  │                                  │ |
|  │ [解析] [クリア]    │ |  │ ┌────────────────────────────┐  │ |
|  │                    │ |  │ │ label │ name    │ value?   │  │ |
|  │ Status:            │ |  │ │ YYYYMM│         │          │  │ |
|  │ ・import-spec: あり│ |  │ │ B     │ 製造実績 │          │  │ |
|  │ ・source-fields: 0 │ |  │ │ ...   │ ...     │ ...      │  │ |
|  └────────────────────┘ |  │ └────────────────────────────┘  │ |
|                        |  │                                  │ |
|                        |  │ [生成実行]                       │ |
|                        |  │                                  │ |
|                        |  │ ┌─ 生成結果 ──────────────────┐  │ |
|                        |  │ │ source-field-specs: 23件     │  │ |
|                        |  │ │ [結果XMLをコピー]            │  │ |
|                        |  │ └──────────────────────────────┘  │ |
|                        |  └──────────────────────────────────┘ |
+--------------------------------------------------------------+
```

### ステップ進行

| ステップ | トリガー | 表示内容 |
|---------|---------|---------|
| Step 1 | XML入力 → 「解析」ボタン | import-specの存在確認、既存source-field-spec数を表示 |
| Step 2 | Excelアップロード | カラム定義テーブルをプレビュー表示、「生成実行」ボタン有効化 |
| Step 3 | 「生成実行」ボタン | 差し替え完了メッセージ + 結果XMLコピーボタン |

---

## 7. 技術仕様

### 外部ライブラリ

| ライブラリ | 用途 | CDN |
|-----------|------|-----|
| SheetJS (xlsx.js) | ブラウザでのExcel読み込み | `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` |

※ 既存ツール（apd-analyzer, requester-generator）でもjszip, cytoscapeをCDN利用しており、同じパターン。

### 主要関数（import-gen.js）

```javascript
// XMLパース＆バリデーション
parseFormXml(xmlText)
  → { doc: Document, hasImportSpec: boolean, sourceFieldCount: number }

// Excelパース
parseColumnDef(arrayBuffer)
  → [{ columnId, label, name, isValue, fieldKey }, ...]

// source-field-specs生成＆差し替え
generateSourceFieldSpecs(doc, columns)
  → doc（DOMを直接変更）

// XML文字列化
serializeResult(doc)
  → string
```

### XML操作パターン

```javascript
// ターゲット取得
const sfs = doc.querySelector(
  'import-spec > transformation-spec > source-field-specs'
);

// 既存の子要素を全削除
while (sfs.firstChild) sfs.removeChild(sfs.firstChild);

// 新規source-field-spec追加
for (const col of columns) {
  const spec = doc.createElement('source-field-spec');
  spec.setAttribute('label', col.label);
  const nameEl = doc.createElement('name');
  if (col.name) {
    nameEl.textContent = `ja;"${col.name}"`;
  }
  spec.appendChild(nameEl);
  sfs.appendChild(spec);
}
```

### ファイル読み込みパターン

```javascript
// Excel読み込み（SheetJS）
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = (ev) => {
    const wb = XLSX.read(ev.target.result, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    // data[0] = ヘッダー行, data[1:] = データ行
  };
  reader.readAsArrayBuffer(file);
});
```

---

## 8. 既存ツールとの整合性ガイド

### 共通インフラ（必ず使用）

```html
<link rel="stylesheet" href="../shared/common.css">
<script src="../shared/theme.js"></script>
<script src="../shared/auth.js"></script>
<script src="../shared/auth-guard.js"></script>
```

### CSSテーマ変数

色は直接指定せず、必ず `var(--xxx)` を使用:
- 背景: `--bg`, `--surface`, `--surface2`
- 境界: `--border`, `--border-hover`
- テキスト: `--text`, `--text2`, `--text3`
- アクセント: `--accent`, `--accent-dim`
- ステータス: `--error`, `--warn`, `--info`, `--ok`
- フォント: `--mono` (IBM Plex Mono), `--sans` (Noto Sans JP)

### ボタンスタイル

```css
/* 既存の共通ボタンクラスを使用 */
.btn           /* 基本ボタン */
.btn-primary   /* 青アクセント背景 */
.btn-secondary /* サーフェス背景 */
.btn-fix       /* 緑（確認/実行系） */
```

### headerパターン

```html
<header>
  <img src="../shared/logo.png" alt="tranzForma">
  <h1><span>XML import spec</span> generator</h1>
  <span style="font:500 12px var(--mono);color:var(--text3)">v0.1</span>
  <button style="margin-left:auto" class="theme-btn" onclick="toggleTheme()"></button>
</header>
```

---

## 9. ポータル登録

`tranzforma/index.html` のツールグリッドにカードを追加:

```html
<a class="tool-card" href="xml-import/">
  <div class="codename-block">
    <span class="codename-ver">v0.1</span>
  </div>
  <div class="card-icon icon-teal">
    <img src="shared/icons/xml-import.svg" alt="">
  </div>
  <div class="card-body">
    <span class="card-name">XML import spec generator</span>
    <span class="card-desc">インポート仕様の自動生成ツール。Excelカラム定義からsource-field-specsを生成し、フォームXMLに追記。</span>
  </div>
</a>
```

- アイコン: `shared/icons/xml-import.svg` を新規作成（インポート/データ取り込みイメージ）
- カラー: `icon-teal`
- ステータス: `status-dev`
- コードネーム: 未定

---

## 10. テスト検証

### 検証パターン

1. **正常系**: Before XML + 23行Excelカラム定義 → 23個のsource-field-spec生成
2. **空名前**: field_nameが空の行 → `<name/>` が生成されること
3. **上書き**: 既存source-field-specがあるXML → 全削除後に再生成
4. **エラー系**: import-specが存在しないXML → エラーメッセージ表示
5. **derived維持**: derived-field-specsに内容がある場合 → 変更されないこと

### 期待結果の検証ポイント

- label属性が Excel の field_label と一致
- name要素の値が `ja;"field_name"` 形式
- source-field-specの順序がExcelの行順と一致
- XMLの他の部分（column-axis-spec, row-axis-spec等）が変更されていない

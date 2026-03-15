// ═══════════════════════════════════════════════════════════════════
// File Input & Drag-and-Drop
// ═══════════════════════════════════════════════════════════════════
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const xmlInput = document.getElementById('xmlInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) readFile(file);
});
fileInput.addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });

function readFile(file) {
  const reader = new FileReader();
  reader.onload = e => { xmlInput.value = e.target.result; };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════════════════
// XML Parsing Helpers
// ═══════════════════════════════════════════════════════════════════
function parseXML(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML構文エラー');
  return doc;
}

function parseName(text) {
  if (!text) return { en: '', ja: '' };
  const en = (text.match(/en;"(.*?)"/) || [])[1] || '';
  const ja = (text.match(/ja;"(.*?)"/) || [])[1] || '';
  return { en, ja };
}

/** axis-specを透過して再帰的にtagを検索 */
function findRecursive(el, tag) {
  const results = [];
  for (const child of el.children) {
    if (child.tagName === tag) results.push(child);
    if (['axis-spec', 'loop-spec'].includes(child.tagName))
      results.push(...findRecursive(child, tag));
  }
  return results;
}

/** loop-specを再帰的に検索（axis-spec透過） */
function findLoopsRecursive(el) {
  const results = [];
  for (const child of el.children) {
    if (child.tagName === 'loop-spec') {
      results.push(child);
      results.push(...findLoopsRecursive(child));
    }
    if (child.tagName === 'axis-spec')
      results.push(...findLoopsRecursive(child));
  }
  return results;
}

/** ループのディメンションラベルを取得 */
function loopDimLabel(loopEl) {
  const dl = loopEl.querySelector(':scope > member-list-spec > dimension-label');
  return dl ? dl.textContent : '不明';
}

/** 配置パスを生成 */
function buildPath(el, axisLabel) {
  const parts = [axisLabel];
  let cur = el.parentElement;
  const ancestors = [];
  while (cur && cur.tagName !== 'column-axis-spec' && cur.tagName !== 'row-axis-spec') {
    if (cur.tagName === 'loop-spec') ancestors.unshift('ループ（' + loopDimLabel(cur) + '）');
    cur = cur.parentElement;
  }
  return parts.concat(ancestors).join(' › ');
}

/** column-row-specの位置表示を生成（パス付き） */
function crsLocation(spec, index, axisLabel) {
  const colOrRow = axisLabel === '列' ? '列' : '行';
  const lbl = spec.getAttribute('label') || '';
  const path = buildPath(spec, axisLabel + '軸');
  return `${path} › ${colOrRow}仕様（${index}）${lbl ? ' ' + lbl : ''}`;
}

// ═══════════════════════════════════════════════════════════════════
// Check Engine
// ═══════════════════════════════════════════════════════════════════
let lastResults = [];
let resolvedIssues = [];  // 自動修正で解消されたアイテム

function runCheck() {
  const xml = xmlInput.value.trim();
  const out = document.getElementById('results');
  const exportBar = document.getElementById('exportBar');

  if (!xml) {
    out.innerHTML = '<div class="result-empty">XMLが入力されていません</div>';
    exportBar.style.display = 'none';
    return;
  }

  let doc;
  try { doc = parseXML(xml); } catch (e) {
    out.innerHTML = '<div class="issue-card"><span class="issue-severity sev-error">PARSE ERROR</span> XMLの構文が正しくありません</div>';
    exportBar.style.display = 'none';
    return;
  }

  const root = doc.documentElement;
  const issues = [];

  // Run common checks
  checkCOM01(root, issues);
  checkCOM02(root, issues);
  checkCOM03(root, issues);
  checkCOM04(root, issues);
  checkCOM05(root, issues);
  checkCOM06(root, issues);
  checkCOM07(root, issues);
  checkCOM08(root, issues);
  checkCOM09(root, issues);
  checkCOM10(root, issues);
  checkCOM11(root, issues);

  // Run pattern-specific checks
  const pattern = document.querySelector('input[name="pattern"]:checked').value;
  if (pattern === 'ref') {
    checkREF01(root, issues);
    checkREF02(root, issues);
    checkREF03(root, issues);
    checkREF04(root, issues);
  } else if (pattern === 'import') {
    checkIMP01(root, issues);
    checkIMP02(root, issues);
    checkIMP03(root, issues);
  } else if (pattern === 'export') {
    checkEXP01(root, issues);
    checkEXP02(root, issues);
    checkEXP03(root, issues);
  } else if (pattern === 'pipeline') {
    checkEXP01(root, issues);
    checkEXP02(root, issues);
    checkEXP03(root, issues);
    checkPIP01(root, issues);
  }

  lastResults = issues;
  renderResults(issues);
  exportBar.style.display = 'flex';

  // COM-06系のWARNがあれば自動修正ボタンを有効化
  const has06fix = issues.some(i => ['COM-06a','COM-06b','COM-06d','COM-06e','COM-06f'].includes(i.code));
  document.getElementById('fixBtn').disabled = !has06fix;
  document.getElementById('fixRunBtn').disabled = !has06fix;
}

function addIssue(issues, code, severity, message, location, detail, suggest) {
  issues.push({ code, severity, message, location: location || '', detail: detail || '', suggest: suggest || '' });
}

// ─── COM-01: デフォルトタイトル残存 ──────────────────────────
function checkCOM01(root, issues) {
  const axes = [
    { tag: 'column-axis-spec', label: '列' },
    { tag: 'row-axis-spec', label: '行' }
  ];
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    const specs = findRecursive(axisEl, 'column-row-spec');
    specs.forEach((spec, i) => {
      const suppressed = spec.getAttribute('suppressed') === 'true';
      if (suppressed) return;
      const titleEl = spec.querySelector(':scope > title');
      const titleText = titleEl && titleEl.textContent ? titleEl.textContent : '';
      if (titleText.includes('Column/Row Title') || titleText.includes('列/行タイトル')) {
        const loc = crsLocation(spec, i + 1, axis.label);
        addIssue(issues, 'COM-01', 'WARN', 'デフォルトタイトルが残存しています', loc, titleText.substring(0, 80));
      }
    });
  }
}

// ─── COM-02: peg/expansion 禁止組み合わせ ────────────────────
function checkCOM02(root, issues) {
  const axes = [
    { tag: 'column-axis-spec', label: '列軸' },
    { tag: 'row-axis-spec', label: '行軸' }
  ];
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    const loops = findLoopsRecursive(axisEl);
    for (const loop of loops) {
      const dim = loopDimLabel(loop);
      const mles = loop.querySelectorAll(':scope > member-list-spec > member-list-expression');
      for (const mle of mles) {
        const peg = mle.querySelector('peg-member');
        const exp = mle.querySelector('expansion-method');
        if (!peg || !exp) continue;
        const pt = peg.getAttribute('type') || '';
        const em = exp.getAttribute('method') || '';
        const loc = `${axis.label} › ループ（${dim}）`;

        // ALL は NONE_EXPANSION のみ
        if (pt === 'ALL' && em !== 'NONE_EXPANSION')
          addIssue(issues, 'COM-02', 'WARN', `peg=ALL に method=${em} は無効`, loc, 'NONE_EXPANSION のみ有効です');
        // ROOTS は NONE_EXPANSION のみ
        if (pt === 'ROOTS' && em !== 'NONE_EXPANSION')
          addIssue(issues, 'COM-02', 'WARN', `peg=ROOTS に method=${em} は無効`, loc, 'NONE_EXPANSION のみ有効です');
        // #FY, #PERIOD以外で DESCENDENT_BF
        if (!['#FY', '#PERIOD'].includes(dim) && em === 'DESCENDENT_BF')
          addIssue(issues, 'COM-02', 'WARN', `ディメンション ${dim} で DESCENDENT_BF は非推奨`, loc);
        // INFO: ROOTS
        if (pt === 'ROOTS')
          addIssue(issues, 'COM-02', 'INFO', 'peg=ROOTS が使用されています', loc, 'めったに使わない設定です');
        // INFO: DESCENDENT_BF
        if (em === 'DESCENDENT_BF')
          addIssue(issues, 'COM-02', 'INFO', 'method=DESCENDENT_BF が使用されています', loc, 'めったに使わない設定です');
      }
    }
  }
}

// ─── COM-03: 元帳マスク ─────────────────────────────────────
function checkCOM03(root, issues) {
  const lm = root.querySelector(':scope > local-mask');
  if (lm && lm.textContent && lm.textContent.trim()) {
    addIssue(issues, 'COM-03', 'WARN', '元帳マスクが設定されています', '', lm.textContent.trim().substring(0, 100));
  }
}

// ─── COM-04: トリガー ───────────────────────────────────────
function checkCOM04(root, issues) {
  const triggers = root.querySelectorAll(':scope > triggers > trigger');
  if (triggers.length > 0) {
    triggers.forEach(trig => {
      const action = trig.querySelector('action');
      const type = action ? (action.querySelector('type')?.textContent || '?') : '?';
      const label = action ? (action.querySelector('label')?.textContent || '?') : '?';
      addIssue(issues, 'COM-04', 'WARN', `トリガーが設定されています: ${type} → ${label}`, '', '意図しない更新が走る可能性があります');
    });
  }
}

// ─── COM-05: エクスポート有効時の行ループ項目出力 ────────────
function checkCOM05(root, issues) {
  const es = root.querySelector(':scope > export-spec');
  if (!es) return;
  const enabled = es.querySelector('enabled');
  const erli = es.querySelector('export-row-loop-items');
  if (enabled && enabled.textContent === 'true') {
    if (!erli || erli.textContent === 'false') {
      addIssue(issues, 'COM-05', 'WARN', 'エクスポートが有効ですが行ループ項目の出力がfalseです', '');
    }
  }
}

// ─── COM-06: テキスト式チェック ──────────────────────────────
function checkCOM06(root, issues) {
  const expressions = collectExpressions(root);

  for (const { text, location } of expressions) {
    // コメント行を除外してチェック
    const lines = text.split('\n');
    const activeLines = lines.map(line => {
      const commentIdx = line.indexOf('//');
      if (commentIdx === 0) return '';
      if (commentIdx > 0 && line[commentIdx - 1] === ' ') return line.substring(0, commentIdx);
      return line;
    });
    const activeText = activeLines.join('\n');
    if (!activeText.trim()) continue;

    // COM-06a: メソッド名は小文字
    const methodRe = /\.([A-Z][a-zA-Z0-9_]*)/g;
    let m;
    while ((m = methodRe.exec(activeText)) !== null) {
      addIssue(issues, 'COM-06a', 'WARN', `メソッド名が大文字: .${m[1]}`, location, '', `→ .${m[1].toLowerCase()}`);
    }

    // COM-06b: ラベルは大文字（!の後の識別子）
    const labelRe = /!([#]?[a-zA-Z_][a-zA-Z0-9_]*)/g;
    while ((m = labelRe.exec(activeText)) !== null) {
      const label = m[1];
      // @CUR, @POV は除外（COM-06fで扱う）
      if (label.startsWith('@')) continue;
      if (label !== label.toUpperCase()) {
        addIssue(issues, 'COM-06b', 'WARN', `ラベルが小文字を含む: ${label}`, location, '', `→ ${label.toUpperCase()}`);
      }
    }

    // COM-06c: #LEAF="TRUE"/"FALSE" チェック
    const leafRe = /#[Ll][Ee][Aa][Ff]\s*=\s*("?)([^"\s]*)\1/gi;
    while ((m = leafRe.exec(activeText)) !== null) {
      const fullMatch = m[0];
      const hasQuote = m[1] === '"';
      const value = m[2];
      // "TRUE" または "FALSE" の完全一致のみOK。それ以外はすべてERROR
      if (!hasQuote || (value !== 'TRUE' && value !== 'FALSE')) {
        let reason = '';
        if (!hasQuote) {
          reason = '引用符がありません';
        } else if (value.toUpperCase() === 'TRUE') {
          reason = `値が "${value}" です（"TRUE" が必要）`;
        } else if (value.toUpperCase() === 'FALSE') {
          reason = `値が "${value}" です（"FALSE" が必要）`;
        } else {
          reason = `値が "${value}" です（"TRUE" または "FALSE" が必要 — タイポの可能性）`;
        }
        addIssue(issues, 'COM-06c', 'ERROR', `#LEAF の値が正しくありません`, location, fullMatch, reason);
      }
    }

    // COM-06d: 予約語は小文字
    const reserved = ['DIMENSIONS', 'LEDGERS', 'EDITIONS', 'TRUE', 'FALSE', 'IF', 'THEN', 'ELSE', 'ENDIF', 'AND', 'OR', 'NOT'];
    // 文字列定数外のテキストを抽出（簡易：""内を除去）
    const noStrings = activeText.replace(/"[^"]*"/g, '""');
    for (const word of reserved) {
      const wordRe = new RegExp('\\b(' + word + ')\\b', 'g');
      while ((m = wordRe.exec(noStrings)) !== null) {
        if (m[1] !== m[1].toLowerCase()) {
          addIssue(issues, 'COM-06d', 'WARN', `予約語が大文字: ${m[1]}`, location, '', `→ ${m[1].toLowerCase()}`);
        }
      }
    }

    // COM-06e: 関数は小文字（@始まり、@CUR/@POV除外）
    const funcRe = /@([A-Z][a-zA-Z0-9_]*)/g;
    while ((m = funcRe.exec(activeText)) !== null) {
      if (['CUR', 'POV', 'RKEY'].includes(m[1])) continue;
      addIssue(issues, 'COM-06e', 'WARN', `関数が大文字: @${m[1]}`, location, '', `→ @${m[1].toLowerCase()}`);
    }

    // COM-06f: 疑似ラベルは大文字（@CUR, @POV, @RKEY）
    const pseudoRe = /@(cur|pov|rkey)/gi;
    while ((m = pseudoRe.exec(activeText)) !== null) {
      if (m[1] !== m[1].toUpperCase()) {
        addIssue(issues, 'COM-06f', 'WARN', `疑似ラベルが小文字: @${m[1]}`, location, '', `→ @${m[1].toUpperCase()}`);
      }
    }
  }
}

/** テキスト式が含まれる全要素を収集 */
function collectExpressions(root) {
  const results = [];

  // column-row-spec > title, loop-spec > title
  const axes = [
    { tag: 'column-axis-spec', label: '列軸' },
    { tag: 'row-axis-spec', label: '行軸' }
  ];
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;

    // column-row-specのtitle
    const specs = findRecursive(axisEl, 'column-row-spec');
    specs.forEach((spec, i) => {
      const loc = crsLocation(spec, i + 1, axis.label === '列軸' ? '列' : '行');
      const title = spec.querySelector(':scope > title');
      if (title?.textContent?.trim()) results.push({ text: title.textContent, location: loc + ' > title' });
      const formula = spec.querySelector(':scope > value-spec > formula');
      if (formula?.textContent?.trim()) results.push({ text: formula.textContent, location: loc + ' > formula' });
    });

    // loop-specのtitle
    const loops = findLoopsRecursive(axisEl);
    loops.forEach(loop => {
      const dim = loopDimLabel(loop);
      const loc = `${axis.label} › ループ（${dim}）`;
      const title = loop.querySelector(':scope > title');
      if (title?.textContent?.trim()) results.push({ text: title.textContent, location: loc + ' > title' });
    });
  }

  // member-criteria
  for (const mc of root.querySelectorAll('member-criteria')) {
    if (mc.textContent?.trim()) {
      const dim = mc.closest('member-list-spec')?.querySelector('dimension-label')?.textContent || '?';
      results.push({ text: mc.textContent, location: `メンバー条件（${dim}）` });
    }
  }

  // drill-down-spec > condition
  for (const dd of root.querySelectorAll('drill-down-spec > condition')) {
    if (dd.textContent?.trim()) results.push({ text: dd.textContent, location: 'ドリルダウン条件' });
  }

  // cell-spec > value-spec > formula
  // IDからGUI番号への変換テーブルを構築
  const colIdToNum = {};
  const rowIdToNum = {};
  const colAxis = root.querySelector('column-axis-spec');
  const rowAxis = root.querySelector('row-axis-spec');
  if (colAxis) {
    findRecursive(colAxis, 'column-row-spec').forEach((spec, i) => {
      const id = spec.getAttribute('id');
      if (id) colIdToNum[id] = i + 1;
    });
  }
  if (rowAxis) {
    findRecursive(rowAxis, 'column-row-spec').forEach((spec, i) => {
      const id = spec.getAttribute('id');
      if (id) rowIdToNum[id] = i + 1;
    });
  }
  for (const cs of root.querySelectorAll(':scope > cell-spec')) {
    const colId = cs.getAttribute('column-id') || '?';
    const rowId = cs.getAttribute('row-id') || '?';
    const colNum = colIdToNum[colId] || '?';
    const rowNum = rowIdToNum[rowId] || '?';
    const loc = `セル仕様（列${colNum}, 行${rowNum}）`;
    const formula = cs.querySelector('value-spec > formula');
    if (formula?.textContent?.trim()) results.push({ text: formula.textContent, location: loc + ' > formula' });
  }

  // derived-field-spec > expression
  for (const df of root.querySelectorAll('derived-field-spec')) {
    const expr = df.querySelector('expression');
    const lbl = df.getAttribute('label') || '?';
    if (expr?.textContent?.trim()) results.push({ text: expr.textContent, location: `変換式（${lbl}）` });
  }

  // local-mask
  const lm = root.querySelector(':scope > local-mask');
  if (lm?.textContent?.trim()) results.push({ text: lm.textContent, location: '元帳マスク' });

  return results;
}

// ─── COM-07: フォームラベルのハイフン ────────────────────────
function checkCOM07(root, issues) {
  const label = root.getAttribute('label') || '';
  if (label.includes('-')) {
    addIssue(issues, 'COM-07', 'WARN', `フォームラベルにハイフンが含まれています（アンダースコア推奨）: ${label}`, '', 'ソート順の不整合やスクリプトでの誤動作の原因になる場合があります');
  }
}

// ─── COM-08: セルを保護 ─────────────────────────────────────
function checkCOM08(root, issues) {
  const rf = root.querySelector(':scope > report-format');
  if (!rf) return;
  const prot = rf.querySelector('protected');
  if (prot && prot.textContent === 'true') {
    addIssue(issues, 'COM-08', 'INFO', '帳票書式の「セルを保護」が有効です', '');
  }
}

// ─── COM-09: 行ループのインデント幅 ─────────────────────────
function checkCOM09(root, issues) {
  const rf = root.querySelector(':scope > report-format');
  if (!rf) return;
  const rfIndent = rf.querySelector('row-title-indent');
  if (!rfIndent) return;
  const rfVal = parseInt(rfIndent.textContent, 10);
  if (isNaN(rfVal)) return;

  const rowAxis = root.querySelector('row-axis-spec');
  if (!rowAxis) return;
  const loops = findLoopsRecursive(rowAxis);
  for (const loop of loops) {
    const loopIndent = loop.getAttribute('row-title-indent');
    if (loopIndent === null) continue;
    const loopVal = parseInt(loopIndent, 10);
    if (!isNaN(loopVal) && loopVal < rfVal) {
      const dim = loopDimLabel(loop);
      addIssue(issues, 'COM-09', 'WARN',
        `ループ（${dim}）のインデント幅(${loopVal})が帳票書式(${rfVal})より小さいため効果がありません`,
        `行軸 › ループ（${dim}）`);
    }
  }
}

// ─── COM-10: label・name ともにブランク ──────────────────────
function checkCOM10(root, issues) {
  const axes = [
    { tag: 'column-axis-spec', label: '列' },
    { tag: 'row-axis-spec', label: '行' }
  ];
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    const specs = findRecursive(axisEl, 'column-row-spec');
    specs.forEach((spec, i) => {
      const label = spec.getAttribute('label') || '';
      const nameEl = spec.querySelector(':scope > name');
      const nameText = nameEl && nameEl.textContent ? nameEl.textContent : '';
      const parsed = parseName(nameText);
      if (!label && !parsed.en && !parsed.ja) {
        const loc = crsLocation(spec, i + 1, axis.label);
        addIssue(issues, 'COM-10', 'INFO',
          `label と name がともにブランクです`,
          loc,
          'スペーサー行等の可能性があります');
      }
    });
  }
}

// ─── COM-11: 数値のみのラベル ───────────────────────────────
function checkCOM11(root, issues) {
  const axes = [
    { tag: 'column-axis-spec', label: '列' },
    { tag: 'row-axis-spec', label: '行' }
  ];
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    const specs = findRecursive(axisEl, 'column-row-spec');
    specs.forEach((spec, i) => {
      const label = spec.getAttribute('label') || '';
      if (label && /^\d+$/.test(label)) {
        const loc = crsLocation(spec, i + 1, axis.label);
        addIssue(issues, 'COM-11', 'ERROR',
          `数値のみのラベルはオフセット参照と区別できないため、数式で正しく参照できない可能性があります: "${label}"`,
          loc);
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Pattern: 参照用フォーム (REF)
// ═══════════════════════════════════════════════════════════════════

// ─── REF-01: 行仕様・列仕様のtitleが空 ─────────────────────────
function checkREF01(root, issues) {
  const axes = [
    { tag: 'column-axis-spec', label: '列' },
    { tag: 'row-axis-spec', label: '行' }
  ];
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    const specs = findRecursive(axisEl, 'column-row-spec');
    specs.forEach((spec, i) => {
      const titleEl = spec.querySelector(':scope > title');
      const titleText = titleEl && titleEl.textContent ? titleEl.textContent.trim() : '';
      const parsed = parseName(titleText);
      const suppressed = spec.getAttribute('suppressed') === 'true';

      // titleが空（en/jaどちらも未設定）
      if (!parsed.en && !parsed.ja) {
        const loc = crsLocation(spec, i + 1, axis.label);
        if (suppressed) {
          addIssue(issues, 'REF-01', 'INFO',
            'タイトルが未設定です（非表示行）', loc);
        } else {
          addIssue(issues, 'REF-01', 'WARN',
            'タイトルが未設定です', loc);
        }
      }
    });
  }
}

// ─── REF-02: ループ項目選択行の非表示設定（行軸のみ） ───────────
function checkREF02(root, issues) {
  const rowAxis = root.querySelector('row-axis-spec');
  if (!rowAxis) return;
  const loops = findLoopsRecursive(rowAxis);
  for (const loop of loops) {
    const prohibited = loop.getAttribute('item-addition-prohibited');
    if (prohibited !== 'true') {
      const dim = loopDimLabel(loop);
      addIssue(issues, 'REF-02', 'WARN',
        `ループ項目選択行が非表示に設定されていません`,
        `行軸 › ループ（${dim}）`,
        `item-addition-prohibited="${prohibited || '未設定'}"`);
    }
  }
}

// ─── REF-03: 帳票書式の行表示設定がLOOP_HEADERS ────────────────
function checkREF03(root, issues) {
  const rf = root.querySelector(':scope > report-format');
  if (!rf) return;
  const rwll = rf.querySelector('row-wise-loop-layout');
  // タグが存在しない場合はデフォルト値 LOOP_HEADERS
  // タグが存在して値が LOOP_HEADERS の場合も同様
  if (!rwll || rwll.textContent === 'LOOP_HEADERS') {
    addIssue(issues, 'REF-03', 'WARN',
      '帳票書式の行表示設定が LOOP_HEADERS になっています',
      '', '参照用フォームでは FIRST_DETAILS が一般的です');
  }
}

// ─── REF-04: ドリルダウン有効だがconditionが空 ──────────────────
function checkREF04(root, issues) {
  // loop-spec内のdrill-down-spec
  const axes = [
    { tag: 'column-axis-spec', label: '列軸' },
    { tag: 'row-axis-spec', label: '行軸' }
  ];
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    const loops = findLoopsRecursive(axisEl);
    for (const loop of loops) {
      const dim = loopDimLabel(loop);
      for (const dd of loop.querySelectorAll(':scope > drill-down-spec')) {
        checkDrillDown(dd, `${axis.label} › ループ（${dim}）`, issues);
      }
    }
    // column-row-spec内のdrill-down-spec
    const specs = findRecursive(axisEl, 'column-row-spec');
    specs.forEach((spec, i) => {
      const loc = crsLocation(spec, i + 1, axis.label === '列軸' ? '列' : '行');
      for (const dd of spec.querySelectorAll(':scope > drill-down-spec')) {
        checkDrillDown(dd, loc, issues);
      }
    });
  }

  // cell-spec内のdrill-down-spec
  const colAxis = root.querySelector('column-axis-spec');
  const rowAxis = root.querySelector('row-axis-spec');
  const colIdToNum = {};
  const rowIdToNum = {};
  if (colAxis) {
    findRecursive(colAxis, 'column-row-spec').forEach((spec, i) => {
      const id = spec.getAttribute('id');
      if (id) colIdToNum[id] = i + 1;
    });
  }
  if (rowAxis) {
    findRecursive(rowAxis, 'column-row-spec').forEach((spec, i) => {
      const id = spec.getAttribute('id');
      if (id) rowIdToNum[id] = i + 1;
    });
  }
  for (const cs of root.querySelectorAll(':scope > cell-spec')) {
    const colId = cs.getAttribute('column-id') || '?';
    const rowId = cs.getAttribute('row-id') || '?';
    const colNum = colIdToNum[colId] || '?';
    const rowNum = rowIdToNum[rowId] || '?';
    const loc = `セル仕様（列${colNum}, 行${rowNum}）`;
    for (const dd of cs.querySelectorAll('drill-down-spec')) {
      checkDrillDown(dd, loc, issues);
    }
  }
}

function checkDrillDown(dd, location, issues) {
  const enabled = dd.querySelector('enabled');
  if (!enabled || enabled.textContent !== 'true') return;
  const condition = dd.querySelector('condition');
  const condText = condition && condition.textContent ? condition.textContent.trim() : '';
  if (!condText) {
    addIssue(issues, 'REF-04', 'WARN',
      'ドリルダウンが有効ですがconditionが空です',
      location, 'ドリルダウンの実行条件が未設定です');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Pattern: インポートフォーム (IMP)
// ═══════════════════════════════════════════════════════════════════

// ─── IMP-01: インポート仕様が無効 ───────────────────────────────
function checkIMP01(root, issues) {
  const imp = root.querySelector(':scope > import-spec');
  if (!imp) {
    addIssue(issues, 'IMP-01', 'WARN', 'import-specが存在しません', '');
    return;
  }
  const enabled = imp.querySelector('enabled');
  if (!enabled || enabled.textContent !== 'true') {
    addIssue(issues, 'IMP-01', 'WARN', 'インポート仕様が無効です', '', `enabled="${enabled ? enabled.textContent : '未設定'}"`);
  }
}

// ─── IMP-02: 符号表示タイプ ─────────────────────────────────────
function checkIMP02(root, issues) {
  const imp = root.querySelector(':scope > import-spec');
  if (!imp) return;
  const signType = imp.querySelector('sign-type');
  if (!signType || signType.textContent !== 'ACCOUNT') {
    addIssue(issues, 'IMP-02', 'WARN',
      '符号表示タイプが「勘定科目属性に従う」になっていません',
      '', `sign-type="${signType ? signType.textContent : '未設定'}"`);
  }
}

// ─── IMP-03: ヘッダ読み飛ばし行数 ──────────────────────────────
function checkIMP03(root, issues) {
  const imp = root.querySelector(':scope > import-spec');
  if (!imp) return;
  const nhl = imp.querySelector('num-of-header-lines');
  const val = nhl ? nhl.textContent : '未設定';
  addIssue(issues, 'IMP-03', 'INFO', `ヘッダ読み飛ばし行数: ${val}`, '');
}

// ═══════════════════════════════════════════════════════════════════
// Pattern: エクスポート用 (EXP)
// ═══════════════════════════════════════════════════════════════════

// ─── EXP-01: エクスポート仕様が無効 ─────────────────────────────
function checkEXP01(root, issues) {
  const exp = root.querySelector(':scope > export-spec');
  if (!exp) {
    addIssue(issues, 'EXP-01', 'ERROR', 'export-specが存在しません', '');
    return;
  }
  const enabled = exp.querySelector('enabled');
  if (!enabled || enabled.textContent !== 'true') {
    addIssue(issues, 'EXP-01', 'ERROR', 'エクスポート仕様が無効です', '', `enabled="${enabled ? enabled.textContent : '未設定'}"`);
  }
}

// ─── EXP-02: 列ヘッダ出力抑制 ──────────────────────────────────
function checkEXP02(root, issues) {
  const exp = root.querySelector(':scope > export-spec');
  if (!exp) return;
  const sch = exp.querySelector('suppress-column-headers');
  if (sch && sch.textContent === 'true') {
    addIssue(issues, 'EXP-02', 'WARN', '列ヘッダの出力が抑制されています', '', 'suppress-column-headers="true"');
  }
}

// ─── EXP-03: 行ヘッダ出力抑制 ──────────────────────────────────
function checkEXP03(root, issues) {
  const exp = root.querySelector(':scope > export-spec');
  if (!exp) return;
  const srh = exp.querySelector('suppress-row-headers');
  if (srh && srh.textContent === 'true') {
    addIssue(issues, 'EXP-03', 'WARN', '行ヘッダの出力が抑制されています', '', 'suppress-row-headers="true"');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Pattern: パイプライン OUT (PIP)
// ═══════════════════════════════════════════════════════════════════

// ─── PIP-01: 行ループの表示仕様が .label であること ──────────────
function checkPIP01(root, issues) {
  const rowAxis = root.querySelector('row-axis-spec');
  if (!rowAxis) return;

  const loops = findLoopsRecursive(rowAxis);
  for (const loop of loops) {
    // 最内ループ（直下に子loop-specがない）はチェック対象外
    const hasChildLoop = Array.from(loop.children).some(c => c.tagName === 'loop-spec');
    if (!hasChildLoop) continue;

    const dim = loopDimLabel(loop);
    const titleEl = loop.querySelector(':scope > title');
    const titleText = titleEl && titleEl.textContent ? titleEl.textContent.trim() : '';

    // 正しい形式: en;"ディメンションラベル!@CUR.label" または類似パターン
    // .label で終わっているかチェック
    if (!titleText) {
      addIssue(issues, 'PIP-01', 'ERROR',
        'ループのtitleが未設定です',
        `行軸 › ループ（${dim}）`,
        'パイプラインOUTでは ディメンションラベル!@CUR.label 形式が必要です');
    } else if (!titleText.includes('.label')) {
      addIssue(issues, 'PIP-01', 'ERROR',
        `ループの表示仕様が .label ではありません`,
        `行軸 › ループ（${dim}）`,
        titleText.substring(0, 80),
        '→ .label 形式に変更してください');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Results Rendering
// ═══════════════════════════════════════════════════════════════════
function renderResults(issues) {
  const out = document.getElementById('results');
  if (issues.length === 0) {
    out.innerHTML = '<div class="summary-bar"><span class="summary-chip chip-ok">✓ 問題なし</span></div>';
    return;
  }

  const counts = { ERROR: 0, WARN: 0, INFO: 0 };
  issues.forEach(i => counts[i.severity]++);

  // Summary
  let html = '<div class="summary-bar">';
  html += `<span style="color:var(--text2)">検出: ${issues.length}件</span>`;
  if (counts.ERROR) html += `<span class="summary-chip chip-error">ERROR ${counts.ERROR}</span>`;
  if (counts.WARN) html += `<span class="summary-chip chip-warn">WARN ${counts.WARN}</span>`;
  if (counts.INFO) html += `<span class="summary-chip chip-info">INFO ${counts.INFO}</span>`;
  html += '</div>';

  // Group by code
  const groups = {};
  const groupOrder = [];
  for (const iss of issues) {
    if (!groups[iss.code]) { groups[iss.code] = []; groupOrder.push(iss.code); }
    groups[iss.code].push(iss);
  }

  const checkNames = {
    'COM-01': 'デフォルトタイトル残存',
    'COM-02': 'peg/expansion 組み合わせ',
    'COM-03': '元帳マスク設定',
    'COM-04': 'トリガー設定',
    'COM-05': 'エクスポート行ループ項目',
    'COM-06a': 'テキスト式: メソッド名',
    'COM-06b': 'テキスト式: ラベル',
    'COM-06c': 'テキスト式: #LEAF値',
    'COM-06d': 'テキスト式: 予約語',
    'COM-06e': 'テキスト式: 関数名',
    'COM-06f': 'テキスト式: 疑似ラベル',
    'COM-07': 'フォームラベルのハイフン',
    'COM-08': 'セルを保護',
    'COM-09': 'ループインデント幅',
    'COM-10': 'label・name ブランク',
    'COM-11': '数値のみのラベル',
    'REF-01': 'タイトル未設定',
    'REF-02': 'ループ項目選択行の非表示',
    'REF-03': '行表示設定 LOOP_HEADERS',
    'REF-04': 'ドリルダウンcondition空',
    'IMP-01': 'インポート仕様が無効',
    'IMP-02': '符号表示タイプ',
    'IMP-03': 'ヘッダ読み飛ばし行数',
    'EXP-01': 'エクスポート仕様が無効',
    'EXP-02': '列ヘッダ出力抑制',
    'EXP-03': '行ヘッダ出力抑制',
    'PIP-01': '行ループ表示仕様 .label',
  };

  for (const code of groupOrder) {
    const items = groups[code];
    const maxSev = items.some(i => i.severity === 'ERROR') ? 'ERROR' : items.some(i => i.severity === 'WARN') ? 'WARN' : 'INFO';
    const sevClass = maxSev === 'ERROR' ? 'chip-error' : maxSev === 'WARN' ? 'chip-warn' : 'chip-info';
    const name = checkNames[code] || code;

    html += `<div class="check-group">`;
    html += `<div class="check-group-header" onclick="toggleGroup(this)">`;
    html += `<span class="arrow">▶</span>`;
    html += `<span class="code">${esc(code)}</span>`;
    html += `<span>${esc(name)}</span>`;
    html += `<span class="badge ${sevClass}">${items.length}件</span>`;
    html += `</div>`;
    html += `<div class="check-group-body">`;

    for (const iss of items) {
      const sevCls = iss.severity === 'ERROR' ? 'sev-error' : iss.severity === 'WARN' ? 'sev-warn' : 'sev-info';
      html += `<div class="issue-card">`;
      html += `<span class="issue-severity ${sevCls}">${iss.severity}</span> ${esc(iss.message)}`;
      if (iss.location) html += `<div class="issue-location">📍 ${esc(iss.location)}</div>`;
      if (iss.detail) html += `<div class="issue-detail">${esc(iss.detail)}</div>`;
      if (iss.suggest) html += `<div class="issue-suggest">${esc(iss.suggest)}</div>`;
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  out.innerHTML = html;
}

function toggleGroup(header) {
  header.classList.toggle('open');
  const body = header.nextElementSibling;
  body.classList.toggle('open');
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════════════════════════════════════════════════════════════
// Auto Fix (COM-06a,b,d,e,f)
// ═══════════════════════════════════════════════════════════════════

/**
 * 文字列定数の外側だけにreplacerを適用する。
 * ""で囲まれた部分はそのまま保持する。
 */
function replaceOutsideStrings(text, replacer) {
  // この関数は現在使用していないが、将来の拡張用に残す
  const parts = [];
  let inString = false;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"' && !inString) {
      parts.push({ text: current, isString: false });
      current = '"';
      inString = true;
    } else if (text[i] === '"' && inString) {
      current += '"';
      parts.push({ text: current, isString: true });
      current = '';
      inString = false;
    } else {
      current += text[i];
    }
  }
  if (current) parts.push({ text: current, isString: inString });
  return parts.map(p => p.isString ? p.text : replacer(p.text)).join('');
}

function applyFixes(rawXml) {
  let fixed = rawXml;

  const exprTags = ['title', 'formula', 'member-criteria', 'condition', 'expression', 'local-mask'];

  for (const tag of exprTags) {
    const re = new RegExp(`(<${tag}(?:\\s[^>]*)?>)([\\s\\S]*?)(</${tag}>)`, 'g');
    fixed = fixed.replace(re, (match, open, content, close) => {
      if (!content.trim()) return match;

      let result = content;

      // COM-06a: メソッド名を小文字に
      result = result.replace(/\.([A-Z][a-zA-Z0-9_]*)/g, (m, name) => '.' + name.toLowerCase());

      // COM-06b: !の後のラベルを大文字に（@で始まるものは除外）
      result = result.replace(/!([#]?[a-zA-Z_][a-zA-Z0-9_]*)/g, (m, label) => {
        if (label.startsWith('@')) return m;
        return '!' + label.toUpperCase();
      });

      // COM-06d: 予約語を小文字に（"TRUE"/"FALSE"は保護）
      const PH_TRUE = '\x00PHTRUE\x00';
      const PH_FALSE = '\x00PHFALSE\x00';
      result = result.replace(/"TRUE"/g, PH_TRUE);
      result = result.replace(/"FALSE"/g, PH_FALSE);
      const reserved = ['DIMENSIONS', 'LEDGERS', 'EDITIONS', 'TRUE', 'FALSE', 'IF', 'THEN', 'ELSE', 'ENDIF', 'AND', 'OR', 'NOT'];
      for (const word of reserved) {
        result = result.replace(new RegExp('\\b' + word + '\\b', 'g'), word.toLowerCase());
      }
      result = result.replace(new RegExp('\x00PHTRUE\x00', 'g'), '"TRUE"');
      result = result.replace(new RegExp('\x00PHFALSE\x00', 'g'), '"FALSE"');

      // COM-06e: @関数を小文字に（@CUR/@POV/@RKEY除外）
      result = result.replace(/@([A-Z][a-zA-Z0-9_]*)/g, (m, name) => {
        if (['CUR', 'POV', 'RKEY'].includes(name)) return m;
        return '@' + name.toLowerCase();
      });

      // COM-06f: 疑似ラベルを大文字に
      result = result.replace(/@(cur|pov|rkey)/gi, (m, name) => '@' + name.toUpperCase());

      return open + result + close;
    });
  }

  return fixed;
}

async function autoFix() {
  const raw = xmlInput.value;
  const fixed = applyFixes(raw);
  const btn = document.getElementById('fixBtn');
  try {
    await navigator.clipboard.writeText(fixed);
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ コピーしました';
    setTimeout(() => btn.innerHTML = orig, 2000);
  } catch {
    // フォールバック
    const tmp = document.createElement('textarea');
    tmp.value = fixed;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ コピーしました';
    setTimeout(() => btn.innerHTML = orig, 2000);
  }
}

function autoFixAndRecheck() {
  const beforeIssues = [...lastResults];
  const raw = xmlInput.value;
  const fixed = applyFixes(raw);
  xmlInput.value = fixed;
  runCheck();
  // 修正前にあって修正後にないものを「解消済み」として記録
  const afterKeys = new Set(lastResults.map(i => `${i.code}|${i.message}|${i.location}`));
  resolvedIssues = beforeIssues.filter(i => !afterKeys.has(`${i.code}|${i.message}|${i.location}`));
}

// ═══════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════
async function exportText() {
  if (!lastResults.length && !resolvedIssues.length) return;

  const formatIssue = i =>
    `[${i.severity}] ${i.code}: ${i.message}${i.location ? ' @ ' + i.location : ''}${i.suggest ? ' ' + i.suggest : ''}`;

  let text = '';

  // 自動修正で解消されたアイテム
  if (resolvedIssues.length > 0) {
    text += `=== 自動修正で解消 (${resolvedIssues.length}件) ===\n`;
    text += resolvedIssues.map(formatIssue).join('\n');
    text += '\n\n';
  }

  // 残存する指摘
  if (lastResults.length > 0) {
    const label = resolvedIssues.length > 0 ? '残存する指摘' : 'チェック結果';
    text += `=== ${label} (${lastResults.length}件) ===\n`;
    text += lastResults.map(formatIssue).join('\n');
  } else if (resolvedIssues.length > 0) {
    text += '=== 残存する指摘 (0件) ===\n✓ すべて解消されました';
  }

  try {
    await navigator.clipboard.writeText(text);
    const btn = document.querySelector('#exportTextBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ コピーしました';
    setTimeout(() => btn.innerHTML = orig, 2000);
  } catch {
    prompt('コピーしてください:', text);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Copy XML
// ═══════════════════════════════════════════════════════════════════
async function copyXml() {
  const text = xmlInput.value;
  if (!text.trim()) return;
  const btn = document.getElementById('copyXmlBtn');
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ コピーしました';
    setTimeout(() => btn.innerHTML = orig, 2000);
  } catch {
    xmlInput.select();
    document.execCommand('copy');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ コピーしました';
    setTimeout(() => btn.innerHTML = orig, 2000);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Clear
// ═══════════════════════════════════════════════════════════════════
function clearAll() {
  xmlInput.value = '';
  document.getElementById('results').innerHTML = `<div class="result-empty">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
    XMLを入力してチェック実行</div>`;
  document.getElementById('exportBar').style.display = 'none';
  document.getElementById('fixBtn').disabled = true;
  document.getElementById('fixRunBtn').disabled = true;
  lastResults = [];
  resolvedIssues = [];
}

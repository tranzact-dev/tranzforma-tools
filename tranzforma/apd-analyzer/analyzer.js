// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════
let apdA           = null;   // { fileName, forms[], ledgers[], dims[], scripts[] }
let apdB           = null;
let compareResults = null;
let statusFilter   = 'ALL';
let migrateDir     = 'AtoB';
let activeResult   = null;   // { type: 'list'|'ledger'|'script'|'compare', side: 'A'|'B'|null }

// ═══════════════════════════════════════════════════════════════════
// Drop zone setup
// ═══════════════════════════════════════════════════════════════════
function setupDrop(dropId, inputId, onLoad) {
  const drop  = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) readFile(f, onLoad);
  });
  input.addEventListener('change', e => {
    if (e.target.files[0]) readFile(e.target.files[0], onLoad);
  });
}

function readFile(file, cb) {
  const r = new FileReader();
  r.onload = e => cb(e.target.result, file.name);
  r.readAsText(file, 'UTF-8');
}

// ═══════════════════════════════════════════════════════════════════
// APD Parsing
// ═══════════════════════════════════════════════════════════════════
function parseName(raw) {
  const en = (raw.match(/en;"([^"]*)"/) || [])[1] || '';
  const ja = (raw.match(/ja;"([^"]*)"/) || [])[1] || '';
  return { en, ja };
}

function loadAPD(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XMLの構文が正しくありません');
  return {
    forms:      parseForms(doc),
    ...parseLedgers(doc),
    transTables: parseTransTables(doc),
    scripts:    parseScripts(doc),
  };
}

// ─── 関連元帳の収集 ──────────────────────────────────────────────────
function collectRelatedLedgers(root) {
  const ledgers = new Set();

  // 1. デフォルト: document-spec直下の source-ledger-label
  const def = root.querySelector(':scope > source-ledger-label')?.textContent;
  if (def) ledgers.add(def);

  // 2. 列仕様: column-axis-spec > column-row-spec の source-ledger-label
  for (const crs of root.querySelectorAll('column-axis-spec column-row-spec')) {
    const v = crs.querySelector('source-ledger-label')?.textContent;
    if (v) ledgers.add(v);
  }

  // 3. 行仕様: row-axis-spec > column-row-spec の source-ledger-label
  for (const crs of root.querySelectorAll('row-axis-spec column-row-spec')) {
    const v = crs.querySelector('source-ledger-label')?.textContent;
    if (v) ledgers.add(v);
  }

  // 4. セル仕様: cell-spec の source-ledger-label
  for (const cell of root.querySelectorAll('cell-spec')) {
    const v = cell.querySelector('source-ledger-label')?.textContent;
    if (v) ledgers.add(v);
  }

  // 5. インポート仕様: import-spec > target-ledger-label
  const imp = root.querySelector('import-spec > target-ledger-label')?.textContent;
  if (imp) ledgers.add(imp);

  return [...ledgers].sort().join(',');
}

// ─── UPDATE_LEDGER 解析 ──────────────────────────────────────────────
function resolveLedger(root) {
  const relatedLedgers = collectRelatedLedgers(root);

  // Pattern 1: import enabled
  if (root.querySelector('import-spec > enabled')?.textContent === 'true') {
    const ledger = root.querySelector('import-spec > target-ledger-label')?.textContent || '';
    return { updateLedger: ledger, updateType: 'import', resolvedAt: 'target-ledger', relatedLedgers };
  }

  // Pattern 2: reflect-calc (cell-spec or column-row-spec)
  const cellsWithReflect = [...root.querySelectorAll('cell-spec')]
    .filter(cell => cell.querySelector('reflect-calc')?.textContent === 'true');

  // column-row-spec with reflect-calc=true (column side and row side)
  const colCrsWithReflect = [...root.querySelectorAll('column-axis-spec column-row-spec')]
    .filter(crs => crs.querySelector('reflect-calc')?.textContent === 'true');
  const rowCrsWithReflect = [...root.querySelectorAll('row-axis-spec column-row-spec')]
    .filter(crs => crs.querySelector('reflect-calc')?.textContent === 'true');

  const hasReflect = cellsWithReflect.length || colCrsWithReflect.length || rowCrsWithReflect.length;

  if (hasReflect) {
    // Build lookup maps for column-row-spec source-ledger-label
    const colSpecMap = new Map();
    for (const crs of root.querySelectorAll('column-axis-spec column-row-spec')) {
      const ledger = crs.querySelector('source-ledger-label')?.textContent;
      if (ledger) colSpecMap.set(crs.getAttribute('id'), ledger);
    }
    const rowSpecMap = new Map();
    for (const crs of root.querySelectorAll('row-axis-spec column-row-spec')) {
      const ledger = crs.querySelector('source-ledger-label')?.textContent;
      if (ledger) rowSpecMap.set(crs.getAttribute('id'), ledger);
    }

    const defaultLedger = root.querySelector(':scope > source-ledger-label')?.textContent || '';
    const ledgers = new Set();
    let firstResolvedAt = '';

    // cell-spec: priority chain cell > column > row > default
    for (const cell of cellsWithReflect) {
      const colId = cell.getAttribute('column-id');
      const rowId = cell.getAttribute('row-id');

      const cellLedger = cell.querySelector('source-ledger-label')?.textContent;
      if (cellLedger) {
        ledgers.add(cellLedger);
        if (!firstResolvedAt) firstResolvedAt = 'cell';
        continue;
      }
      const colLedger = colSpecMap.get(colId);
      if (colLedger) {
        ledgers.add(colLedger);
        if (!firstResolvedAt) firstResolvedAt = 'column';
        continue;
      }
      const rowLedger = rowSpecMap.get(rowId);
      if (rowLedger) {
        ledgers.add(rowLedger);
        if (!firstResolvedAt) firstResolvedAt = 'row';
        continue;
      }
      if (defaultLedger) {
        ledgers.add(defaultLedger);
        if (!firstResolvedAt) firstResolvedAt = 'default';
      }
    }

    // column-row-spec (column side): own source-ledger-label > default
    for (const crs of colCrsWithReflect) {
      const own = crs.querySelector('source-ledger-label')?.textContent;
      if (own) {
        ledgers.add(own);
        if (!firstResolvedAt) firstResolvedAt = 'column';
      } else if (defaultLedger) {
        ledgers.add(defaultLedger);
        if (!firstResolvedAt) firstResolvedAt = 'default';
      }
    }

    // column-row-spec (row side): own source-ledger-label > default
    for (const crs of rowCrsWithReflect) {
      const own = crs.querySelector('source-ledger-label')?.textContent;
      if (own) {
        ledgers.add(own);
        if (!firstResolvedAt) firstResolvedAt = 'row';
      } else if (defaultLedger) {
        ledgers.add(defaultLedger);
        if (!firstResolvedAt) firstResolvedAt = 'default';
      }
    }

    if (ledgers.size > 0) {
      const resolvedLedger = [...ledgers].sort().join(',');
      return { updateLedger: resolvedLedger, updateType: 'reflect-calc', resolvedAt: firstResolvedAt, relatedLedgers };
    }
    return { updateLedger: '', updateType: 'reflect-calc', resolvedAt: '', relatedLedgers };
  }

  // No pattern matched
  return { updateLedger: '', updateType: '', resolvedAt: '', relatedLedgers };
}

// ─── フォーム ───────────────────────────────────────────────────────
function parseForms(doc) {
  const entry = doc.querySelector('entries > entry');
  if (!entry) throw new Error('entries > entry が見つかりません。APDファイルか確認してください。');

  const topElements = entry.querySelector(':scope > elements');
  if (!topElements) throw new Error('elements が見つかりません');

  const formListsContainers = [...topElements.children].filter(
    el => el.getAttribute('type') === 'FORM_LISTS'
  );

  const parser = new DOMParser();
  const forms  = [];

  for (const flContainer of formListsContainers) {
    const flElements = flContainer.querySelector(':scope > elements');
    if (!flElements) continue;

    for (const formList of flElements.children) {
      const flLabel = formList.getAttribute('label') || '';
      const flElems = formList.querySelector(':scope > elements');
      if (!flElems) continue;

      const nameEl    = [...flElems.children].find(el => el.getAttribute('type') === 'NAME');
      const flName    = parseName(nameEl?.querySelector('content')?.textContent || '');
      const flNameStr = flName.en || flName.ja;

      const formsContainer = [...flElems.children].find(el => el.getAttribute('type') === 'FORMS');
      if (!formsContainer) continue;
      const formsElements = formsContainer.querySelector(':scope > elements');
      if (!formsElements) continue;

      for (const form of [...formsElements.children].filter(el => el.getAttribute('type') === 'FORM')) {
        const formLabel = form.getAttribute('label') || '';
        const formElems = form.querySelector(':scope > elements');
        if (!formElems) continue;

        const docSpec    = [...formElems.children].find(el => {
          const t = el.getAttribute('type');
          return t === 'DOCUMENT_SPEC' || t === 'SIMPLE_DOCUMENT_SPEC';
        });
        const xmlContent = docSpec?.querySelector('content')?.textContent?.trim() || '';

        const fd = {
          flLabel, flName: flNameStr, formLabel,
          formNameJa: '', formNameEn: '',
          reflectCalc: '', import: '', export: '',
          parameters: '', triggers: '', drillDowns: '',
          updateLedger: '', updateType: '', resolvedAt: '', relatedLedgers: '',
          xml: xmlContent
        };

        if (xmlContent) {
          try {
            const fDoc = parser.parseFromString(xmlContent, 'application/xml');
            if (!fDoc.querySelector('parsererror')) {
              const root = fDoc.documentElement;
              const np   = parseName(root.querySelector(':scope > name')?.textContent || '');
              fd.formNameJa = np.ja;
              fd.formNameEn = np.en;
              fd.reflectCalc = [...root.querySelectorAll('reflect-calc')]
                .some(el => el.textContent === 'true') ? 'ON' : '';
              fd.import = root.querySelector('import-spec > enabled')?.textContent === 'true' ? 'ON' : '';
              fd.export = root.querySelector('export-spec > enabled')?.textContent === 'true' ? 'ON' : '';
              fd.parameters = [...root.querySelectorAll(
                'parameter-specs > parameter-spec > member-list-spec > dimension-label'
              )].map(el => el.textContent).join(',');
              fd.triggers = [...root.querySelectorAll('triggers > trigger > action')]
                .map(el => {
                  const type  = el.querySelector('type')?.textContent  || '';
                  const label = el.querySelector('label')?.textContent || '';
                  return `${type}:${label}`;
                }).join(',');

              // Drill-down targets
              const ddForms = new Set();
              for (const dd of root.querySelectorAll('drill-down-spec')) {
                if (dd.querySelector('enabled')?.textContent !== 'true') continue;
                const target = dd.querySelector('form')?.textContent?.trim();
                if (target) ddForms.add(target);
              }
              fd.drillDowns = [...ddForms].join(',');

              // UPDATE_LEDGER resolution
              const ledgerInfo = resolveLedger(root);
              fd.updateLedger   = ledgerInfo.updateLedger;
              fd.updateType     = ledgerInfo.updateType;
              fd.resolvedAt     = ledgerInfo.resolvedAt;
              fd.relatedLedgers = ledgerInfo.relatedLedgers;
            }
          } catch (_) {}
        }
        forms.push(fd);
      }
    }
  }
  return forms;
}

// ─── 元帳設定 ──────────────────────────────────────────────────────
function parseLedgers(doc) {
  const appEntry = [...doc.querySelectorAll('entries > entry')]
    .find(e => e.getAttribute('type') === 'APPLICATION')
    || doc.querySelector('entries > entry');

  const topElems = appEntry?.querySelector(':scope > elements');
  if (!topElems) return { ledgers: [], dims: [] };

  const ledgersContainer = [...topElems.children]
    .find(e => e.getAttribute('type') === 'LEDGERS');
  if (!ledgersContainer) return { ledgers: [], dims: [] };

  const ledgerElems = ledgersContainer.querySelector(':scope > elements');
  if (!ledgerElems) return { ledgers: [], dims: [] };

  const ledgers = [];
  const allDims = new Set();

  for (const node of [...ledgerElems.children].filter(e => e.getAttribute('type') === 'LEDGER')) {
    const label    = node.getAttribute('label') || '';
    const elems    = node.querySelector(':scope > elements');
    const nameEl   = elems ? [...elems.children].find(e => e.getAttribute('type') === 'NAME') : null;
    const nm       = parseName(nameEl?.querySelector('content')?.textContent || '');

    const usedDimsEl  = elems ? [...elems.children].find(e => e.getAttribute('type') === 'USED_DIMENSIONS') : null;
    const dimsElems   = usedDimsEl?.querySelector(':scope > elements');
    const dims        = dimsElems
      ? [...dimsElems.children]
          .filter(e => e.getAttribute('type') === 'USED_DIMENSION')
          .map(e => e.getAttribute('label') || '')
      : [];

    dims.forEach(d => allDims.add(d));
    ledgers.push({ label, nameJa: nm.ja, nameEn: nm.en, dims });
  }

  return { ledgers, dims: [...allDims].sort() };
}

// ─── 変換表 ────────────────────────────────────────────────────────
function parseTransTables(doc) {
  const appEntry = [...doc.querySelectorAll('entries > entry')]
    .find(e => e.getAttribute('type') === 'APPLICATION')
    || doc.querySelector('entries > entry');

  const topElems = appEntry?.querySelector(':scope > elements');
  if (!topElems) return [];

  const tablesContainer = [...topElems.children]
    .find(e => e.getAttribute('type') === 'TRANSLATION_TABLES');
  if (!tablesContainer) return [];

  const tablesElems = tablesContainer.querySelector(':scope > elements');
  if (!tablesElems) return [];

  return [...tablesElems.children]
    .filter(e => e.getAttribute('type') === 'TRANSLATION_TABLE')
    .map(node => {
      const label = node.getAttribute('label') || '';
      const elems = node.querySelector(':scope > elements');
      if (!elems) return { label, nameJa: '', nameEn: '', customizable: '', rules: [] };

      const nameEl = [...elems.children].find(e => e.getAttribute('type') === 'NAME');
      const nm     = parseName(nameEl?.querySelector('content')?.textContent || '');

      const customizable = [...elems.children].find(e => e.getAttribute('type') === 'CUSTOMIZABLE')
        ?.querySelector('content')?.textContent || '';

      const rulesContainer = [...elems.children].find(e => e.getAttribute('type') === 'TRANSLATION_RULES');
      const rulesElems     = rulesContainer?.querySelector(':scope > elements');
      const rules = rulesElems
        ? [...rulesElems.children]
            .filter(e => e.getAttribute('type') === 'TRANSLATION_RULE')
            .map(r => {
              const re = r.querySelector(':scope > elements');
              const pre  = re ? [...re.children].find(e => e.getAttribute('type') === 'PRE')?.querySelector('content')?.textContent  || '' : '';
              const post = re ? [...re.children].find(e => e.getAttribute('type') === 'POST')?.querySelector('content')?.textContent || '' : '';
              return { pre, post };
            })
        : [];

      return { label, nameJa: nm.ja, nameEn: nm.en, customizable, rules };
    });
}

// ─── スクリプト ────────────────────────────────────────────────────
function parseScripts(doc) {
  const appEntry = [...doc.querySelectorAll('entries > entry')]
    .find(e => e.getAttribute('type') === 'APPLICATION')
    || doc.querySelector('entries > entry');

  const topElems = appEntry?.querySelector(':scope > elements');
  if (!topElems) return [];

  const scriptsContainer = [...topElems.children]
    .find(e => e.getAttribute('type') === 'SCRIPTS');
  if (!scriptsContainer) return [];

  const scriptsElems = scriptsContainer.querySelector(':scope > elements');
  if (!scriptsElems) return [];

  return [...scriptsElems.children]
    .filter(e => e.getAttribute('type') === 'SCRIPT')
    .map(node => {
      const label  = node.getAttribute('label') || '';
      const elems  = node.querySelector(':scope > elements');
      if (!elems) return { label, nameJa: '', nameEn: '', hasErrors: '', scriptText: '' };
      const nameEl = [...elems.children].find(e => e.getAttribute('type') === 'NAME');
      const nm     = parseName(nameEl?.querySelector('content')?.textContent || '');
      const hasErrors  = [...elems.children].find(e => e.getAttribute('type') === 'HAS_ERRORS')
        ?.querySelector('content')?.textContent || '';
      const scriptText = [...elems.children].find(e => e.getAttribute('type') === 'SCRIPT_TEXT')
        ?.querySelector('content')?.textContent || '';
      return { label, nameJa: nm.ja, nameEn: nm.en, hasErrors, scriptText };
    });
}

// ═══════════════════════════════════════════════════════════════════
// APD load handlers
// ═══════════════════════════════════════════════════════════════════
function onApdLoaded(side, text, fileName) {
  try {
    const data = { fileName, ...loadAPD(text) };
    if (side === 'A') apdA = data; else apdB = data;

    const dropEl = document.getElementById(`drop${side}`);
    dropEl.classList.add('loaded');
    dropEl.querySelector('.drop-filename').textContent =
      `${fileName} (フォーム:${data.forms.length} / 台帳:${data.ledgers.length} / 変換表:${data.transTables.length} / スクリプト:${data.scripts.length})`;

    ['list', 'ledger', 'trans', 'script', 'graph', 'formgen'].forEach(t =>
      document.getElementById(`${t}Btn${side}`).disabled = false
    );
    document.getElementById('compareBtn').disabled = !(apdA && apdB);

    if (compareResults) {
      compareResults = null;
      hideAllResults();
    }

    showToast(`[${side}] ${data.forms.length}件のフォームを読み込みました`);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

setupDrop('dropA', 'fileA', (t, f) => onApdLoaded('A', t, f));
setupDrop('dropB', 'fileB', (t, f) => onApdLoaded('B', t, f));

// ═══════════════════════════════════════════════════════════════════
// Result visibility
// ═══════════════════════════════════════════════════════════════════
const RESULT_TYPES = ['list', 'ledger', 'trans', 'script', 'graph', 'formgen', 'compare'];

function showResult(type) {
  RESULT_TYPES.forEach(t =>
    document.getElementById(`${t}Result`).style.display = t === type ? '' : 'none'
  );
  document.getElementById('resultArea').style.display = '';
}

function hideAllResults() {
  RESULT_TYPES.forEach(t =>
    document.getElementById(`${t}Result`).style.display = 'none'
  );
  document.getElementById('resultArea').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════
// フォーム一覧
// ═══════════════════════════════════════════════════════════════════
function renderListResult(side) {
  const apd = side === 'A' ? apdA : apdB;
  if (!apd) return;
  activeResult = { type: 'list', side };
  showResult('list');

  document.getElementById('listSummary').textContent =
    `[APD-${side}] ${apd.fileName} — ${apd.forms.length}件`;

  // 検索状態リセット
  document.getElementById('listSearchInput').value = '';
  document.getElementById('clearFilterBtn').style.display = 'none';
  document.getElementById('filterSummary').textContent = '';

  renderFormRows(apd.forms);
}

async function downloadFormZip() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd || !apd.forms.length) { showToast('フォームがありません', 'error'); return; }
  if (typeof JSZip === 'undefined') {
    showToast('JSZipが読み込めません。インターネット接続を確認してください。', 'error'); return;
  }
  const forms = getFilteredForms(apd);
  if (!forms.length) { showToast('対象フォームがありません', 'error'); return; }
  const zip = new JSZip();
  for (const f of forms) {
    if (f.xml) zip.file(`${f.formLabel}.txt`, f.xml);
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const blob    = await zip.generateAsync({ type: 'blob' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = `forms_APD-${activeResult.side}_${dateStr}.zip`;
  a.click(); URL.revokeObjectURL(url);
  const suffix = document.getElementById('includeBK').checked ? '' : '（BK除外）';
  showToast(`${forms.length}件のフォームをダウンロードしました${suffix}`);
}

function renderFormRows(forms) {
  document.getElementById('listTbody').innerHTML = forms.map(f => `
    <tr>
      <td class="label-cell">${esc(f.flLabel)}</td>
      <td>${esc(f.flName)}</td>
      <td class="label-cell">${esc(f.formLabel)}</td>
      <td>${esc(f.formNameJa)}</td>
      <td>${esc(f.formNameEn)}</td>
      <td class="${f.import      ? 'on' : ''}">${esc(f.import)}</td>
      <td class="${f.export      ? 'on' : ''}">${esc(f.export)}</td>
      <td class="${f.reflectCalc ? 'on' : ''}">${esc(f.reflectCalc)}</td>
      <td class="params">${esc(f.relatedLedgers)}</td>
      <td class="${f.updateLedger.includes(',') ? 'on' : ''}" style="${f.updateLedger.includes(',') ? 'color:var(--warn)' : ''}">${esc(f.updateLedger)}</td>
      <td>${esc(f.updateType)}</td>
      <td>${esc(f.resolvedAt)}</td>
      <td class="params">${esc(f.parameters)}</td>
      <td class="params">${esc(f.triggers)}</td>
    </tr>`).join('');
}

function filterList() {
  const query = document.getElementById('listSearchInput').value.trim();
  if (!query) { clearListFilter(); return; }

  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd) return;

  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const filtered = apd.forms.filter(f => f.xml && re.test(f.xml));

  document.getElementById('clearFilterBtn').style.display = '';
  document.getElementById('filterSummary').textContent = `${filtered.length} / ${apd.forms.length}件`;
  renderFormRows(filtered);
}

function clearListFilter() {
  document.getElementById('listSearchInput').value = '';
  document.getElementById('clearFilterBtn').style.display = 'none';
  document.getElementById('filterSummary').textContent = '';
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (apd) renderFormRows(apd.forms);
}

function getFilteredForms(apd) {
  const includeBK = document.getElementById('includeBK').checked;
  return includeBK ? apd.forms : apd.forms.filter(f => !f.formLabel.includes('_BK'));
}

function copyListTSV() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd) return;
  const forms  = getFilteredForms(apd);
  const header = 'FORM_LIST_LABEL\tFORM_LIST_NAME\tFORM_LABEL\tFORM_NAME_JA\tFORM_NAME_EN\tREFLECT_CALC\tIMPORT\tEXPORT\tRELATED_LEDGERS\tUPDATE_LEDGER\tUPDATE_TYPE\tRESOLVED_AT\tPARAMETERS\tTRIGGERS';
  const rows   = forms.map(f =>
    [f.flLabel, f.flName, f.formLabel, f.formNameJa, f.formNameEn,
     f.reflectCalc, f.import, f.export, f.relatedLedgers, f.updateLedger, f.updateType, f.resolvedAt,
     f.parameters, f.triggers].join('\t')
  );
  const suffix = document.getElementById('includeBK').checked ? '' : '（BK除外）';
  copyText([header, ...rows].join('\r\n'), 'TSVをコピーしました' + suffix);
}

// ═══════════════════════════════════════════════════════════════════
// 元帳設定
// ═══════════════════════════════════════════════════════════════════
function renderLedgerResult(side) {
  const apd = side === 'A' ? apdA : apdB;
  if (!apd) return;
  activeResult = { type: 'ledger', side };
  showResult('ledger');

  const { ledgers, dims } = apd;
  document.getElementById('ledgerSummary').textContent =
    `[APD-${side}] ${apd.fileName} — 台帳:${ledgers.length}件 / ディメンション:${dims.length}件`;

  // Header: ディメンション列 + 各台帳（label / nameJa）
  document.getElementById('ledgerThead').innerHTML = `
    <tr>
      <th>ディメンション</th>
      ${ledgers.map(l => `<th title="${esc(l.nameJa)}">${esc(l.label)}<br><span style="font-weight:400;opacity:0.7">${esc(l.nameJa)}</span></th>`).join('')}
    </tr>`;

  // Rows: 1行 = 1ディメンション
  document.getElementById('ledgerTbody').innerHTML = dims.map(dim => `
    <tr>
      <td class="label-cell">${esc(dim)}</td>
      ${ledgers.map(l => `<td class="${l.dims.includes(dim) ? 'on' : ''}">${l.dims.includes(dim) ? '●' : ''}</td>`).join('')}
    </tr>`).join('');
}

function copyLedgerTSV() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd) return;
  const { ledgers, dims } = apd;
  const row1 = ['', ...ledgers.map(l => l.nameJa)].join('\t');
  const row2 = ['DIMENSION', ...ledgers.map(l => l.label)].join('\t');
  const rows = dims.map(dim =>
    [dim, ...ledgers.map(l => l.dims.includes(dim) ? '1' : '')].join('\t')
  );
  copyText([row1, row2, ...rows].join('\r\n'), '元帳設定TSVをコピーしました');
}

// ═══════════════════════════════════════════════════════════════════
// 変換表
// ═══════════════════════════════════════════════════════════════════
function renderTransResult(side) {
  const apd = side === 'A' ? apdA : apdB;
  if (!apd) return;
  activeResult = { type: 'trans', side };
  showResult('trans');

  document.getElementById('transSummary').textContent =
    `[APD-${side}] ${apd.fileName} — ${apd.transTables.length}件`;

  document.getElementById('transTbody').innerHTML = apd.transTables.map(t => `
    <tr>
      <td class="label-cell">${esc(t.label)}</td>
      <td>${esc(t.nameJa)}</td>
      <td>${esc(t.nameEn)}</td>
      <td style="text-align:center">${t.customizable === 'true' ? '●' : ''}</td>
      <td style="text-align:center">${t.rules.length}</td>
    </tr>`).join('');
}

function copyTransTSV() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd) return;
  const header = 'LABEL\tNAME_JA\tNAME_EN\tCUSTOMIZABLE\tRULE_COUNT';
  const rows   = apd.transTables.map(t =>
    [t.label, t.nameJa, t.nameEn, t.customizable, t.rules.length].join('\t')
  );
  copyText([header, ...rows].join('\r\n'), '変換表一覧TSVをコピーしました');
}

function escCsv(v) {
  const s = String(v || '');
  return s.match(/[,"\r\n]/) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function downloadTransZip(fmt) {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd || !apd.transTables.length) { showToast('変換表がありません', 'error'); return; }
  if (typeof JSZip === 'undefined') {
    showToast('JSZipが読み込めません。インターネット接続を確認してください。', 'error'); return;
  }
  const sep = fmt === 'tsv' ? '\t' : ',';
  const ext = fmt === 'tsv' ? 'tsv' : 'csv';
  const esc = fmt === 'tsv' ? (v => String(v || '')) : escCsv;

  const zip = new JSZip();
  for (const t of apd.transTables) {
    const lines = [
      `CLEAR-TRANSLATION-TABLE${sep}${sep}${sep}`,
      `ADD-TRANSLATION-RULE${sep}HDR${sep}CODE_TO_TRANSLATE${sep}TRANSLATED_CODE`,
      ...t.rules.map(r => `ADD-TRANSLATION-RULE${sep}DTL${sep}${esc(r.pre)}${sep}${esc(r.post)}`),
    ];
    zip.file(`TransTable_${t.label}.${ext}`, lines.join('\r\n'));
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const blob    = await zip.generateAsync({ type: 'blob' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = `transtables_APD-${activeResult.side}_${dateStr}_${fmt}.zip`;
  a.click(); URL.revokeObjectURL(url);
  showToast(`${apd.transTables.length}件の変換表をダウンロードしました (${fmt.toUpperCase()})`);
}

// ═══════════════════════════════════════════════════════════════════
// スクリプト
// ═══════════════════════════════════════════════════════════════════
function renderScriptResult(side) {
  const apd = side === 'A' ? apdA : apdB;
  if (!apd) return;
  activeResult = { type: 'script', side };
  showResult('script');

  document.getElementById('scriptSummary').textContent =
    `[APD-${side}] ${apd.fileName} — ${apd.scripts.length}件`;

  document.getElementById('scriptTbody').innerHTML = apd.scripts.map(s => `
    <tr>
      <td class="label-cell">${esc(s.label)}</td>
      <td>${esc(s.nameJa)}</td>
      <td>${esc(s.nameEn)}</td>
      <td class="${s.hasErrors === 'true' ? 'on' : ''}" style="${s.hasErrors === 'true' ? 'color:var(--error)' : ''}">${s.hasErrors === 'true' ? 'あり' : ''}</td>
    </tr>`).join('');
}

function copyScriptTSV() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd) return;
  const header = 'LABEL\tNAME_JA\tNAME_EN\tHAS_ERRORS';
  const rows   = apd.scripts.map(s =>
    [s.label, s.nameJa, s.nameEn, s.hasErrors].join('\t')
  );
  copyText([header, ...rows].join('\r\n'), 'スクリプト一覧TSVをコピーしました');
}

async function downloadScriptZip() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd || !apd.scripts.length) { showToast('スクリプトがありません', 'error'); return; }
  if (typeof JSZip === 'undefined') {
    showToast('JSZipが読み込めません。インターネット接続を確認してください。', 'error'); return;
  }
  const zip = new JSZip();
  for (const s of apd.scripts) {
    zip.file(`Script_${s.label}.txt`, s.scriptText);
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const blob    = await zip.generateAsync({ type: 'blob' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href     = url;
  a.download = `scripts_APD-${activeResult.side}_${dateStr}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${apd.scripts.length}件のスクリプトをダウンロードしました`);
}

// ═══════════════════════════════════════════════════════════════════
// 差分比較
// ═══════════════════════════════════════════════════════════════════
function runCompare() {
  if (!apdA || !apdB) return;

  const mapA = new Map(apdA.forms.map(f => [f.formLabel, f]));
  const mapB = new Map(apdB.forms.map(f => [f.formLabel, f]));
  const allLabels = new Set([...mapA.keys(), ...mapB.keys()]);

  compareResults = [];
  for (const label of [...allLabels].sort()) {
    const inA = mapA.has(label), inB = mapB.has(label);
    let status, formA = mapA.get(label) || null, formB = mapB.get(label) || null;
    if (inA && !inB)      status = 'A_ONLY';
    else if (!inA && inB) status = 'B_ONLY';
    else                  status = formA.xml === formB.xml ? 'SAME' : 'DIFFERENT';
    compareResults.push({ label, status, formA, formB });
  }

  activeResult = { type: 'compare', side: null };
  statusFilter = 'ALL';
  showResult('compare');
  renderCompareResults();
  updateMigrateInfo();
  showToast(`比較完了: ${compareResults.length}件`);
}

function renderCompareResults() {
  if (!compareResults) return;

  const counts = { SAME: 0, DIFFERENT: 0, A_ONLY: 0, B_ONLY: 0 };
  compareResults.forEach(r => counts[r.status]++);

  const chipDefs = [
    { key: 'ALL',       label: `全件 ${compareResults.length}`, cls: 'total' },
    { key: 'DIFFERENT', label: `差分あり ${counts.DIFFERENT}`,  cls: 'diff' },
    { key: 'A_ONLY',    label: `Aのみ ${counts.A_ONLY}`,        cls: 'a-only' },
    { key: 'B_ONLY',    label: `Bのみ ${counts.B_ONLY}`,        cls: 'b-only' },
    { key: 'SAME',      label: `同一 ${counts.SAME}`,            cls: 'same' },
  ];
  document.getElementById('filterChips').innerHTML = chipDefs.map(d => `
    <span class="chip ${d.cls}${statusFilter === d.key ? ' active' : ''}"
          onclick="setStatusFilter('${d.key}')">${d.label}</span>`).join('');

  const filtered = statusFilter === 'ALL'
    ? compareResults : compareResults.filter(r => r.status === statusFilter);

  const stMap = {
    SAME:      `<span class="st st-same">SAME</span>`,
    DIFFERENT: `<span class="st st-diff">DIFFERENT</span>`,
    A_ONLY:    `<span class="st st-aonly">A ONLY</span>`,
    B_ONLY:    `<span class="st st-bonly">B ONLY</span>`,
  };
  const rowClass = { DIFFERENT: 'row-diff', A_ONLY: 'row-aonly', B_ONLY: 'row-bonly', SAME: '' };

  document.getElementById('compareTbody').innerHTML = filtered.map(r => {
    const f = r.formA || r.formB;
    return `<tr class="${rowClass[r.status]}">
      <td class="label-cell">${esc(r.label)}</td>
      <td>${stMap[r.status]}</td>
      <td>${esc(f?.flLabel || '')}</td>
      <td>${esc(f?.formNameJa || '')}</td>
      <td>${esc(f?.formNameEn || '')}</td>
      <td class="${f?.import      ? 'on' : ''}">${esc(f?.import      || '')}</td>
      <td class="${f?.export      ? 'on' : ''}">${esc(f?.export      || '')}</td>
      <td class="${f?.reflectCalc ? 'on' : ''}">${esc(f?.reflectCalc || '')}</td>
    </tr>`;
  }).join('');
}

function setStatusFilter(f) { statusFilter = f; renderCompareResults(); }

// ═══════════════════════════════════════════════════════════════════
// 移行
// ═══════════════════════════════════════════════════════════════════
function setDir(dir) {
  migrateDir = dir;
  document.getElementById('dirAtoB').classList.toggle('active', dir === 'AtoB');
  document.getElementById('dirBtoA').classList.toggle('active', dir === 'BtoA');
  updateMigrateInfo();
}

function getMigrateForms() {
  if (!compareResults) return [];
  return compareResults.filter(r =>
    migrateDir === 'AtoB'
      ? r.status === 'DIFFERENT' || r.status === 'A_ONLY'
      : r.status === 'DIFFERENT' || r.status === 'B_ONLY'
  ).map(r => ({
    formLabel: r.label, status: r.status,
    xml: (migrateDir === 'AtoB' ? r.formA : r.formB)?.xml || ''
  }));
}

function updateMigrateInfo() {
  const forms     = getMigrateForms();
  const dir       = migrateDir === 'AtoB' ? 'A → B' : 'B → A';
  const diffCount = forms.filter(f => f.status === 'DIFFERENT').length;
  const onlyCount = forms.filter(f => f.status !== 'DIFFERENT').length;
  document.getElementById('migrateInfo').innerHTML =
    `方向: <strong>${dir}</strong> &nbsp;|&nbsp; 対象: <strong>${forms.length}件</strong>` +
    (diffCount ? ` &nbsp;（差分あり ${diffCount}件 + ${migrateDir === 'AtoB' ? 'Aのみ' : 'Bのみ'} ${onlyCount}件）` : '');
}

async function downloadMigrate() {
  const forms = getMigrateForms();
  if (!forms.length) { showToast('移行対象のフォームがありません', 'error'); return; }
  if (typeof JSZip === 'undefined') {
    showToast('JSZipが読み込めません。インターネット接続を確認してください。', 'error'); return;
  }
  const zip = new JSZip();
  for (const f of forms) zip.file(`${f.formLabel}.txt`, f.xml);
  const dateStr = new Date().toISOString().slice(0, 10);
  const blob    = await zip.generateAsync({ type: 'blob' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = `migrate_${migrateDir === 'AtoB' ? 'A_to_B' : 'B_to_A'}_${dateStr}.zip`;
  a.click(); URL.revokeObjectURL(url);
  showToast(`${forms.length}件をダウンロードしました`);
}

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════
function copyText(text, msg) {
  navigator.clipboard.writeText(text).then(() => showToast(msg)).catch(() => {
    const tmp = document.createElement('textarea');
    tmp.value = text; document.body.appendChild(tmp);
    tmp.select(); document.execCommand('copy'); document.body.removeChild(tmp);
    showToast(msg);
  });
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent      = msg;
  t.style.background = type === 'error' ? 'var(--error)' : 'var(--ok)';
  t.style.color      = type === 'error' ? '#fff'         : '#0c0e14';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ═══════════════════════════════════════════════════════════════════
// 関連図 (Cytoscape.js)
// ═══════════════════════════════════════════════════════════════════
let cyInstance = null;

/**
 * スクリプト本文 (SCRIPT_TEXT) から参照しているフォームラベルを抽出する。
 * scriptText はプレーンテキスト形式で forms!LABEL.calculate(...) / forms!LABEL(...) を含む。
 * ※ fusion_place ではスクリプトから別スクリプトの呼び出しは不可。
 */
function parseScriptFormRefs(scriptText) {
  if (!scriptText) return [];
  const formSet = new Set();
  // forms!LABEL or forms!'LABEL' (シングルクォート囲みに対応)
  for (const m of scriptText.matchAll(/forms!'([^']+)'/g)) {
    formSet.add(m[1]);
  }
  for (const m of scriptText.matchAll(/forms!([A-Za-z0-9_]+)/g)) {
    formSet.add(m[1]);
  }
  return [...formSet];
}

function buildGraphData(apd, flFilter, includeBK) {
  const nodes = [];
  const edges = [];
  const ledgerSet   = new Set();
  const scriptSet   = new Set();
  const formNodeSet = new Set();
  const edgeIdSet   = new Set();

  // ルックアップ用マップ
  const allFormLabels   = new Set(apd.forms.map(f => f.formLabel));
  const allScriptLabels = new Set(apd.scripts.map(s => s.label));
  const formByLabel     = new Map(apd.forms.map(f => [f.formLabel, f]));
  const scriptByLabel   = new Map(apd.scripts.map(s => [s.label, s]));

  let seedForms = apd.forms;
  if (flFilter) seedForms = seedForms.filter(f => f.flLabel === flFilter);
  if (!includeBK) seedForms = seedForms.filter(f => !f.formLabel.includes('_BK'));

  // ── 起点スクリプトの収集 ──
  // フォームリストフィルタ時のみ: seedForms のラベルを参照しているスクリプトも起点に追加
  // フィルタなしの場合は全フォームが起点なのでトリガー経由でスクリプトに到達する
  const seedFormLabels = new Set(seedForms.map(f => f.formLabel));
  const seedScripts = [];
  if (flFilter) {
    for (const s of apd.scripts) {
      const refs = parseScriptFormRefs(s.scriptText);
      if (refs.some(label => seedFormLabels.has(label))) {
        seedScripts.push(s.label);
      }
    }
  }

  // ── 再帰探索用キュー ──
  const formQueue   = [...seedFormLabels];
  const scriptQueue = [...seedScripts];
  const processedForms   = new Set();
  const processedScripts = new Set();

  function addEdge(id, source, target, type, extra) {
    if (edgeIdSet.has(id)) return;
    edgeIdSet.add(id);
    edges.push({ data: { id, source, target, type, ...extra } });
  }

  function ensureFormNode(formLabel) {
    if (formNodeSet.has(formLabel)) return;
    formNodeSet.add(formLabel);
    const f = formByLabel.get(formLabel);
    nodes.push({
      data: {
        id: `form:${formLabel}`,
        label: formLabel,
        type: 'form',
        nameJa: f?.formNameJa || '',
        flLabel: f?.flLabel || '',
      }
    });
  }

  function ensureScriptNode(label) {
    if (scriptSet.has(label)) return;
    scriptSet.add(label);
    const s = scriptByLabel.get(label);
    nodes.push({
      data: {
        id: `script:${label}`,
        label: label,
        type: 'script',
        nameJa: s?.nameJa || '',
      }
    });
  }

  // ── フォーム・スクリプトのトリガーチェーンを再帰的にたどる ──
  function processForm(formLabel) {
    if (processedForms.has(formLabel)) return;
    processedForms.add(formLabel);

    if (!includeBK && formLabel.includes('_BK')) return;

    const f = formByLabel.get(formLabel);
    if (!f) return;

    ensureFormNode(formLabel);

    // Related ledgers → source edges (台帳→フォームへデータが流れる)
    if (f.relatedLedgers) {
      for (const ledger of f.relatedLedgers.split(',')) {
        ledgerSet.add(ledger);
        addEdge(`source:${ledger}:${formLabel}`,
          `ledger:${ledger}`, `form:${formLabel}`, 'source');
      }
    }

    // Update ledger → update edges
    if (f.updateLedger) {
      for (const ledger of f.updateLedger.split(',')) {
        ledgerSet.add(ledger);
        addEdge(`update:${formLabel}:${ledger}`,
          `form:${formLabel}`, `ledger:${ledger}`, 'update',
          { updateType: f.updateType });
      }
    }

    // Triggers → script / form edges
    if (f.triggers) {
      for (const trigger of f.triggers.split(',')) {
        const colonIdx = trigger.indexOf(':');
        if (colonIdx < 0) continue;
        const trigType = trigger.slice(0, colonIdx);
        const label    = trigger.slice(colonIdx + 1);
        if (!label) continue;

        if (trigType === 'RUN_SCRIPT' || allScriptLabels.has(label)) {
          ensureScriptNode(label);
          addEdge(`trigger:${formLabel}:${label}`,
            `form:${formLabel}`, `script:${label}`, 'trigger',
            { triggerType: trigType });
          scriptQueue.push(label);
        } else if (allFormLabels.has(label)) {
          ensureFormNode(label);
          addEdge(`trigger:${formLabel}:${label}`,
            `form:${formLabel}`, `form:${label}`, 'trigger',
            { triggerType: trigType });
          formQueue.push(label);
        }
      }
    }

    // Drill-down → form edges
    if (f.drillDowns) {
      for (const target of f.drillDowns.split(',')) {
        if (!target) continue;
        ensureFormNode(target);
        addEdge(`drilldown:${formLabel}:${target}`,
          `form:${formLabel}`, `form:${target}`, 'drilldown');
        formQueue.push(target);
      }
    }
  }

  function processScript(scriptLabel) {
    if (processedScripts.has(scriptLabel)) return;
    processedScripts.add(scriptLabel);

    const script = scriptByLabel.get(scriptLabel);
    if (!script?.scriptText) return;

    for (const targetForm of parseScriptFormRefs(script.scriptText)) {
      ensureFormNode(targetForm);
      addEdge(`trigger:${scriptLabel}:${targetForm}`,
        `script:${scriptLabel}`, `form:${targetForm}`, 'trigger',
        { triggerType: 'CALL_FORM' });
      formQueue.push(targetForm);
    }
  }

  // 両キューが空になるまで交互に処理（相互参照に対応）
  while (formQueue.length > 0 || scriptQueue.length > 0) {
    while (formQueue.length > 0) processForm(formQueue.shift());
    while (scriptQueue.length > 0) processScript(scriptQueue.shift());
  }

  // ── 元帳ノード ──
  for (const label of ledgerSet) {
    const ledgerInfo = apd.ledgers.find(l => l.label === label);
    nodes.push({
      data: {
        id: `ledger:${label}`,
        label: label,
        type: 'ledger',
        nameJa: ledgerInfo?.nameJa || '',
      }
    });
  }

  return { nodes, edges };
}

function renderGraphResult(side) {
  const apd = side === 'A' ? apdA : apdB;
  if (!apd) return;
  activeResult = { type: 'graph', side };
  showResult('graph');

  if (typeof cytoscape === 'undefined') {
    showToast('Cytoscape.jsが読み込めません。インターネット接続を確認してください。', 'error');
    return;
  }

  // Populate form-list filter
  const flSelect = document.getElementById('graphFlFilter');
  const flMap = new Map();
  for (const f of apd.forms) {
    if (!flMap.has(f.flLabel)) flMap.set(f.flLabel, f.flName || '');
  }
  const flEntries = [...flMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  flSelect.innerHTML = '<option value="">すべてのフォームリスト</option>'
    + flEntries.map(([label, name]) =>
        `<option value="${esc(label)}">${esc(label)}${name ? ' / ' + esc(name) : ''}</option>`
      ).join('');

  drawGraph(apd);
}

function applyGraphFilter() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd) return;
  drawGraph(apd);
}

function drawGraph(apd) {
  const flFilter  = document.getElementById('graphFlFilter').value || null;
  const includeBK = document.getElementById('graphIncludeBK').checked;
  const { nodes, edges } = buildGraphData(apd, flFilter, includeBK);
  const ledgerCount  = nodes.filter(n => n.data.type === 'ledger').length;
  const formCount    = nodes.filter(n => n.data.type === 'form').length;
  const scriptCount  = nodes.filter(n => n.data.type === 'script').length;
  document.getElementById('graphSummary').textContent =
    `[APD-${activeResult.side}] 元帳:${ledgerCount} / フォーム:${formCount} / スクリプト:${scriptCount} / エッジ:${edges.length}`;

  // Remove source edges if a corresponding update edge exists (avoid duplicate lines)
  // source: ledger→form, update: form→ledger なので正規化して比較
  const updateEdgePairs = new Set(
    edges.filter(e => e.data.type === 'update')
      .map(e => `${e.data.target}→${e.data.source}`)   // ledger→form に正規化
  );
  const filteredEdges = edges.filter(e =>
    e.data.type !== 'source' || !updateEdgePairs.has(`${e.data.source}→${e.data.target}`)
  );

  if (cyInstance) cyInstance.destroy();

  cyInstance = cytoscape({
    container: document.getElementById('cyContainer'),
    elements: [...nodes, ...filteredEdges],
    style: [
      // ── Nodes ──
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'font-size': 9,
          'font-family': '"IBM Plex Mono", monospace',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': 'data(textWidth)',
          'color': '#e0e4ee',
          'shape': 'round-rectangle',
          'corner-radius': 4,
          'width': 'label',
          'height': 'label',
          'padding': 8,
          'border-width': 1,
          'border-opacity': 0.5,
          'shadow-blur': 8,
          'shadow-color': '#000',
          'shadow-opacity': 0.4,
          'shadow-offset-x': 0,
          'shadow-offset-y': 2,
        }
      },
      {
        selector: 'node[type="ledger"]',
        style: {
          'background-color': '#2d6b4f',
          'border-color': '#3d9b6e',
        }
      },
      {
        selector: 'node[type="form"]',
        style: {
          'background-color': '#2d4a7a',
          'border-color': '#4a78c4',
        }
      },
      {
        selector: 'node[type="script"]',
        style: {
          'background-color': '#6b5a2d',
          'border-color': '#a08040',
        }
      },
      // ── Edges ──
      {
        selector: 'edge',
        style: {
          'width': 1,
          'curve-style': 'taxi',
          'taxi-direction': 'auto',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.7,
        }
      },
      {
        selector: 'edge[type="source"]',
        style: {
          'line-color': '#3a3f52',
          'target-arrow-color': '#3a3f52',
          'line-style': 'dotted',
          'opacity': 0.45,
          'width': 0.8,
        }
      },
      {
        selector: 'edge[type="update"]',
        style: {
          'line-color': '#a08040',
          'target-arrow-color': '#a08040',
          'width': 1.5,
        }
      },
      {
        selector: 'edge[type="trigger"]',
        style: {
          'line-color': '#7a50b0',
          'target-arrow-color': '#7a50b0',
          'line-style': 'dashed',
          'width': 1.2,
        }
      },
      {
        selector: 'edge[type="drilldown"]',
        style: {
          'line-color': '#4a90c4',
          'target-arrow-color': '#4a90c4',
          'line-style': 'dashed',
          'width': 1,
        }
      },
      // ── Hover / Selection ──
      {
        selector: 'node:selected',
        style: {
          'border-width': 2,
          'border-color': '#c0c8d8',
          'shadow-blur': 14,
          'shadow-opacity': 0.6,
          'text-background-color': '#13161f',
          'text-background-opacity': 0.85,
          'text-background-padding': '3px',
          'font-size': 12,
          'font-weight': 600,
          'z-index': 10,
        }
      },
      {
        selector: '.highlighted',
        style: { 'opacity': 1, 'z-index': 10 }
      },
      {
        selector: '.dimmed',
        style: { 'opacity': 0.1 }
      },
    ],
    layout: {
      name: 'cose',
      animate: false,
      nodeDimensionsIncludeLabels: true,
      nodeRepulsion: 8000,
      idealEdgeLength: 120,
      gravity: 0.3,
      padding: 40,
    },
    minZoom: 0.2,
    maxZoom: 4,
  });

  // ── Interaction: highlight connected nodes on tap ──
  cyInstance.on('tap', 'node', function (evt) {
    const node = evt.target;
    const connected = node.connectedEdges().connectedNodes().union(node);
    const connectedEdges = node.connectedEdges();

    cyInstance.elements().addClass('dimmed').removeClass('highlighted');
    connected.removeClass('dimmed').addClass('highlighted');
    connectedEdges.removeClass('dimmed').addClass('highlighted');
  });

  cyInstance.on('tap', function (evt) {
    if (evt.target === cyInstance) {
      cyInstance.elements().removeClass('dimmed highlighted');
    }
  });

  setupOverlayTracking();
  // Restore name overlay if checkbox is on
  if (document.getElementById('graphShowName').checked) renderNameOverlays();

  showToast(`関連図を描画しました（${nodes.length}ノード / ${filteredEdges.length}エッジ）`);
}

function copyEdgeListTSV() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd) return;
  const flFilter  = document.getElementById('graphFlFilter').value || null;
  const includeBK = document.getElementById('graphIncludeBK').checked;
  const { nodes, edges } = buildGraphData(apd, flFilter, includeBK);

  // ノードIDから名前を引くマップ
  const nameMap = new Map(nodes.map(n => [n.data.id, n.data.nameJa || '']));

  const header = 'FROM_TYPE\tFROM_LABEL\tFROM_NAME\tTO_TYPE\tTO_LABEL\tTO_NAME\tEDGE_TYPE\tDETAIL';
  const rows = edges.map(e => {
    const d = e.data;
    const [fromType, fromLabel] = d.source.split(':');
    const [toType, toLabel]     = d.target.split(':');
    const fromName = nameMap.get(d.source) || '';
    const toName   = nameMap.get(d.target) || '';
    const detail = d.type === 'update' ? (d.updateType || '')
                 : d.type === 'trigger' ? (d.triggerType || '') : '';
    return [fromType, fromLabel, fromName, toType, toLabel, toName, d.type, detail].join('\t');
  });
  copyText([header, ...rows].join('\r\n'), 'エッジリストTSVをコピーしました');
}

function downloadGraphPNG() {
  if (!cyInstance) return;
  const png = cyInstance.png({ output: 'blob', bg: '#0c0e14', scale: 2, full: true });
  const url = URL.createObjectURL(png);
  const a = document.createElement('a');
  a.href = url; a.download = `graph_APD-${activeResult.side}.png`;
  a.click(); URL.revokeObjectURL(url);
  showToast('PNGをダウンロードしました');
}

function downloadGraphSVG() {
  if (!cyInstance) return;

  const pad = 40;
  const bb = cyInstance.elements().boundingBox();
  const w = bb.w + pad * 2;
  const h = bb.h + pad * 2;
  const ox = bb.x1 - pad;
  const oy = bb.y1 - pad;

  const escXml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const nodeBg     = { ledger: '#2d6b4f', form: '#2d4a7a', script: '#6b5a2d' };
  const nodeBorder = { ledger: '#3d9b6e', form: '#4a78c4', script: '#a08040' };
  const nodeText   = { ledger: '#6ec99e', form: '#7aacef', script: '#d4b060' };
  const edgeColors = { source: '#3a3f52', update: '#a08040', trigger: '#7a50b0', drilldown: '#4a90c4' };
  const edgeDash   = { source: 'stroke-dasharray="4 3"', update: '', trigger: 'stroke-dasharray="8 4"', drilldown: 'stroke-dasharray="6 3"' };
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${ox} ${oy} ${w} ${h}" font-family="'IBM Plex Mono', monospace">\n`;
  svg += `<defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.4"/></filter></defs>\n`;
  svg += `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="#0c0e14"/>\n`;

  // Edges
  cyInstance.edges().forEach(edge => {
    const src = edge.sourceEndpoint();
    const tgt = edge.targetEndpoint();
    const type = edge.data('type');
    const color = edgeColors[type] || '#3a3f52';
    const dash = edgeDash[type] || '';
    const sw = type === 'update' ? 1.5 : type === 'trigger' ? 1.2 : 0.8;
    const opacity = type === 'source' ? 0.45 : 1;

    const midY = (src.y + tgt.y) / 2;
    svg += `<path d="M${src.x},${src.y} L${src.x},${midY} L${tgt.x},${midY} L${tgt.x},${tgt.y}" fill="none" stroke="${color}" stroke-width="${sw}" opacity="${opacity}" ${dash}/>\n`;

    const angle = Math.atan2(tgt.y - midY, tgt.x - tgt.x) || (tgt.y > midY ? Math.PI/2 : -Math.PI/2);
    const aLen = 6;
    const ax1 = tgt.x - aLen * Math.cos(angle - 0.4);
    const ay1 = tgt.y - aLen * Math.sin(angle - 0.4);
    const ax2 = tgt.x - aLen * Math.cos(angle + 0.4);
    const ay2 = tgt.y - aLen * Math.sin(angle + 0.4);
    svg += `<polygon points="${tgt.x},${tgt.y} ${ax1},${ay1} ${ax2},${ay2}" fill="${color}" opacity="${opacity}"/>\n`;
  });

  // Nodes
  cyInstance.nodes().forEach(node => {
    const pos = node.position();
    const d = node.data();
    const type = d.type;
    const bg = nodeBg[type] || '#2d4a7a';
    const border = nodeBorder[type] || '#4a78c4';
    const bb = node.boundingBox();
    const nw = bb.w;
    const nh = bb.h;

    // Rectangle with shadow
    svg += `<rect x="${pos.x - nw/2}" y="${pos.y - nh/2}" width="${nw}" height="${nh}" rx="4" fill="${bg}" stroke="${border}" stroke-width="1" filter="url(#shadow)"/>\n`;

    // Label inside node
    const label = d.label || '';
    const lines = label.split('\n');
    const lineH = 12;
    const totalH = lines.length * lineH;
    const startY = pos.y - totalH/2 + lineH * 0.75;
    lines.forEach((line, i) => {
      svg += `<text x="${pos.x}" y="${startY + i * lineH}" text-anchor="middle" fill="#e0e4ee" font-size="9">${escXml(line)}</text>\n`;
    });
  });

  svg += '</svg>';

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `graph_APD-${activeResult.side}.svg`;
  a.click(); URL.revokeObjectURL(url);
  showToast('SVGをダウンロードしました');
}

function toggleGraphLabel() {
  if (!cyInstance) return;
  const showName = document.getElementById('graphShowName').checked;
  clearNameOverlays();
  if (showName) renderNameOverlays();
}

function clearNameOverlays() {
  document.querySelectorAll('.cy-name-overlay').forEach(el => el.remove());
}

function renderNameOverlays() {
  if (!cyInstance) return;
  const container = document.getElementById('cyContainer');
  const pan = cyInstance.pan();
  const zoom = cyInstance.zoom();

  cyInstance.nodes().forEach(node => {
    const name = node.data('nameJa');
    if (!name) return;
    const pos = node.position();
    const bb = node.boundingBox();
    const x = (pos.x) * zoom + pan.x;
    const y = (bb.y2) * zoom + pan.y + 2;

    const el = document.createElement('div');
    el.className = 'cy-name-overlay';
    el.textContent = name;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.fontSize = Math.max(5, 7 * zoom) + 'px';
    container.appendChild(el);
  });
}

// Update overlay positions on pan/zoom
function setupOverlayTracking() {
  if (!cyInstance) return;
  const update = () => {
    if (document.getElementById('graphShowName').checked) {
      clearNameOverlays();
      renderNameOverlays();
    }
  };
  cyInstance.on('pan zoom', update);
}

// ═══════════════════════════════════════════════════════════════════
// フォーム生成 (POC) — ドラッグ&ドロップ式ディメンション配置
// ═══════════════════════════════════════════════════════════════════
let fgState = {
  side: null,
  ledger: null,
  // dimLabel → { zone, fixedValue, paramList }
  dims: {},
  // 順序を管理するゾーン（fixed/unassigned はラベル昇順なので不要）
  order: { parameter: [], 'row-loop': [], 'column-loop': [] },
};

const FG_ZONES = ['unassigned', 'fixed', 'fixed-total', 'fixed-none', 'parameter', 'row-loop', 'column-loop'];
const FG_ORDERED_ZONES = ['parameter', 'row-loop', 'column-loop'];

function renderFormGenResult(side) {
  const apd = side === 'A' ? apdA : apdB;
  if (!apd) return;
  fgState.side = side;
  activeResult = { type: 'formgen', side };
  showResult('formgen');

  const sel = document.getElementById('fgLedger');
  sel.innerHTML = '<option value="">-- 選択 --</option>'
    + apd.ledgers.map(l =>
        `<option value="${esc(l.label)}">${esc(l.label)}${l.nameJa ? ' / ' + esc(l.nameJa) : ''}</option>`
      ).join('');

  document.getElementById('fgFormLabel').value = '';
  document.getElementById('fgFormNameJa').value = '';
  document.getElementById('fgXmlOutput').textContent = '';
  document.getElementById('fgXmlPreview').style.display = 'none';
  document.getElementById('fgCopyBtn').style.display = 'none';
  document.getElementById('fgDlBtn').style.display = 'none';
  fgState.ledger = null;
  fgState.dims = {};
  fgState.order = { parameter: [], 'row-loop': [], 'column-loop': [] };
  fgClearBoard();
  fgSetupDropZones();
}

function fgSelectLedger() {
  const apd = fgState.side === 'A' ? apdA : apdB;
  const label = document.getElementById('fgLedger').value;
  const ledger = apd.ledgers.find(l => l.label === label);
  fgState.ledger = ledger || null;
  fgState.dims = {};
  fgState.order = { parameter: [], 'row-loop': [], 'column-loop': [] };
  fgClearBoard();

  if (!ledger) return;

  // デフォルトのラベルと名称
  document.getElementById('fgFormLabel').value = 'TRANZFORMA00';
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  document.getElementById('fgFormNameJa').value = ts;

  // 初期配置
  const paramDims = [];
  for (const dim of ledger.dims) {
    if (dim === '#VIEW') {
      fgState.dims[dim] = { zone: 'fixed', fixedValue: 'PER', paramList: '#ALL' };
    } else if (dim === '#CHANGE') {
      fgState.dims[dim] = { zone: 'fixed', fixedValue: '#NONE', paramList: '#ALL' };
    } else if (dim === '#FY' || dim === '#PERIOD' || dim === '#SCENARIO') {
      fgState.dims[dim] = { zone: 'parameter', fixedValue: '', paramList: '#ALL' };
      paramDims.push(dim);
    } else {
      fgState.dims[dim] = { zone: 'unassigned', fixedValue: '', paramList: '#ALL' };
    }
  }
  // パラメータの初期順序: #FY → #PERIOD → #SCENARIO
  const paramOrder = ['#FY', '#PERIOD', '#SCENARIO'];
  fgState.order.parameter = paramOrder.filter(d => paramDims.includes(d));

  fgRenderChips();
}

// ── ゾーンの表示順序を取得 ──
function fgGetDimsInZone(zone) {
  const dimsInZone = Object.entries(fgState.dims)
    .filter(([, d]) => d.zone === zone)
    .map(([dim]) => dim);

  if (['fixed', 'fixed-total', 'fixed-none', 'unassigned'].includes(zone)) {
    // ラベル昇順
    return dimsInZone.sort();
  }
  // 順序管理ゾーン: order 配列の順に並べ、order にないものは末尾に追加
  const order = fgState.order[zone] || [];
  const ordered = [];
  for (const dim of order) {
    if (dimsInZone.includes(dim)) ordered.push(dim);
  }
  for (const dim of dimsInZone) {
    if (!ordered.includes(dim)) ordered.push(dim);
  }
  return ordered;
}

function fgClearBoard() {
  for (const zone of FG_ZONES) {
    const drop = document.querySelector(`.fg-zone-drop[data-zone="${zone}"]`);
    if (drop) drop.innerHTML = '';
  }
}

function fgRenderChips() {
  fgClearBoard();
  for (const zone of FG_ZONES) {
    const drop = document.querySelector(`.fg-zone-drop[data-zone="${zone}"]`);
    if (!drop) continue;
    for (const dim of fgGetDimsInZone(zone)) {
      drop.appendChild(fgCreateChip(dim, fgState.dims[dim]));
    }
  }
}

function fgCreateChip(dim, info) {
  const chip = document.createElement('div');
  chip.className = 'fg-chip';
  chip.draggable = true;
  chip.dataset.dim = dim;

  const label = document.createElement('span');
  label.className = 'fg-chip-label';
  label.textContent = dim;
  chip.appendChild(label);

  if (info.zone === 'fixed') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fg-chip-input';
    input.value = info.fixedValue || '';
    input.placeholder = 'value';
    input.addEventListener('input', () => { fgState.dims[dim].fixedValue = input.value; });
    input.addEventListener('mousedown', e => e.stopPropagation());
    chip.appendChild(input);
  } else if (info.zone === 'parameter') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fg-chip-input';
    input.value = info.paramList || '#ALL';
    input.placeholder = '#ALL';
    input.addEventListener('input', () => { fgState.dims[dim].paramList = input.value; });
    input.addEventListener('mousedown', e => e.stopPropagation());
    chip.appendChild(input);
  }

  // 順序付きゾーンでは番号を表示
  if (FG_ORDERED_ZONES.includes(info.zone)) {
    const order = fgState.order[info.zone] || [];
    const idx = order.indexOf(dim);
    if (idx >= 0) {
      const num = document.createElement('span');
      num.className = 'fg-chip-num';
      num.textContent = idx + 1;
      chip.prepend(num);
    }
  }

  chip.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', dim);
    chip.classList.add('dragging');
  });
  chip.addEventListener('dragend', () => {
    chip.classList.remove('dragging');
  });

  return chip;
}

function fgSetupDropZones() {
  for (const zone of FG_ZONES) {
    const drop = document.querySelector(`.fg-zone-drop[data-zone="${zone}"]`);
    if (!drop) continue;

    drop.addEventListener('dragover', e => {
      e.preventDefault();
      drop.classList.add('drag-over');

      // 順序付きゾーン: ドロップ位置のインジケーターを表示
      if (FG_ORDERED_ZONES.includes(zone)) {
        fgUpdateInsertIndicator(drop, e.clientX);
      }
    });
    drop.addEventListener('dragleave', e => {
      // 子要素への移動でleaveが発火するのを防ぐ
      if (!drop.contains(e.relatedTarget)) {
        drop.classList.remove('drag-over');
        fgClearInsertIndicator(drop);
      }
    });
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      fgClearInsertIndicator(drop);
      const dim = e.dataTransfer.getData('text/plain');
      if (!dim || !fgState.dims[dim]) return;

      const oldZone = fgState.dims[dim].zone;

      // 旧ゾーンの order から削除
      if (FG_ORDERED_ZONES.includes(oldZone)) {
        const arr = fgState.order[oldZone];
        const idx = arr.indexOf(dim);
        if (idx >= 0) arr.splice(idx, 1);
      }

      // ゾーン変更
      fgState.dims[dim].zone = zone;

      // 固定値の自動設定
      if (zone === 'fixed') {
        if (dim === '#VIEW' && !fgState.dims[dim].fixedValue) fgState.dims[dim].fixedValue = 'PER';
        if (dim === '#CHANGE' && !fgState.dims[dim].fixedValue) fgState.dims[dim].fixedValue = '#NONE';
      } else if (zone === 'fixed-total') {
        fgState.dims[dim].fixedValue = 'TOTAL';
      } else if (zone === 'fixed-none') {
        fgState.dims[dim].fixedValue = 'NONE';
      } else {
        // 他ゾーンに移動した場合は固定値をクリア（#VIEW/#CHANGEは除く）
        if (dim !== '#VIEW' && dim !== '#CHANGE') fgState.dims[dim].fixedValue = '';
      }

      // 新ゾーンの order に挿入
      if (FG_ORDERED_ZONES.includes(zone)) {
        const insertIdx = fgCalcInsertIndex(drop, e.clientX, dim);
        fgState.order[zone].splice(insertIdx, 0, dim);
      }

      fgRenderChips();
    });
  }
}

// ── ゾーン内の挿入位置を計算 ──
function fgCalcInsertIndex(dropEl, clientX, dragDim) {
  const chips = [...dropEl.querySelectorAll('.fg-chip')].filter(c => c.dataset.dim !== dragDim);
  for (let i = 0; i < chips.length; i++) {
    const rect = chips[i].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return i;
  }
  return chips.length;
}

function fgUpdateInsertIndicator(dropEl, clientX) {
  fgClearInsertIndicator(dropEl);
  const chips = [...dropEl.querySelectorAll('.fg-chip:not(.dragging)')];
  for (const chip of chips) {
    const rect = chip.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      chip.classList.add('insert-before');
      return;
    }
  }
  // 末尾
  if (chips.length > 0) chips[chips.length - 1].classList.add('insert-after');
}

function fgClearInsertIndicator(dropEl) {
  for (const chip of dropEl.querySelectorAll('.fg-chip')) {
    chip.classList.remove('insert-before', 'insert-after');
  }
}

// ── XML 生成 ──
function fgGenerate() {
  if (!fgState.ledger) { showToast('元帳を選択してください', 'error'); return; }
  const formLabel = document.getElementById('fgFormLabel').value.trim();
  const nameJa = document.getElementById('fgFormNameJa').value.trim();
  if (!formLabel) { showToast('フォームラベルを入力してください', 'error'); return; }

  // 未割り当てチェック
  const unassigned = Object.entries(fgState.dims).filter(([, d]) => d.zone === 'unassigned');
  if (unassigned.length > 0) {
    showToast(`未割り当て: ${unassigned.map(([d]) => d).join(', ')}`, 'error'); return;
  }

  const assigns = fgState.dims;
  const ledger = fgState.ledger;

  // source-member-tuple（ラベル昇順）
  const fixedParts = [
    ...fgGetDimsInZone('fixed').filter(dim => assigns[dim].fixedValue).map(dim => `${dim}=${assigns[dim].fixedValue}`),
    ...fgGetDimsInZone('fixed-total').map(dim => `${dim}=TOTAL`),
    ...fgGetDimsInZone('fixed-none').map(dim => `${dim}=NONE`),
  ].sort();
  const sourceTuple = `{${fixedParts.join(', ')}}`;

  // name
  const nameStr = nameJa ? `ja;"${nameJa}"` : '';

  // 順序付きで取得
  const params  = fgGetDimsInZone('parameter').map(d => [d, assigns[d]]);
  const rowLoops = fgGetDimsInZone('row-loop').map(d => [d, assigns[d]]);
  const colLoops = fgGetDimsInZone('column-loop').map(d => [d, assigns[d]]);

  let idCounter = 1;
  const nextId = () => idCounter++;

  let xml = `<?xml version="1.0" encoding="UTF-8"?><document-spec label="${escXmlAttr(formLabel)}">\n`;
  xml += `  <name>${escXml(nameStr)}</name>\n`;
  xml += `  <source-ledger-label>${escXml(ledger.label)}</source-ledger-label>\n`;
  xml += `  <source-member-tuple>${escXml(sourceTuple)}</source-member-tuple>\n`;
  xml += `  <format>\n    <scale>0</scale>\n    <pattern>###,##0</pattern>\n  </format>\n`;
  xml += `  <report-format>\n`;
  xml += `    <page-size>A4</page-size>\n`;
  xml += `    <orientation>LANDSCAPE</orientation>\n`;
  xml += `    <suppress-row-title-headings>false</suppress-row-title-headings>\n`;
  xml += `    <row-title-width>16</row-title-width>\n`;
  xml += `    <row-title-indent>8</row-title-indent>\n`;
  xml += `    <row-wise-loop-layout>FIRST_DETAILS</row-wise-loop-layout>\n`;
  xml += `    <column-title-height>2</column-title-height>\n`;
  xml += `    <unit-indication/>\n`;
  xml += `  </report-format>\n`;
  xml += `  <flow-end-and-bal-net-writable>false</flow-end-and-bal-net-writable>\n`;

  if (params.length > 0) {
    xml += `  <parameter-specs>\n`;
    for (const [dim, a] of params) {
      xml += `    <parameter-spec>\n`;
      xml += `      <title></title>\n`;
      xml += `      <member-list-spec>\n`;
      xml += `        <dimension-label>${escXml(dim)}</dimension-label>\n`;
      xml += `        <type>EXPR</type>\n`;
      xml += `        <member-list-expression>\n`;
      xml += `          <peg-member type="ALL"/>\n`;
      xml += `          <expansion-method include-peg="true" method="NONE_EXPANSION" parent-first="true"/>\n`;
      xml += `          <member-criteria>#LEAF="TRUE"</member-criteria>\n`;
      xml += `        </member-list-expression>\n`;
      xml += `      </member-list-spec>\n`;
      xml += `    </parameter-spec>\n`;
    }
    xml += `  </parameter-specs>\n`;
  }

  xml += fgBuildAxisXml('column', colLoops, nextId);
  xml += fgBuildAxisXml('row', rowLoops, nextId);

  xml += `  <import-spec>\n`;
  xml += `    <enabled>false</enabled>\n`;
  xml += `    <transformation-spec>\n`;
  xml += `      <source-field-specs/>\n`;
  xml += `      <derived-field-specs/>\n`;
  xml += `    </transformation-spec>\n`;
  xml += `  </import-spec>\n`;
  xml += `  <export-spec>\n`;
  xml += `    <enabled>false</enabled>\n`;
  xml += `    <suppress-column-headers>false</suppress-column-headers>\n`;
  xml += `    <suppress-row-headers>false</suppress-row-headers>\n`;
  xml += `  </export-spec>\n`;
  xml += `</document-spec>`;

  document.getElementById('fgXmlOutput').textContent = xml;
  document.getElementById('fgXmlPreview').style.display = '';
  document.getElementById('fgCopyBtn').style.display = '';
  document.getElementById('fgDlBtn').style.display = '';
  showToast('XMLを生成しました');
}

function fgBuildAxisXml(axis, loops, nextId) {
  let xml = `  <${axis}-axis-spec>\n    <axis-spec>\n`;
  if (loops.length > 0) {
    // ネスト構造: 外→内の順にloop-specを入れ子にする
    // 最内側のloop-specにcolumn-row-specを配置
    xml += fgBuildNestedLoops(loops, 0, 6, nextId, axis);
  } else {
    const crsId = nextId();
    xml += `      <column-row-spec id="${crsId}" suppressed="false" suppress-borders="false">\n`;
    xml += `        <name></name>\n`;
    xml += `        <title></title>\n`;
    xml += `        <value-spec>\n`;
    xml += `          <source-member-tuple>{}</source-member-tuple>\n`;
    xml += `          <protected>false</protected>\n`;
    xml += `          <reflect-calc>false</reflect-calc>\n`;
    xml += `        </value-spec>\n`;
    xml += `      </column-row-spec>\n`;
  }
  xml += `    </axis-spec>\n  </${axis}-axis-spec>\n`;
  return xml;
}

function fgBuildNestedLoops(loops, depth, baseIndent, nextId, axis) {
  const pad = ' '.repeat(baseIndent + depth * 4);
  const [dim] = loops[depth];
  const loopId = nextId();
  const iap = axis === 'row' ? ' item-addition-prohibited="true"' : '';
  let xml = `${pad}<loop-spec id="${loopId}"${iap} suppress-if-no-data="true">\n`;
  xml += `${pad}    <member-list-spec>\n`;
  xml += `${pad}        <dimension-label>${escXml(dim)}</dimension-label>\n`;
  xml += `${pad}        <type>EXPR</type>\n`;
  xml += `${pad}        <member-list-expression>\n`;
  xml += `${pad}            <peg-member type="ALL"/>\n`;
  xml += `${pad}            <expansion-method include-peg="true" method="NONE_EXPANSION" parent-first="true"/>\n`;
  xml += `${pad}            <member-criteria>#LEAF="TRUE"</member-criteria>\n`;
  xml += `${pad}        </member-list-expression>\n`;
  xml += `${pad}        <member-list-label>#ALL</member-list-label>\n`;
  xml += `${pad}    </member-list-spec>\n`;

  if (depth < loops.length - 1) {
    // 内側のループを再帰的にネスト
    xml += fgBuildNestedLoops(loops, depth + 1, baseIndent, nextId, axis);
  } else {
    // 最内側: column-row-specを配置（タイトルにDIM!@CUR.descを自動設定）
    const crsId = nextId();
    const crsTitle = `en;"${dim}!@CUR.desc"`;
    xml += `${pad}    <column-row-spec id="${crsId}" suppressed="false" suppress-borders="false">\n`;
    xml += `${pad}        <name></name>\n`;
    xml += `${pad}        <title>${escXml(crsTitle)}</title>\n`;
    xml += `${pad}        <value-spec>\n`;
    xml += `${pad}            <source-member-tuple>{}</source-member-tuple>\n`;
    xml += `${pad}            <protected>false</protected>\n`;
    xml += `${pad}            <reflect-calc>false</reflect-calc>\n`;
    xml += `${pad}        </value-spec>\n`;
    xml += `${pad}    </column-row-spec>\n`;
  }

  xml += `${pad}</loop-spec>\n`;
  return xml;
}

function escXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escXmlAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fgCopyXml() {
  const xml = document.getElementById('fgXmlOutput').textContent;
  copyText(xml, 'XMLをコピーしました');
}

function fgDownloadXml() {
  const xml = document.getElementById('fgXmlOutput').textContent;
  const label = document.getElementById('fgFormLabel').value.trim() || 'form';
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${label}.xml`;
  a.click(); URL.revokeObjectURL(url);
  showToast('XMLをダウンロードしました');
}

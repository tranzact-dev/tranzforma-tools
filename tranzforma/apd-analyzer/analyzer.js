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
    forms:   parseForms(doc),
    ...parseLedgers(doc),
    scripts: parseScripts(doc),
  };
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
          parameters: '', triggers: '', xml: xmlContent
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
      `${fileName} (フォーム:${data.forms.length} / 台帳:${data.ledgers.length} / スクリプト:${data.scripts.length})`;

    ['list', 'ledger', 'script'].forEach(t =>
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
function showResult(type) {
  ['list', 'ledger', 'script', 'compare'].forEach(t =>
    document.getElementById(`${t}Result`).style.display = t === type ? '' : 'none'
  );
  document.getElementById('resultArea').style.display = '';
}

function hideAllResults() {
  ['list', 'ledger', 'script', 'compare'].forEach(t =>
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

  document.getElementById('listTbody').innerHTML = apd.forms.map(f => `
    <tr>
      <td class="label-cell">${esc(f.flLabel)}</td>
      <td>${esc(f.flName)}</td>
      <td class="label-cell">${esc(f.formLabel)}</td>
      <td>${esc(f.formNameJa)}</td>
      <td>${esc(f.formNameEn)}</td>
      <td class="${f.import      ? 'on' : ''}">${esc(f.import)}</td>
      <td class="${f.export      ? 'on' : ''}">${esc(f.export)}</td>
      <td class="${f.reflectCalc ? 'on' : ''}">${esc(f.reflectCalc)}</td>
      <td class="params">${esc(f.parameters)}</td>
      <td class="params">${esc(f.triggers)}</td>
    </tr>`).join('');
}

async function downloadFormZip() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd || !apd.forms.length) { showToast('フォームがありません', 'error'); return; }
  if (typeof JSZip === 'undefined') {
    showToast('JSZipが読み込めません。インターネット接続を確認してください。', 'error'); return;
  }
  const zip = new JSZip();
  for (const f of apd.forms) {
    if (f.xml) zip.file(`${f.formLabel}.txt`, f.xml);
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const blob    = await zip.generateAsync({ type: 'blob' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = `forms_APD-${activeResult.side}_${dateStr}.zip`;
  a.click(); URL.revokeObjectURL(url);
  showToast(`${apd.forms.length}件のフォームをダウンロードしました`);
}

function copyListTSV() {
  const apd = activeResult?.side === 'A' ? apdA : apdB;
  if (!apd) return;
  const header = 'FORM_LIST_LABEL\tFORM_LIST_NAME\tFORM_LABEL\tFORM_NAME_JA\tFORM_NAME_EN\tREFLECT_CALC\tIMPORT\tEXPORT\tPARAMETERS\tTRIGGERS';
  const rows   = apd.forms.map(f =>
    [f.flLabel, f.flName, f.formLabel, f.formNameJa, f.formNameEn,
     f.reflectCalc, f.import, f.export, f.parameters, f.triggers].join('\t')
  );
  copyText([header, ...rows].join('\r\n'), 'TSVをコピーしました');
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

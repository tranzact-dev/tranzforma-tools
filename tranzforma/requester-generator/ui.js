// ui.js - Requester Wizard: UI logic

let currentStep = 1;
let apdData = null;  // set after APD parse

// ── Step navigation ──────────────────────────────────────────────────

function goStep(n) {
  document.getElementById('step-' + currentStep).classList.add('hidden');
  document.getElementById('step-ind-' + currentStep).classList.remove('active');
  document.getElementById('step-ind-' + currentStep).classList.add('done');

  currentStep = n;
  document.getElementById('step-' + n).classList.remove('hidden');
  document.getElementById('step-ind-' + n).classList.add('active');
  document.getElementById('step-ind-' + n).classList.remove('done');

  if (n === 6) buildSummary();
  window.scrollTo(0, 0);
}

// ── APD loading ──────────────────────────────────────────────────────

function handleApdFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      apdData = parseAPD(e.target.result);
      showApdResult(file.name);
      populateFromApd();
      document.getElementById('step1-next').disabled = false;
    } catch (err) {
      showApdError(err.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function showApdResult(filename) {
  const d = apdData;
  const isEnterprise = d.applicationType === 'ENTERPRISE';
  document.getElementById('apd-result').innerHTML = `
    <div class="apd-summary">
      <div class="apd-filename">${filename}</div>
      <div class="apd-grid">
        <div class="apd-row"><span class="apd-key">APPLICATION</span><span class="apd-val">${d.application}</span></div>
        <div class="apd-row"><span class="apd-key">TYPE</span><span class="apd-val">${d.applicationType || '—'}</span></div>
        <div class="apd-row"><span class="apd-key">FORM</span><span class="apd-val">${d.forms.length} 件</span></div>
        <div class="apd-row"><span class="apd-key">DIMENSION</span><span class="apd-val">${d.dimensions.join(', ') || '—'}</span></div>
        <div class="apd-row"><span class="apd-key">#PERIOD Members</span><span class="apd-val">${d.periodMembers.join(', ') || '—'}</span></div>
        <div class="apd-row"><span class="apd-key">#SCENARIO</span><span class="apd-val">${d.scenarioMembers.length} 件</span></div>
        <div class="apd-row"><span class="apd-key">TRANSLATION TABLE</span><span class="apd-val">${d.translationTables.length} 件</span></div>
        <div class="apd-row"><span class="apd-key">SCRIPT</span><span class="apd-val">${d.scripts.length} 件</span></div>
        <div class="apd-row"><span class="apd-key">SCHEMA_VERSION</span><span class="apd-val">${d.schemaVersion || '—'}</span></div>
        <div class="apd-row"><span class="apd-key">Requester JAR</span><span class="apd-val">${jarFilename({ schemaVersion: d.schemaVersion })}</span></div>
      </div>
    </div>`;
  document.getElementById('apd-result').classList.remove('hidden');
  document.getElementById('apd-error').classList.add('hidden');
}

function showApdError(msg) {
  document.getElementById('apd-error').textContent = 'エラー: ' + msg;
  document.getElementById('apd-error').classList.remove('hidden');
  document.getElementById('apd-result').classList.add('hidden');
  document.getElementById('step1-next').disabled = true;
}

// ── Populate fields from APD data ────────────────────────────────────

function populateFromApd() {
  if (!apdData) return;

  // FORM select
  fillSelect('p-form', apdData.forms);
  onFormChange(); // load POV dims for the initially selected form

  // DIMENSION select
  fillSelect('p-dimension', apdData.dimensions);

  // SCRIPT select
  fillSelect('p-script', apdData.scripts);

  // TRANSLATION_TABLE select
  fillSelect('p-tt', apdData.translationTables);

  // Populate APD dimension datalist for loop dim suggestions
  const datalist = document.getElementById('apd-dim-list');
  if (datalist) {
    datalist.innerHTML = apdData.dimensions.map(d => `<option value="${d}">`).join('');
  }

  // PARTICIPANT hint based on application type
  const hint = document.getElementById('participant-hint');
  if (hint) {
    hint.textContent = apdData.applicationType === 'ENTERPRISE'
      ? 'ENTERPRISE アプリ: 業務責任単位名を入力してください'
      : 'WORKGROUP アプリ: #NONE を入力してください';
  }
  const scriptHint = document.getElementById('script-participant-hint');
  if (scriptHint) {
    scriptHint.textContent = apdData.applicationType === 'ENTERPRISE'
      ? 'ENTERPRISE アプリ: 業務責任単位名を入力してください'
      : 'WORKGROUP アプリ: #NONE を入力してください';
  }
}

function fillSelect(id, items) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = items.map(v => {
    const val = typeof v === 'string' ? v : v.label;
    return `<option value="${val}">${val}</option>`;
  }).join('');
}

function onFormChange() {
  const label = document.getElementById('p-form').value;
  const form = apdData && apdData.forms.find(f => f.label === label);
  const dims = form ? getFormParamDimensions(form.rawSpec) : [];
  populatePovRows(dims);
}

function buildPovValueInput(dim) {
  const opts = arr => arr.map(v => `<option value="${v}">${v}</option>`).join('');
  if (dim === '#FY' && apdData && apdData.fiscalYears.length)
    return `<select class="pov-val">${opts(apdData.fiscalYears)}</select>`;
  if (dim === '#PERIOD' && apdData && apdData.periodMembers.length)
    return `<select class="pov-val">${opts(apdData.periodMembers)}</select>`;
  if (dim === 'SCENARIO' && apdData && apdData.scenarioMembers.length)
    return `<select class="pov-val">${opts(apdData.scenarioMembers)}</select>`;
  return `<input type="text" class="pov-val" placeholder="値を入力">`;
}

function populatePovRows(dims) {
  const container = document.getElementById('pov-list');
  if (!container) return;
  if (dims.length === 0) {
    container.innerHTML = '<span class="hint">このフォームにはパラメータ次元がありません</span>';
    return;
  }
  container.innerHTML = dims.map(d => {
    const sid = d.replace(/[^a-zA-Z0-9]/g, '_');
    return `
      <div class="pov-row" data-dim="${d}">
        <span class="pov-dim-label">${d}</span>
        <div class="pov-modes">
          <label class="pov-mode-label">
            <input type="radio" name="pov-mode-${sid}" value="runtime" checked> 実行時指定
          </label>
          <label class="pov-mode-label">
            <input type="radio" name="pov-mode-${sid}" value="fixed"> 固定値:
          </label>
          <div class="pov-val-wrap hidden">${buildPovValueInput(d)}</div>
        </div>
      </div>`;
  }).join('');
}

// ── Request type UI ──────────────────────────────────────────────────

function updateReqTypeUI() {
  const v = document.querySelector('input[name=reqType]:checked').value;
  const formGroup = ['EXPORT_VALUES', 'IMPORT_VALUES', 'CALCULATE_BY_FORM'];
  const dimGroup  = ['UPDATE_DIMENSION', 'EXPORT_DIMENSION'];

  document.getElementById('param-form-group').classList.toggle('hidden', !formGroup.includes(v));
  document.getElementById('param-export-options').classList.toggle('hidden', v !== 'EXPORT_VALUES');
  document.getElementById('param-import-pov').classList.toggle('hidden', !formGroup.includes(v));
  document.getElementById('param-import-options').classList.toggle('hidden', v !== 'IMPORT_VALUES');
  document.getElementById('param-dim-group').classList.toggle('hidden', !dimGroup.includes(v));
  document.getElementById('param-role-field').classList.toggle('hidden', v !== 'UPDATE_DIMENSION');
  document.getElementById('param-export-dim-options').classList.toggle('hidden', v !== 'EXPORT_DIMENSION');
  document.getElementById('param-script-group').classList.toggle('hidden', v !== 'RUN_SCRIPT');
  document.getElementById('param-tt-group').classList.toggle('hidden', v !== 'IMPORT_TRANSLATION_TABLE');
}

// ── Config collection ────────────────────────────────────────────────

function getConfig() {
  return {
    applicationName:      apdData ? apdData.application : '',
    schemaVersion:        apdData ? apdData.schemaVersion : '',
    execMode:             'interactive',
    connType:             'envbat',
    serverType:           document.querySelector('input[name=serverType]:checked').value,
    reqType:              document.querySelector('input[name=reqType]:checked').value,
    pForm:                document.getElementById('p-form').value,
    pParticipant:         document.getElementById('p-participant').value.trim(),
    pDimension:           document.getElementById('p-dimension').value,
    pDimRole:             document.querySelector('input[name=dimRole]:checked')?.value || 'DESIGNER',
    pScript:              document.getElementById('p-script').value,
    pScriptParticipant:   document.getElementById('p-script-participant')?.value.trim() || 'ADMIN',
    pTT:                  document.getElementById('p-tt').value,
    exportFormat:         document.querySelector('input[name=exportFormat]:checked')?.value || 'omit',
    exportNewline:        document.querySelector('input[name=exportNewline]:checked')?.value || 'omit',
    exportQuoteStyle:     document.querySelector('input[name=exportQuoteStyle]:checked')?.value || 'omit',
    exportPovText:        document.getElementById('export-pov-text')?.value || '',
    importFormat:         document.querySelector('input[name=importFormat]:checked')?.value || 'omit',
    importNewline:        document.querySelector('input[name=importNewline]:checked')?.value || 'omit',
    importSeverity:       document.querySelector('input[name=importSeverity]:checked')?.value || 'INFO',
    formPovDims: Array.from(document.querySelectorAll('#pov-list .pov-row')).map(row => {
      const dim  = row.dataset.dim;
      const mode = row.querySelector('input[type=radio]:checked')?.value || 'runtime';
      const val  = row.querySelector('.pov-val');
      return { dim, mode, value: mode === 'fixed' ? (val ? val.value : '') : '' };
    }),
    scriptPovText:        document.getElementById('script-pov-text')?.value || '',
    exportDimFmtVer:      document.querySelector('input[name=exportDimFmtVer]:checked')?.value || 'omit',
    loopDims: (() => {
      const dims = [];
      const d1name = document.getElementById('loop-dim1-name').value.trim();
      const d1vals = document.getElementById('loop-dim1-values').value.trim();
      if (d1name && d1vals) dims.push({ dim: d1name, values: d1vals });
      const d2name = document.getElementById('loop-dim2-name').value.trim();
      const d2vals = document.getElementById('loop-dim2-values').value.trim();
      if (d2name && d2vals) dims.push({ dim: d2name, values: d2vals });
      return dims;
    })(),
    errLevel:             document.querySelector('input[name=errLevel]:checked').value,
  };
}

// ── Summary (Step 6) ─────────────────────────────────────────────────

function buildSummary() {
  const c = getConfig();
  const rows = [
    ['APPLICATION',        c.applicationName || '—'],
    ['接続情報',           `env.bat 参照（${c.serverType}）`],
    ['実行方式',           'インタラクティブ（手動実行）'],
    ['リクエストタイプ',   c.reqType],
  ];

  // Type-specific params
  if (['EXPORT_VALUES', 'IMPORT_VALUES', 'CALCULATE_BY_FORM'].includes(c.reqType)) {
    rows.push(['FORM',        c.pForm || '(未設定)']);
    rows.push(['PARTICIPANT', c.pParticipant || '(未設定)']);
  }
  if (c.reqType === 'EXPORT_VALUES') {
    if (c.exportFormat !== 'omit')      rows.push(['FORMAT',      c.exportFormat]);
    if (c.exportNewline !== 'omit')     rows.push(['NEWLINE_STYLE', c.exportNewline]);
    if (c.exportQuoteStyle !== 'omit')  rows.push(['QUOTE_STYLE', c.exportQuoteStyle]);
  }
  if (['EXPORT_VALUES', 'IMPORT_VALUES', 'CALCULATE_BY_FORM'].includes(c.reqType) && c.formPovDims && c.formPovDims.length) {
    const povDesc = c.formPovDims.map(p =>
      p.mode === 'fixed' ? `${p.dim}=${p.value}` : `${p.dim}(実行時)`
    ).join(', ');
    rows.push(['POV', povDesc]);
  }
  if (c.reqType === 'IMPORT_VALUES') {
    if (c.importFormat !== 'omit')    rows.push(['FORMAT',       c.importFormat]);
    if (c.importNewline !== 'omit')   rows.push(['NEWLINE_STYLE', c.importNewline]);
    if (c.importSeverity !== 'omit')  rows.push(['MIN_SEVERITY', c.importSeverity]);
  }
  if (['UPDATE_DIMENSION', 'EXPORT_DIMENSION'].includes(c.reqType)) {
    rows.push(['DIMENSION', c.pDimension || '(未設定)']);
  }
  if (c.reqType === 'UPDATE_DIMENSION') rows.push(['ROLE', c.pDimRole]);
  if (c.reqType === 'EXPORT_DIMENSION' && c.exportDimFmtVer !== 'omit') {
    rows.push(['FORMAT_VERSION', c.exportDimFmtVer]);
  }
  if (c.reqType === 'RUN_SCRIPT') {
    rows.push(['SCRIPT',      c.pScript || '(未設定)']);
    rows.push(['PARTICIPANT', c.pScriptParticipant || '(未設定)']);
  }
  if (c.reqType === 'IMPORT_TRANSLATION_TABLE') {
    rows.push(['TRANSLATION_TABLE', c.pTT || '(未設定)']);
  }

  if (c.loopDims && c.loopDims.length > 0) {
    const dim1 = c.loopDims[0];
    const dim2 = c.loopDims[1];
    rows.push(['ループ Dim1', `${dim1.dim} = ${dim1.values}`]);
    if (dim2) rows.push(['ループ Dim2', `${dim2.dim} = ${dim2.values}`]);
    const count1 = dim1.values.trim().split(/\s+/).length;
    const count2 = dim2 ? dim2.values.trim().split(/\s+/).length : 1;
    rows.push(['実行回数', `${count1 * count2}回`]);
  } else {
    rows.push(['ループ', 'なし（1回実行）']);
  }
  rows.push(['エラーハンドリング', c.errLevel === 'full' ? 'フル' : 'ミニマル']);

  const tbl = document.getElementById('summary-table');
  tbl.innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
}

// ── Individual file download / copy ──────────────────────────────────

function downloadSingleFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function downloadBat() { downloadSingleFile('run.bat', genRunBat(getConfig()), 'text/plain'); }
function downloadXml() { downloadSingleFile('request.xml', genRequestXml(getConfig()), 'application/xml'); }

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    const orig = btn.textContent;
    btn.textContent = '✓ コピー済み';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = orig; }, 1800);
  });
}

function copyBat(btn) { copyToClipboard(genRunBat(getConfig()), btn); }
function copyXml(btn) { copyToClipboard(genRequestXml(getConfig()), btn); }

// ── ZIP generation ───────────────────────────────────────────────────

async function generateZip() {
  if (typeof JSZip === 'undefined') {
    alert('JSZip の読み込み中です。インターネット接続を確認してください。');
    return;
  }

  const c = getConfig();
  const zip = new JSZip();
  const root = zip.folder('Requester');
  const proc = root.folder('process');

  root.file('env.bat', genEnvBat(c));
  root.file('README.txt', genReadme(c));
  proc.file('request.xml', genRequestXml(c));
  proc.file('run.bat', genRunBat(c));
  proc.file('logs/.gitkeep', '');

  const isExport = c.reqType === 'EXPORT_VALUES';
  const isImport = ['IMPORT_VALUES', 'UPDATE_DIMENSION', 'IMPORT_TRANSLATION_TABLE'].includes(c.reqType);
  const isBackup = c.reqType === 'BACKUP_APPLICATION';
  if (isExport) proc.file('csv/.gitkeep', '');
  if (isImport) {
    proc.file('src/.gitkeep', '');
    proc.file('response/.gitkeep', '');
  }
  if (isBackup) proc.file('response/.gitkeep', '');

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Requester.zip';
  a.click();
}

// ── Event listeners ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Step 1: APD file input
  const fileInput = document.getElementById('apd-file-input');
  fileInput.addEventListener('change', e => handleApdFile(e.target.files[0]));

  // Step 1: drag & drop
  const dropZone = document.getElementById('apd-drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleApdFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', () => fileInput.click());

  // Step 3: request type toggle
  document.querySelectorAll('input[name=reqType]').forEach(r => {
    r.addEventListener('change', updateReqTypeUI);
  });
  updateReqTypeUI(); // apply initial state

  // Step 3: FORM change → extract POV dimensions
  document.getElementById('p-form').addEventListener('change', onFormChange);

  // Step 3: POV row radio toggle (delegated - pov-list is dynamic)
  document.getElementById('pov-list').addEventListener('change', e => {
    if (e.target.type !== 'radio') return;
    const row = e.target.closest('.pov-row');
    if (!row) return;
    row.querySelector('.pov-val-wrap').classList.toggle('hidden', e.target.value === 'runtime');
  });

  // Step 4: show Dim2 block when Dim1 name has input
  document.getElementById('loop-dim1-name').addEventListener('input', function () {
    document.getElementById('loop-dim2-block').classList.toggle('hidden', !this.value.trim());
  });

});

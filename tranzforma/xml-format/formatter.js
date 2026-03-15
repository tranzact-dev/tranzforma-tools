// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════
let parsedDoc = null;
let nodeRegistry = {}; // nodeId → { element, type, axisLabel, path, ... }
let changes = {};      // nodeId → { field → value }
let selectedNodeId = null;
let nodeCounter = 0;
let crsGlobalCounter = { col: 0, row: 0 };

// ═══════════════════════════════════════════════════════════════════
// File Input & Drag-and-Drop
// ═══════════════════════════════════════════════════════════════════
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });

function readFile(f) {
  const r = new FileReader();
  r.onload = e => { document.getElementById('xmlInput').value = e.target.result; parseAndRender(); };
  r.readAsText(f);
}

// ═══════════════════════════════════════════════════════════════════
// Parse XML & Build Tree
// ═══════════════════════════════════════════════════════════════════
function parseAndRender() {
  const raw = document.getElementById('xmlInput').value.trim();
  if (!raw) return;

  const parser = new DOMParser();
  parsedDoc = parser.parseFromString(raw, 'application/xml');
  if (parsedDoc.querySelector('parsererror')) {
    showToast('XMLの構文が正しくありません', 'error');
    return;
  }

  nodeRegistry = {};
  changes = {};
  selectedNodeId = null;
  nodeCounter = 0;
  crsGlobalCounter = { col: 0, row: 0 };

  const root = parsedDoc.documentElement;
  const treeScroll = document.getElementById('treeScroll');
  let html = '';

  // Form-level node
  const label = root.getAttribute('label') || '(ラベルなし)';
  const formNodeId = 'node_form';
  nodeRegistry[formNodeId] = { element: root, type: 'form', axisLabel: '', path: 'フォーム' };
  html += `<div class="tree-section">`;
  html += `<div class="tree-section-title">フォーム</div>`;
  html += treeNodeHTML(formNodeId, '📋', 'badge-form', label, '', false);
  html += `</div>`;

  const axes = [
    { tag: 'column-axis-spec', label: '列軸', crsWord: '列仕様' },
    { tag: 'row-axis-spec',    label: '行軸', crsWord: '行仕様' }
  ];

  let totalNodes = 0;
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    html += `<div class="tree-section">`;
    html += `<div class="tree-section-title">${axis.label}</div>`;
    const { html: h, count } = buildAxisTree(axisEl, axis, '');
    html += h;
    totalNodes += count;
    html += `</div>`;
  }

  treeScroll.innerHTML = html;
  document.getElementById('treeCount').textContent = `${totalNodes}件`;
  document.getElementById('globalStrip').style.display = 'flex';
  document.getElementById('batchRow').style.display = 'flex';
  document.getElementById('applyBtn').style.display = 'flex';
  document.getElementById('g_rowWiseLayout').value = '';
  document.getElementById('g_protected').value = '';

  initBatchButtons();
  showEditEmpty();
}

function buildAxisTree(parent, axis, parentPath, parentLoopDim = null) {
  let html = '';
  let count = 0;

  if (parentPath === '') {
    if (axis.tag === 'column-axis-spec') crsGlobalCounter.col = 0;
    else crsGlobalCounter.row = 0;
  }

  for (const child of parent.children) {
    if (child.tagName === 'axis-spec') {
      const r = buildAxisTree(child, axis, parentPath, parentLoopDim);
      html += r.html; count += r.count;
    } else if (child.tagName === 'loop-spec') {
      const dim = getDimLabel(child);
      const id = assignNodeId(child);
      const path = parentPath
        ? parentPath + ' › ループ（' + dim + '）'
        : axis.label + ' › ループ（' + dim + '）';
      const suppressEmpty = child.getAttribute('suppress-if-no-data') === 'true';
      const itemProhibited = child.getAttribute('item-addition-prohibited') === 'true';
      nodeRegistry[id] = { element: child, type: 'loop', axisLabel: axis.label, path, axis };
      html += loopNodeHTML(id, dim, suppressEmpty, itemProhibited, axis.label);
      html += `<div class="tree-indent">`;
      const r = buildAxisTree(child, axis, path, dim);
      html += r.html; count += r.count;
      html += `</div>`;
      count++;
    } else if (child.tagName === 'column-row-spec') {
      const key = axis.tag === 'column-axis-spec' ? 'col' : 'row';
      crsGlobalCounter[key]++;
      const num = crsGlobalCounter[key];
      const lbl = child.getAttribute('label') || '';
      const suppressed = child.getAttribute('suppressed') === 'true';
      const id = assignNodeId(child);
      const path = parentPath
        ? parentPath + ' › ' + axis.crsWord + '（' + num + '）'
        : axis.label + ' › ' + axis.crsWord + '（' + num + '）';
      nodeRegistry[id] = { element: child, type: 'crs', axisLabel: axis.label, path, num, axis, parentLoopDim };
      const note = suppressed ? '非表示' : '';
      html += treeNodeHTML(id, '▪', 'badge-crs', axis.crsWord + '（' + num + '）', lbl, false);
      count++;
    }
  }
  return { html, count };
}

function assignNodeId(el) {
  const id = 'node_' + (++nodeCounter);
  el._fpNodeId = id;
  return id;
}

function getDimLabel(loopEl) {
  const dl = loopEl.querySelector(':scope > member-list-spec > dimension-label');
  return dl ? dl.textContent : '?';
}

function treeNodeHTML(id, icon, badgeClass, main, sub, dimmed) {
  const typeLabel = icon === '🔄' ? 'LOOP' : icon === '▪' ? 'CRS' : 'FORM';
  return `<div class="tree-node${dimmed ? ' dimmed' : ''}" id="${id}" onclick="selectNode('${id}')">
    <span class="tn-main">
      <span class="tn-icon">${icon}</span>
      <span class="node-badge ${badgeClass}">${typeLabel}</span>
      <span class="tn-dim">${esc(main)}</span>
      ${sub ? `<span class="tn-lbl">${esc(sub)}</span>` : ''}
    </span>
  </div>`;
}

function loopNodeHTML(id, dim, suppressEmpty, itemProhibited, axisLabel) {
  const isRow = axisLabel === '行軸';
  const seActive = suppressEmpty ? ' active' : '';
  const ipEffective = suppressEmpty && itemProhibited;
  const ipActive = ipEffective ? ' active' : '';
  const ipDisabled = suppressEmpty ? '' : ' disabled-dep';
  return `<div class="tree-node" id="${id}" onclick="selectNode('${id}')">
    <span class="tn-main">
      <span class="tn-icon">🔄</span>
      <span class="node-badge badge-loop">LOOP</span>
      <span class="tn-dim">${esc(dim)}</span>
    </span>
    <span class="tn-pills">
      <button class="tn-pill pill-suppress${seActive}" onclick="pillToggle(event,'${id}','suppressEmpty')" title="データ無し非表示">データ無し非表示</button>
      ${isRow ? `<button class="tn-pill pill-item${ipActive}${ipDisabled}" onclick="pillToggle(event,'${id}','itemAddProhibited')" title="選択行非表示">選択行非表示</button>` : ''}
    </span>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// Node Selection & Edit Panel
// ═══════════════════════════════════════════════════════════════════
function selectNode(id) {
  if (selectedNodeId) {
    const prev = document.getElementById(selectedNodeId);
    if (prev) prev.classList.remove('selected');
  }
  selectedNodeId = id;
  const el = document.getElementById(id);
  if (el) el.classList.add('selected');

  const info = nodeRegistry[id];
  if (!info) return;
  renderEditPanel(id, info);
}

function renderEditPanel(id, info) {
  document.getElementById('editEmpty').style.display = 'none';
  const panel = document.getElementById('editPanel');
  panel.style.display = 'block';
  const c = changes[id] || {};

  if (info.type === 'form')       renderFormPanel(panel, info, c);
  else if (info.type === 'loop')  renderLoopPanel(panel, id, info, c);
  else if (info.type === 'crs')   renderCrsPanel(panel, id, info, c);
}

// ── Form Panel ──
function renderFormPanel(panel, info, c) {
  const el = info.element;
  const rf = el.querySelector(':scope > report-format');
  const rwll = c.rwll !== undefined ? c.rwll : (rf?.querySelector('row-wise-loop-layout')?.textContent || '');
  const prot = c.protected !== undefined ? c.protected : (rf?.querySelector('protected')?.textContent || 'false');
  const riVal = c.rti !== undefined ? c.rti : (rf?.querySelector('row-title-indent')?.textContent || '');
  const lm = el.querySelector(':scope > local-mask')?.textContent?.trim() || '';
  const docLabel = el.getAttribute('label') || '';

  panel.innerHTML = `
  <div class="edit-section">
    <div class="edit-section-header">📋 <span class="node-badge badge-form">FORM</span> ${esc(docLabel)}</div>
    <div class="edit-section-body">
      <div class="field">
        <label>行表示設定 (row-wise-loop-layout)</label>
        <select onchange="storeFormChange('rwll', this.value)">
          <option value="" ${!rwll?'selected':''}>（未設定 / デフォルト = LOOP_HEADERS）</option>
          <option value="LOOP_HEADERS" ${rwll==='LOOP_HEADERS'?'selected':''}>LOOP_HEADERS</option>
          <option value="FIRST_DETAILS" ${rwll==='FIRST_DETAILS'?'selected':''}>FIRST_DETAILS</option>
          <option value="ALL_DETAILS" ${rwll==='ALL_DETAILS'?'selected':''}>ALL_DETAILS</option>
        </select>
      </div>
      <div class="divider"></div>
      <div class="toggle-wrap">
        <div>
          <div class="toggle-label">セルを保護</div>
          <div class="toggle-sub">protected</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${prot==='true'?'checked':''} onchange="storeFormChange('protected', this.checked?'true':'false')">
          <span class="slider"></span>
        </label>
      </div>
      <div class="field">
        <label>行タイトルインデント幅 (row-title-indent)</label>
        <div class="field-row">
          <input type="number" value="${esc(riVal)}" min="0" max="99" oninput="storeFormChange('rti', this.value)" placeholder="例: 2">
          <span style="font:400 10px var(--mono); color:var(--text3)">px</span>
        </div>
      </div>
      ${lm ? `<div class="field"><label style="color:var(--warn)">⚠ 元帳マスクが設定されています</label><div style="font:400 10px var(--mono);color:var(--text3);margin-top:2px">${esc(lm.substring(0,80))}</div></div>` : ''}
    </div>
  </div>`;
}

// ── Loop Panel ──
function renderLoopPanel(panel, id, info, c) {
  const el = info.element;
  const dim = getDimLabel(el);
  const suppressEmpty  = c.suppressEmpty     !== undefined ? c.suppressEmpty     : (el.getAttribute('suppress-if-no-data')     === 'true');
  const itemProhibited = c.itemAddProhibited !== undefined ? c.itemAddProhibited : (el.getAttribute('item-addition-prohibited') === 'true');
  const rti = c.rti !== undefined ? c.rti : (el.getAttribute('row-title-indent') || '');

  const titleEl = el.querySelector(':scope > title');
  const titleText = titleEl ? titleEl.textContent.trim() : '';
  const pegEl = el.querySelector(':scope > member-list-spec > member-list-expression > peg-member');
  const expEl = el.querySelector(':scope > member-list-spec > member-list-expression > expansion-method');
  const pegType  = pegEl ? pegEl.getAttribute('type')   : '—';
  const expMethod = expEl ? expEl.getAttribute('method') : '—';

  panel.innerHTML = `
  <div class="edit-section">
    <div class="edit-section-header">🔄 <span class="node-badge badge-loop">LOOP</span> ${esc(dim)}</div>
    <div class="edit-section-body">
      <div style="font:400 10px var(--mono); color:var(--text3)">${esc(info.path)}</div>
      <div style="font:400 10px var(--mono); color:var(--text3)">
        peg: <span style="color:var(--ok)">${esc(pegType)}</span> &nbsp;·&nbsp; method: <span style="color:var(--ok)">${esc(expMethod)}</span>
      </div>
    </div>
  </div>
  <div class="edit-section">
    <div class="edit-section-header">⚙ 表示設定</div>
    <div class="edit-section-body">
      <div class="toggle-wrap">
        <div>
          <div class="toggle-label">データ無し非表示</div>
          <div class="toggle-sub">suppress-if-no-data</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="l_suppressEmpty" ${suppressEmpty?'checked':''} onchange="onSuppressEmptyChange('${id}', this.checked)">
          <span class="slider"></span>
        </label>
      </div>
      ${info.axisLabel === '行軸' ? `
      <div class="toggle-wrap" style="${suppressEmpty ? '' : 'opacity:0.4'}">
        <div>
          <div class="toggle-label">選択行非表示</div>
          <div class="toggle-sub">item-addition-prohibited</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="l_itemProhibited" ${(suppressEmpty && itemProhibited)?'checked':''} ${suppressEmpty?'':'disabled'} onchange="storeChange('${id}', 'itemAddProhibited', this.checked)">
          <span class="slider"></span>
        </label>
      </div>` : ''}
      <div class="field">
        <label>行タイトルインデント幅 (row-title-indent)</label>
        <div class="field-row">
          <input type="number" id="l_rti" value="${esc(rti)}" min="0" max="99" oninput="storeChange('${id}', 'rti', this.value)" placeholder="属性なし">
          <span style="font:400 10px var(--mono); color:var(--text3)">px</span>
        </div>
      </div>
    </div>
  </div>
  ${titleText ? `
  <div class="edit-section">
    <div class="edit-section-header">📝 ループタイトル</div>
    <div class="edit-section-body">
      <div style="font:400 10px var(--mono); color:var(--text3); word-break:break-all">${esc(titleText.substring(0,200))}</div>
    </div>
  </div>` : ''}`;
}

// ── CRS Panel ──
function renderCrsPanel(panel, id, info, c) {
  const el = info.element;
  const lbl = el.getAttribute('label') || '';
  const suppressed = c.suppressed !== undefined ? c.suppressed : (el.getAttribute('suppressed') === 'true');

  const titleEl = el.querySelector(':scope > title');
  const titleText = titleEl ? titleEl.textContent.trim() : '';
  const titleEn = c.titleEn !== undefined ? c.titleEn : extractLangValue(titleText, 'en');
  const titleJa = c.titleJa !== undefined ? c.titleJa : extractLangValue(titleText, 'ja');

  const nameEl = el.querySelector(':scope > name');
  const nameText = nameEl ? nameEl.textContent.trim() : '';
  const nameEn = (nameText.match(/en;"(.*?)"/) || [])[1] || '';
  const nameJa = (nameText.match(/ja;"(.*?)"/) || [])[1] || '';

  const formula = el.querySelector(':scope > value-spec > formula')?.textContent?.trim() || '';
  const axisWord = info.axisLabel === '列軸' ? '列仕様' : '行仕様';

  panel.innerHTML = `
  <div class="edit-section">
    <div class="edit-section-header">▪ <span class="node-badge badge-crs">CRS</span> ${esc(axisWord)}（${info.num}）${lbl ? ' ' + esc(lbl) : ''}</div>
    <div class="edit-section-body">
      <div style="font:400 10px var(--mono); color:var(--text3)">${esc(info.path)}</div>
    </div>
  </div>
  <div class="edit-section">
    <div class="edit-section-header">⚙ 表示設定</div>
    <div class="edit-section-body">
      <div class="toggle-wrap">
        <div>
          <div class="toggle-label">この行・列を非表示</div>
          <div class="toggle-sub">suppressed 属性</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${suppressed?'checked':''} onchange="storeChange('${id}', 'suppressed', this.checked)">
          <span class="slider"></span>
        </label>
      </div>
    </div>
  </div>
  <div class="edit-section">
    <div class="edit-section-header">📝 タイトル (title)</div>
    <div class="edit-section-body">
      <div class="field">
        <label>JA</label>
        <input type="text" id="c_titleJa" value="${esc(titleJa)}" oninput="storeChange('${id}', 'titleJa', this.value)" placeholder="日本語タイトル">
      </div>
      <div class="field">
        <label>EN</label>
        <input type="text" id="c_titleEn" value="${esc(titleEn)}" oninput="storeChange('${id}', 'titleEn', this.value)" placeholder="英語タイトル">
      </div>
      <div style="margin-top:4px">
        ${info.parentLoopDim
          ? `<button class="btn btn-fix" style="font-size:10px;padding:5px 12px" onclick="applyDescTitle('${id}', '${esc(info.parentLoopDim)}')">✦ ${esc(info.parentLoopDim)}!@CUR.desc を設定</button>`
          : `<button class="btn btn-secondary" style="font-size:10px;padding:5px 12px;opacity:0.4;cursor:not-allowed" disabled>✦ .desc 自動設定（親ループなし）</button>`
        }
      </div>
    </div>
  </div>
  ${nameEn || nameJa ? `
  <div class="edit-section">
    <div class="edit-section-header">🏷 名称 (name) — 参照のみ</div>
    <div class="edit-section-body">
      ${nameEn ? `<div style="font:400 10px var(--mono);color:var(--text2)">EN: ${esc(nameEn)}</div>` : ''}
      ${nameJa ? `<div style="font:400 10px var(--mono);color:var(--text2)">JA: ${esc(nameJa)}</div>` : ''}
    </div>
  </div>` : ''}
  ${formula ? `
  <div class="edit-section">
    <div class="edit-section-header">Σ 数式 (formula) — 参照のみ</div>
    <div class="edit-section-body">
      <div style="font:400 10px var(--mono);color:var(--text3);word-break:break-all">${esc(formula.substring(0,200))}</div>
    </div>
  </div>` : ''}`;
}

// ═══════════════════════════════════════════════════════════════════
// Change Management
// ═══════════════════════════════════════════════════════════════════
function storeChange(nodeId, field, value) {
  if (!changes[nodeId]) changes[nodeId] = {};
  changes[nodeId][field] = value;
  const el = document.getElementById(nodeId);
  if (el) el.classList.add('modified');
  updateChangeCount();
}

function storeFormChange(field, value) {
  storeChange('node_form', field, value);
}

function markGlobalChange() {
  storeChange('node_form', 'globalSettings', 'changed');
}

function updateChangeCount() {
  const total = Object.keys(changes).length;
  const cc = document.getElementById('changeCount');
  cc.textContent = total + '件の変更';
  cc.classList.toggle('visible', total > 0);
}

function onSuppressEmptyChange(id, val) {
  storeChange(id, 'suppressEmpty', val);
  if (!val) {
    storeChange(id, 'itemAddProhibited', false);
    const ipCb = document.getElementById('l_itemProhibited');
    if (ipCb) { ipCb.checked = false; ipCb.disabled = true; }
    const ipWrap = ipCb?.closest('.toggle-wrap');
    if (ipWrap) ipWrap.style.opacity = '0.4';
  } else {
    const ipCb = document.getElementById('l_itemProhibited');
    if (ipCb) ipCb.disabled = false;
    const ipWrap = ipCb?.closest('.toggle-wrap');
    if (ipWrap) ipWrap.style.opacity = '';
  }
  refreshTreeNodeSummary(id, nodeRegistry[id]);
}

function applyDescTitle(id, dim) {
  const expr = `${dim}!@CUR.desc`;
  const inputEl = document.getElementById('c_titleEn');
  const currentEn = inputEl ? inputEl.value : (changes[id]?.titleEn ?? '');
  const isPlaceholderEn = !currentEn || currentEn.includes('Column/Row Title');
  const jaInputEl = document.getElementById('c_titleJa');
  const currentJa = jaInputEl ? jaInputEl.value : (changes[id]?.titleJa ?? '');
  const isPlaceholderJa = !currentJa || currentJa.includes('列/行タイトル');

  if (!isPlaceholderEn) {
    const ok = confirm(`現在のタイトルEN:\n"${currentEn}"\n\nこの値を\n"${expr}"\nに上書きしますか？`);
    if (!ok) return;
  }

  storeChange(id, 'titleEn', expr);
  if (inputEl) inputEl.value = expr;
  if (isPlaceholderJa) {
    storeChange(id, 'titleJa', '');
    if (jaInputEl) jaInputEl.value = '';
  }
  showToast(`タイトルENに ${expr} を設定しました`);
}

function pillToggle(event, id, field) {
  event.stopPropagation();
  const info = nodeRegistry[id];
  if (!info) return;
  const el = info.element;
  const c = changes[id] || {};
  const cur = c[field] !== undefined ? c[field]
    : (field === 'suppressEmpty'
        ? el.getAttribute('suppress-if-no-data') === 'true'
        : el.getAttribute('item-addition-prohibited') === 'true');
  const newVal = !cur;
  storeChange(id, field, newVal);
  if (field === 'suppressEmpty' && !newVal) {
    storeChange(id, 'itemAddProhibited', false);
  }
  refreshTreeNodeSummary(id, info);
  if (selectedNodeId === id) renderEditPanel(id, info);
}

function refreshTreeNodeSummary(id, info) {
  if (info.type !== 'loop') return;
  const el = info.element;
  const c = changes[id] || {};
  const suppressEmpty  = c.suppressEmpty     !== undefined ? c.suppressEmpty     : (el.getAttribute('suppress-if-no-data')     === 'true');
  const itemProhibited = c.itemAddProhibited !== undefined ? c.itemAddProhibited : (el.getAttribute('item-addition-prohibited') === 'true');
  const nodeEl = document.getElementById(id);
  if (!nodeEl) return;
  const pillSuppress = nodeEl.querySelector('.pill-suppress');
  const pillItem     = nodeEl.querySelector('.pill-item');
  if (pillSuppress) pillSuppress.classList.toggle('active', suppressEmpty);
  if (pillItem) {
    pillItem.classList.toggle('active', suppressEmpty && itemProhibited);
    pillItem.classList.toggle('disabled-dep', !suppressEmpty);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Batch Operations
// ═══════════════════════════════════════════════════════════════════
const batchCycleState = { suppressEmpty: 'on', itemAddProhibited: 'on' };

const BATCH_BTN_CONFIG = {
  suppressEmpty:     { id: 'batchSuppressBtn', label: 'データ無し非表示' },
  itemAddProhibited: { id: 'batchItemBtn',      label: '選択行非表示' },
};
const CYCLE_STEPS  = ['on', 'off', 'reset'];
const CYCLE_LABELS = { on: '全ON', off: '全OFF', reset: '元値' };
const CYCLE_COLORS = {
  on:    'background:var(--ok-dim);color:var(--ok);border:1px solid rgba(78,202,139,0.3)',
  off:   'background:var(--error-dim);color:var(--error);border:1px solid rgba(239,100,97,0.3)',
  reset: 'background:var(--surface2);color:var(--text2);border:1px solid var(--border)',
};

function initBatchButtons() {
  for (const field of Object.keys(BATCH_BTN_CONFIG)) {
    batchCycleState[field] = 'on';
    updateBatchBtn(field);
  }
}

function updateBatchBtn(field) {
  const cfg = BATCH_BTN_CONFIG[field];
  const state = batchCycleState[field];
  const btn = document.getElementById(cfg.id);
  if (!btn) return;
  btn.textContent = `${cfg.label} ${CYCLE_LABELS[state]}`;
  btn.style.cssText = `font-size:10px;padding:5px 10px;${CYCLE_COLORS[state]}`;
}

function batchCycle(field) {
  const next = CYCLE_STEPS[(CYCLE_STEPS.indexOf(batchCycleState[field]) + 1) % CYCLE_STEPS.length];
  batchCycleState[field] = next;
  updateBatchBtn(field);

  for (const [id, info] of Object.entries(nodeRegistry)) {
    if (info.type !== 'loop') continue;
    if (field === 'itemAddProhibited' && info.axisLabel !== '行軸') continue;

    if (next === 'reset') {
      if (changes[id]) {
        delete changes[id][field];
        if (field === 'suppressEmpty') delete changes[id]['itemAddProhibited'];
        if (Object.keys(changes[id]).length === 0) {
          delete changes[id];
          document.getElementById(id)?.classList.remove('modified');
        }
      }
    } else {
      const val = next === 'on';
      storeChange(id, field, val);
      if (field === 'suppressEmpty' && !val) storeChange(id, 'itemAddProhibited', false);
    }
    refreshTreeNodeSummary(id, info);
  }

  if (selectedNodeId && nodeRegistry[selectedNodeId]?.type === 'loop') {
    renderEditPanel(selectedNodeId, nodeRegistry[selectedNodeId]);
  }

  updateChangeCount();
  const count = Object.values(nodeRegistry).filter(i => i.type === 'loop').length;
  showToast(`${count}件のループを ${CYCLE_LABELS[next]} に設定しました`);
}

// ═══════════════════════════════════════════════════════════════════
// Apply & Export XML
// ═══════════════════════════════════════════════════════════════════
function applyAndCopy() {
  if (!parsedDoc) return;
  let xml = document.getElementById('xmlInput').value;

  for (const [nodeId, fieldChanges] of Object.entries(changes)) {
    const info = nodeRegistry[nodeId];
    if (!info) continue;
    const el = info.element;
    if (info.type === 'loop')      xml = applyLoopChanges(xml, el, fieldChanges);
    else if (info.type === 'crs')  xml = applyCrsChanges(xml, el, fieldChanges);
    else if (info.type === 'form') xml = applyFormChanges(xml, el, fieldChanges);
  }

  xml = applyGlobalChanges(xml);

  navigator.clipboard.writeText(xml).then(() => {
    showToast('XMLをクリップボードにコピーしました！');
  }).catch(() => {
    const tmp = document.createElement('textarea');
    tmp.value = xml; document.body.appendChild(tmp);
    tmp.select(); document.execCommand('copy'); document.body.removeChild(tmp);
    showToast('XMLをコピーしました');
  });
}

function applyLoopChanges(xml, el, fieldChanges) {
  const attrChanges = {};
  if (fieldChanges.suppressEmpty    !== undefined) attrChanges['suppress-if-no-data']     = String(fieldChanges.suppressEmpty);
  if (fieldChanges.itemAddProhibited !== undefined) attrChanges['item-addition-prohibited'] = String(fieldChanges.itemAddProhibited);
  if (fieldChanges.rti !== undefined && fieldChanges.rti !== '') attrChanges['row-title-indent'] = String(fieldChanges.rti);
  if (Object.keys(attrChanges).length === 0) return xml;

  const ser = new XMLSerializer();
  const elXml = ser.serializeToString(el);
  const openTagMatch = elXml.match(/^<loop-spec[^>]*>/);
  if (!openTagMatch) return xml;

  let oldOpenTag = openTagMatch[0];
  let newOpenTag = oldOpenTag;
  for (const [attr, val] of Object.entries(attrChanges)) {
    if (newOpenTag.includes(`${attr}="`)) {
      newOpenTag = newOpenTag.replace(new RegExp(`${attr}="[^"]*"`), `${attr}="${val}"`);
    } else {
      newOpenTag = newOpenTag.replace(/>$/, ` ${attr}="${val}">`);
    }
  }
  if (oldOpenTag !== newOpenTag) xml = replaceFirst(xml, oldOpenTag, newOpenTag);
  return xml;
}

function applyCrsChanges(xml, el, fieldChanges) {
  const ser = new XMLSerializer();
  const elXml = ser.serializeToString(el);
  const openTagMatch = elXml.match(/^<column-row-spec[^>]*>/);
  if (!openTagMatch) return xml;

  let oldOpenTag = openTagMatch[0];
  let newOpenTag = oldOpenTag;
  if (fieldChanges.suppressed !== undefined) {
    const val = String(fieldChanges.suppressed);
    newOpenTag = newOpenTag.includes('suppressed=')
      ? newOpenTag.replace(/suppressed="[^"]*"/, `suppressed="${val}"`)
      : newOpenTag.replace(/>$/, ` suppressed="${val}">`);
  }
  if (oldOpenTag !== newOpenTag) xml = replaceFirst(xml, oldOpenTag, newOpenTag);

  if (fieldChanges.titleEn !== undefined || fieldChanges.titleJa !== undefined) {
    xml = updateTitleInXml(xml, el, fieldChanges);
  }
  return xml;
}

function applyFormChanges(xml, el, fieldChanges) {
  if (fieldChanges.rwll !== undefined && fieldChanges.rwll !== '') {
    const val = fieldChanges.rwll;
    xml = xml.includes('<row-wise-loop-layout>')
      ? xml.replace(/<row-wise-loop-layout>[^<]*<\/row-wise-loop-layout>/, `<row-wise-loop-layout>${val}</row-wise-loop-layout>`)
      : xml.replace(/<\/report-format>/, `  <row-wise-loop-layout>${val}</row-wise-loop-layout>\n</report-format>`);
  }
  if (fieldChanges.protected !== undefined && fieldChanges.protected !== '') {
    const val = fieldChanges.protected;
    xml = xml.includes('<protected>')
      ? xml.replace(/<protected>[^<]*<\/protected>/, `<protected>${val}</protected>`)
      : xml.replace(/<\/report-format>/, `  <protected>${val}</protected>\n</report-format>`);
  }
  if (fieldChanges.rti !== undefined && fieldChanges.rti !== '') {
    const val = fieldChanges.rti;
    xml = xml.includes('<row-title-indent>')
      ? xml.replace(/<row-title-indent>[^<]*<\/row-title-indent>/, `<row-title-indent>${val}</row-title-indent>`)
      : xml.replace(/<\/report-format>/, `  <row-title-indent>${val}</row-title-indent>\n</report-format>`);
  }
  return xml;
}

function applyGlobalChanges(xml) {
  const rwll  = document.getElementById('g_rowWiseLayout').value;
  const gprot = document.getElementById('g_protected').value;
  if (rwll) {
    xml = xml.includes('<row-wise-loop-layout>')
      ? xml.replace(/<row-wise-loop-layout>[^<]*<\/row-wise-loop-layout>/g, `<row-wise-loop-layout>${rwll}</row-wise-loop-layout>`)
      : xml.replace(/<\/report-format>/, `  <row-wise-loop-layout>${rwll}</row-wise-loop-layout>\n</report-format>`);
  }
  if (gprot) {
    xml = xml.includes('<protected>')
      ? xml.replace(/<protected>[^<]*<\/protected>/g, `<protected>${gprot}</protected>`)
      : xml.replace(/<\/report-format>/, `  <protected>${gprot}</protected>\n</report-format>`);
  }
  return xml;
}

function updateTitleInXml(xml, el, fieldChanges) {
  const ser = new XMLSerializer();
  const elXml = ser.serializeToString(el);
  const titleMatch = elXml.match(/<title[^>]*>([\s\S]*?)<\/title>/);
  if (!titleMatch) return xml;

  const oldTitleBlock = titleMatch[0];
  const oldContent    = titleMatch[1];

  let newEn = fieldChanges.titleEn !== undefined ? fieldChanges.titleEn : extractLangValue(oldContent, 'en');
  let newJa = fieldChanges.titleJa !== undefined ? fieldChanges.titleJa : extractLangValue(oldContent, 'ja');

  let newContent = oldContent;
  const enRaw = extractLangRaw(oldContent, 'en');
  const jaRaw = extractLangRaw(oldContent, 'ja');
  if (enRaw) newContent = newContent.replace(enRaw, `en;"${newEn}"`);
  else if (newEn) newContent = `en;"${newEn}"\n` + newContent;
  if (jaRaw) newContent = newContent.replace(jaRaw, `ja;"${newJa}"`);
  else if (newJa) newContent += `\nja;"${newJa}"`;

  const newTitleBlock = `<title>${newContent}</title>`;
  if (oldTitleBlock === newTitleBlock) return xml;

  const crsOpenMatch = elXml.match(/^<column-row-spec[^>]*>/);
  if (!crsOpenMatch) return xml;

  const anchorPos = xml.indexOf(crsOpenMatch[0]);
  if (anchorPos < 0) return xml;
  const titlePos = xml.indexOf(oldTitleBlock, anchorPos);
  if (titlePos < 0) return xml;

  return xml.substring(0, titlePos) + newTitleBlock + xml.substring(titlePos + oldTitleBlock.length);
}

function replaceFirst(str, search, replacement) {
  const idx = str.indexOf(search);
  if (idx < 0) return str;
  return str.substring(0, idx) + replacement + str.substring(idx + search.length);
}

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════
function showEditEmpty() {
  document.getElementById('editEmpty').style.display = 'flex';
  document.getElementById('editPanel').style.display = 'none';
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type === 'error' ? 'var(--error)' : 'var(--ok)';
  t.style.color = type === 'error' ? '#fff' : '#0c0e14';
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2500);
}

function extractLangValue(text, lang) {
  const raw = extractLangRaw(text, lang);
  if (!raw) return '';
  return raw.slice(lang.length + 2, -1);
}

function extractLangRaw(text, lang) {
  const prefix = lang + ';"';
  let i = 0;
  while (i < text.length) {
    const pos = text.indexOf(prefix, i);
    if (pos < 0) return null;
    const before = pos > 0 ? text[pos - 1] : '\n';
    if (pos > 0 && !/[\s\n;,]/.test(before)) { i = pos + 1; continue; }
    let j = pos + prefix.length;
    while (j < text.length) {
      if (text[j] === '"') {
        if (j + 1 < text.length && text[j + 1] === '"') { j += 2; continue; }
        break;
      }
      j++;
    }
    return text.slice(pos, j + 1);
  }
  return null;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function clearAll() {
  document.getElementById('xmlInput').value = '';
  document.getElementById('treeScroll').innerHTML = `<div class="edit-empty" style="margin-top:60px">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
    </svg>
    XMLを入力して解析を実行</div>`;
  document.getElementById('globalStrip').style.display  = 'none';
  document.getElementById('batchRow').style.display     = 'none';
  document.getElementById('applyBtn').style.display     = 'none';
  document.getElementById('treeCount').textContent      = '—';
  document.getElementById('changeCount').classList.remove('visible');
  showEditEmpty();
  parsedDoc = null; nodeRegistry = {}; changes = {};
  selectedNodeId = null; nodeCounter = 0;
  crsGlobalCounter = { col: 0, row: 0 };
}

// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════
let parsedDoc = null;
let selectedMeta = null;
let crsCounters = {};
let resultXmlText = '';

// ═══════════════════════════════════════════════════════════════════
// Parse & Render Tree
// ═══════════════════════════════════════════════════════════════════
function parseAndShowTree() {
  const raw = document.getElementById('xmlInput').value.trim();
  if (!raw) {
    document.getElementById('treeArea').innerHTML = '<div class="tree-empty">XMLが入力されていません</div>';
    return;
  }

  const parser = new DOMParser();
  parsedDoc = parser.parseFromString(raw, 'application/xml');
  if (parsedDoc.querySelector('parsererror')) {
    document.getElementById('treeArea').innerHTML =
      '<div class="tree-empty" style="color:var(--error)">XMLの構文が正しくありません</div>';
    return;
  }

  resultXmlText = raw;
  document.getElementById('treeStatus').textContent = '';
  document.getElementById('copyBtn').style.display = 'none';
  renderTree(parsedDoc);
}

function renderTree(doc, highlightIds = new Set()) {
  const treeArea = document.getElementById('treeArea');
  const root = doc.documentElement;

  crsCounters = {};
  selectedMeta = null;
  document.getElementById('cloneControls').classList.remove('visible');

  const axes = [
    { tag: 'column-axis-spec', label: '列軸', crsLabel: '列仕様' },
    { tag: 'row-axis-spec',    label: '行軸', crsLabel: '行仕様' }
  ];

  let html = '';
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    html += `<div class="axis-header"><span class="icon">📐</span>${axis.label}</div>`;
    html += '<div class="tree-children">';
    html += buildTreeHTML(axisEl, axis, highlightIds);
    html += '</div>';
  }

  treeArea.innerHTML = html || '<div class="tree-empty">列軸・行軸が見つかりません</div>';
}

function buildTreeHTML(parent, axis, highlightIds) {
  let html = '';
  for (const child of parent.children) {
    if (child.tagName === 'axis-spec') {
      html += buildTreeHTML(child, axis, highlightIds);

    } else if (child.tagName === 'loop-spec') {
      const dim = getDimLabel(child);
      const id = child.getAttribute('id') || '';
      const isNew = id && highlightIds.has(id);

      html += `<div class="tree-node${isNew ? ' new-node' : ''}" onclick="selectNode(this,'${axis.label}','${id}','loop')">`;
      html += `<span class="icon">🔄</span><span class="tag">ループ</span>`;
      html += `<span class="dim">（${esc(dim)}）</span>`;
      if (isNew) html += `<span class="new-badge">NEW</span>`;
      html += `</div>`;
      html += '<div class="tree-children">';
      html += buildTreeHTML(child, axis, highlightIds);
      html += '</div>';

    } else if (child.tagName === 'column-row-spec') {
      crsCounters[axis.tag] = (crsCounters[axis.tag] || 0) + 1;
      const num = crsCounters[axis.tag];
      const label = child.getAttribute('label') || '';
      const name = getNameText(child);
      const id = child.getAttribute('id') || '';
      const isNew = id && highlightIds.has(id);

      const info = label && name ? `${label} / ${name}` : (label || name);

      html += `<div class="tree-node${isNew ? ' new-node' : ''}" onclick="selectNode(this,'${axis.label}','${id}','crs')">`;
      html += `<span class="icon">▪</span>`;
      html += `<span class="tag">${axis.crsLabel}（${num}）</span>`;
      if (info) html += `<span class="lbl">${esc(info)}</span>`;
      if (isNew) html += `<span class="new-badge">NEW</span>`;
      html += `</div>`;
    }
  }
  return html;
}

function getDimLabel(loopEl) {
  const dl = loopEl.querySelector(':scope > member-list-spec > dimension-label');
  return dl ? dl.textContent : '不明';
}

function getNameText(el) {
  const nameEl = el.querySelector(':scope > name');
  if (!nameEl) return '';
  // Format: en;"value";ja;"値" — extract first quoted value
  const m = nameEl.textContent.match(/"([^"]*)"/);
  return m ? m[1] : nameEl.textContent;
}

// ═══════════════════════════════════════════════════════════════════
// Node Selection — looks up element directly by axis + id
// ═══════════════════════════════════════════════════════════════════
function selectNode(el, axisLabel, elementId, nodeType) {
  document.querySelectorAll('.tree-node.selected').forEach(n => n.classList.remove('selected'));
  el.classList.add('selected');

  if (!parsedDoc || !elementId) return;

  const axisTag = axisLabel === '列軸' ? 'column-axis-spec' : 'row-axis-spec';
  const axisEl = parsedDoc.documentElement.querySelector(axisTag);
  if (!axisEl) return;

  const target = axisEl.querySelector(`[id="${elementId}"]`);
  if (!target) return;

  selectedMeta = { element: target, axisLabel };
  document.getElementById('cloneControls').classList.add('visible');

  let name = '';
  if (nodeType === 'loop') {
    name = `ループ（${getDimLabel(target)}）＋配下全体`;
  } else {
    const label = target.getAttribute('label') || '';
    name = `${axisLabel === '列軸' ? '列' : '行'}仕様${label ? ' ' + label : ''}`;
  }
  document.getElementById('selectedName').textContent = name;
}

// ═══════════════════════════════════════════════════════════════════
// Clone Execution — DOM-based insertion (no string manipulation)
// ═══════════════════════════════════════════════════════════════════
function executeClone() {
  if (!selectedMeta || !parsedDoc) return;

  const count = parseInt(document.getElementById('cloneCount').value, 10) || 1;
  const root = parsedDoc.documentElement;

  // Collect all existing numeric ids
  const existingIds = new Set();
  for (const el of root.querySelectorAll('[id]')) {
    const n = parseInt(el.getAttribute('id'), 10);
    if (!isNaN(n)) existingIds.add(n);
  }

  const target = selectedMeta.element;
  const isRowAxis = selectedMeta.axisLabel === '行軸';

  // Collect all id-bearing elements within the target block
  const targetIdEls = [];
  collectIds(target, targetIdEls);
  const targetIdSet = new Set(targetIdEls.map(e => e.getAttribute('id')));

  // Find cell-specs referencing the target's ids (snapshot before modification)
  const origCellSpecs = [...root.querySelectorAll(':scope > cell-spec')].filter(cs => {
    const refId = isRowAxis ? cs.getAttribute('row-id') : cs.getAttribute('column-id');
    return targetIdSet.has(refId);
  });

  // Track where to insert the next cloned block (insert after)
  let blockInsertRef = target;

  // Track where to insert the next cloned cell-spec group (after last cell-spec)
  const allCellSpecs = [...root.querySelectorAll(':scope > cell-spec')];
  let cellInsertRef = allCellSpecs.length > 0 ? allCellSpecs[allCellSpecs.length - 1] : null;

  const allNewIds = new Set();

  for (let c = 0; c < count; c++) {
    // Build id mapping: oldId → newId
    const idMapping = {};
    for (const el of targetIdEls) {
      const oldId = el.getAttribute('id');
      if (oldId && !idMapping[oldId]) {
        const newId = generateNewId(existingIds);
        idMapping[oldId] = String(newId);
        existingIds.add(newId);
        allNewIds.add(String(newId));
      }
    }

    // Deep-clone the target block and remap all id attributes
    const clonedBlock = target.cloneNode(true);
    remapIds(clonedBlock, idMapping);

    // ラベルにインクリメント番号を付与（_1, _2, ...）
    const suffix = `_${c + 1}`;
    for (const el of [clonedBlock, ...clonedBlock.querySelectorAll('[label]')]) {
      const lbl = el.getAttribute('label');
      if (lbl) el.setAttribute('label', lbl + suffix);
    }

    // Insert cloned block immediately after the previous inserted block
    blockInsertRef.parentNode.insertBefore(clonedBlock, blockInsertRef.nextSibling);
    blockInsertRef = clonedBlock;

    // Clone cell-specs and insert after the last cell-spec (or at end of root)
    for (const cs of origCellSpecs) {
      const clonedCs = cs.cloneNode(true);
      // Remap only the relevant axis id attribute
      if (isRowAxis) {
        const rowId = clonedCs.getAttribute('row-id');
        if (rowId && idMapping[rowId]) clonedCs.setAttribute('row-id', idMapping[rowId]);
      } else {
        const colId = clonedCs.getAttribute('column-id');
        if (colId && idMapping[colId]) clonedCs.setAttribute('column-id', idMapping[colId]);
      }
      if (cellInsertRef) {
        cellInsertRef.parentNode.insertBefore(clonedCs, cellInsertRef.nextSibling);
      } else {
        root.appendChild(clonedCs);
      }
      cellInsertRef = clonedCs;
    }
  }

  // Serialize the modified DOM to get the result XML
  resultXmlText = new XMLSerializer().serializeToString(parsedDoc);

  // Re-render tree from the updated parsedDoc (already modified in-place)
  renderTree(parsedDoc, allNewIds);

  const name = document.getElementById('selectedName').textContent;
  document.getElementById('treeStatus').textContent = `✓ ${name} を ${count}個複製しました`;
  document.getElementById('copyBtn').style.display = 'flex';
}

// ─── DOM helpers ───────────────────────────────────────────────────

function remapIds(el, idMapping) {
  const id = el.getAttribute('id');
  if (id && idMapping[id]) el.setAttribute('id', idMapping[id]);
  for (const child of el.children) remapIds(child, idMapping);
}

function collectIds(el, result) {
  if (el.getAttribute('id') !== null) result.push(el);
  for (const child of el.children) collectIds(child, result);
}

function generateNewId(existingIds) {
  let id = 1;
  for (const eid of existingIds) {
    if (eid >= id) id = eid + 1;
  }
  return id;
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ═══════════════════════════════════════════════════════════════════
// Copy & Clear
// ═══════════════════════════════════════════════════════════════════
async function copyResult() {
  if (!resultXmlText) return;
  const btn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(resultXmlText);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = resultXmlText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const orig = btn.innerHTML;
  btn.innerHTML = '✓ コピーしました';
  setTimeout(() => btn.innerHTML = orig, 2000);
}

function clearAll() {
  document.getElementById('xmlInput').value = '';
  document.getElementById('treeArea').innerHTML =
    '<div class="tree-empty">XMLを入力して構造解析を実行してください</div>';
  document.getElementById('cloneControls').classList.remove('visible');
  document.getElementById('treeStatus').textContent = '';
  document.getElementById('copyBtn').style.display = 'none';
  parsedDoc = null;
  selectedMeta = null;
  crsCounters = {};
  resultXmlText = '';
}

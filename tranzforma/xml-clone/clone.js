// ═══════════════════════════════════════════════════════════════════
// Parse & Tree
// ═══════════════════════════════════════════════════════════════════
let parsedDoc = null;
let selectedNode = null;
let selectedMeta = null; // { type, axisLabel, element, path }

function parseAndShowTree() {
  const raw = document.getElementById('xmlInput').value.trim();
  const treeArea = document.getElementById('treeArea');

  if (!raw) {
    treeArea.innerHTML = '<div class="tree-empty">XMLが入力されていません</div>';
    return;
  }

  const parser = new DOMParser();
  parsedDoc = parser.parseFromString(raw, 'application/xml');
  if (parsedDoc.querySelector('parsererror')) {
    treeArea.innerHTML = '<div class="tree-empty" style="color:var(--error)">XMLの構文が正しくありません</div>';
    return;
  }

  const root = parsedDoc.documentElement;
  let html = '';

  const axes = [
    { tag: 'column-axis-spec', label: '列軸', crsLabel: '列仕様' },
    { tag: 'row-axis-spec', label: '行軸', crsLabel: '行仕様' }
  ];

  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    html += `<div class="tree-node" style="font-weight:600;cursor:default"><span class="icon">📐</span>${axis.label}</div>`;
    html += '<div class="tree-children">';
    html += buildTreeHTML(axisEl, axis, 0);
    html += '</div>';
  }

  treeArea.innerHTML = html || '<div class="tree-empty">列軸・行軸が見つかりません</div>';
  document.getElementById('cloneControls').classList.remove('visible');
  selectedNode = null;
  selectedMeta = null;
}

let crsCounters = {};

function buildTreeHTML(parent, axis, depth) {
  let html = '';
  // axis-specを透過
  for (const child of parent.children) {
    if (child.tagName === 'axis-spec') {
      crsCounters[axis.tag] = crsCounters[axis.tag] || 0;
      html += buildTreeHTML(child, axis, depth);
    } else if (child.tagName === 'loop-spec') {
      const dim = getDimLabel(child);
      const nodeId = `node_${Math.random().toString(36).substr(2,8)}`;
      child._nodeId = nodeId;
      html += `<div class="tree-node" data-node-id="${nodeId}" onclick="selectNode(this, '${nodeId}')">`;
      html += `<span class="icon">🔄</span>`;
      html += `<span class="tag">ループ</span>`;
      html += `<span class="dim">（${esc(dim)}）</span>`;
      html += `</div>`;
      html += '<div class="tree-children">';
      html += buildTreeHTML(child, axis, depth + 1);
      html += '</div>';
    } else if (child.tagName === 'column-row-spec') {
      crsCounters[axis.tag] = (crsCounters[axis.tag] || 0) + 1;
      const num = crsCounters[axis.tag];
      const label = child.getAttribute('label') || '';
      const nodeId = `node_${Math.random().toString(36).substr(2,8)}`;
      child._nodeId = nodeId;
      html += `<div class="tree-node" data-node-id="${nodeId}" onclick="selectNode(this, '${nodeId}')">`;
      html += `<span class="icon">▪</span>`;
      html += `<span class="tag">${axis.crsLabel}（${num}）</span>`;
      if (label) html += `<span class="lbl">${esc(label)}</span>`;
      html += `</div>`;
    }
  }
  return html;
}

function getDimLabel(loopEl) {
  const dl = loopEl.querySelector(':scope > member-list-spec > dimension-label');
  return dl ? dl.textContent : '不明';
}

// ノード選択時にDOMElementを逆引きするためのマップ
let nodeMap = {};

function parseAndBuildNodeMap() {
  nodeMap = {};
  const root = parsedDoc.documentElement;
  const axes = [
    { tag: 'column-axis-spec', label: '列軸' },
    { tag: 'row-axis-spec', label: '行軸' }
  ];
  for (const axis of axes) {
    const axisEl = root.querySelector(axis.tag);
    if (!axisEl) continue;
    mapNodes(axisEl, axis.label);
  }
}

function mapNodes(parent, axisLabel) {
  for (const child of parent.children) {
    if (child.tagName === 'axis-spec') {
      mapNodes(child, axisLabel);
    } else if (child.tagName === 'loop-spec' || child.tagName === 'column-row-spec') {
      if (child._nodeId) {
        nodeMap[child._nodeId] = { element: child, axisLabel };
      }
      if (child.tagName === 'loop-spec') {
        mapNodes(child, axisLabel);
      }
    }
  }
}

function selectNode(el, nodeId) {
  // 前の選択を解除
  document.querySelectorAll('.tree-node.selected').forEach(n => n.classList.remove('selected'));
  el.classList.add('selected');

  // ノードマップが未構築なら構築
  if (Object.keys(nodeMap).length === 0) parseAndBuildNodeMap();

  const info = nodeMap[nodeId];
  if (!info) return;

  selectedMeta = info;
  const controls = document.getElementById('cloneControls');
  controls.classList.add('visible');

  let name = '';
  if (info.element.tagName === 'loop-spec') {
    name = `ループ（${getDimLabel(info.element)}）＋配下全体`;
  } else {
    const label = info.element.getAttribute('label') || '';
    name = `${info.axisLabel === '列軸' ? '列' : '行'}仕様${label ? ' ' + label : ''}`;
  }
  document.getElementById('selectedName').textContent = name;
}

// ═══════════════════════════════════════════════════════════════════
// Clone Execution
// ═══════════════════════════════════════════════════════════════════
function executeClone() {
  if (!selectedMeta || !parsedDoc) return;

  const count = parseInt(document.getElementById('cloneCount').value, 10) || 1;
  const raw = document.getElementById('xmlInput').value;
  const root = parsedDoc.documentElement;

  // 現在のXML内の全id値を収集
  const existingIds = new Set();
  for (const el of root.querySelectorAll('[id]')) {
    existingIds.add(parseInt(el.getAttribute('id'), 10));
  }

  // 複製対象のelement
  const target = selectedMeta.element;

  // 対象ブロック内のid一覧
  const targetIds = [];
  collectIds(target, targetIds);

  // cell-specの複製対象を特定（軸に応じて適切なid参照で絞り込む）
  const targetIdSet = new Set(targetIds.map(e => e.getAttribute('id')));
  const isRowAxis = selectedMeta.axisLabel === '行軸';
  const cellSpecs = [];
  for (const cs of root.querySelectorAll(':scope > cell-spec')) {
    const refId = isRowAxis ? cs.getAttribute('row-id') : cs.getAttribute('column-id');
    if (targetIdSet.has(refId)) {
      cellSpecs.push(cs);
    }
  }

  // ログ
  const logLines = [];
  logLines.push(`<div style="color:var(--text);font-weight:600">📋 複製対象: ${document.getElementById('selectedName').textContent}</div>`);
  logLines.push(`<div>複製数: ${count}個</div>`);
  logLines.push(`<div>対象ブロック内のid: ${targetIds.map(e => e.getAttribute('id')).join(', ')}</div>`);
  logLines.push(`<div>関連cell-spec: ${cellSpecs.length}件</div>`);
  logLines.push(`<div style="margin-top:6px;font-weight:600">— id変換 —</div>`);

  // XMLテキストベースで操作
  let result = raw;

  // 対象ブロックのXMLテキストを抽出
  const serializer = new XMLSerializer();
  const targetXml = serializer.serializeToString(target);

  // cell-specのXMLテキストを抽出
  const cellXmls = cellSpecs.map(cs => serializer.serializeToString(cs));

  // 複製ブロックを生成
  let insertBlockXml = '';
  let insertCellXml = '';

  for (let c = 0; c < count; c++) {
    // この複製のid変換マッピング
    const idMapping = {};
    for (const el of targetIds) {
      const oldId = el.getAttribute('id');
      if (!idMapping[oldId]) {
        const newId = generateNewId(existingIds);
        idMapping[oldId] = String(newId);
        existingIds.add(newId);
      }
    }

    // ブロックXMLのid置換
    let clonedXml = targetXml;
    for (const [oldId, newId] of Object.entries(idMapping)) {
      clonedXml = replaceIdInXml(clonedXml, oldId, newId);
    }
    insertBlockXml += '\n' + clonedXml;

    // cell-specのid置換（軸に応じてcolumn-id/row-idの片方だけ変換）
    const isRowAxis = selectedMeta.axisLabel === '行軸';
    for (const cellXml of cellXmls) {
      let clonedCell = cellXml;
      for (const [oldId, newId] of Object.entries(idMapping)) {
        // cell-spec自体のid属性は変換しない（cell-specにはid属性がない）
        // column-id / row-id は軸に応じて片方だけ変換
        if (isRowAxis) {
          // 行軸の複製 → row-id だけ変換、column-id はそのまま
          clonedCell = clonedCell.replace(
            new RegExp(`(row-id=")${escRe(oldId)}(")`, 'g'), `$1${newId}$2`
          );
        } else {
          // 列軸の複製 → column-id だけ変換、row-id はそのまま
          clonedCell = clonedCell.replace(
            new RegExp(`(column-id=")${escRe(oldId)}(")`, 'g'), `$1${newId}$2`
          );
        }
      }
      insertCellXml += '\n' + clonedCell;
    }

    // ログ
    logLines.push(`<div style="margin-top:4px">複製 #${c + 1}:</div>`);
    for (const [oldId, newId] of Object.entries(idMapping)) {
      logLines.push(`<div>  id <span class="old">${oldId}</span> → <span class="new">${newId}</span></div>`);
    }
  }

  // 元ブロックの直後に挿入
  // targetXmlの出現位置を探して、その直後に挿入
  // ただしserializeToStringの出力がraw内の表記と微妙に違う場合があるので
  // 正規表現でタグのid属性を使って位置を特定する
  const targetTag = target.tagName;
  const targetId = target.getAttribute('id');

  if (targetId) {
    // 対象ブロックの終了タグの位置を見つける
    const insertPos = findClosingTagPosition(result, targetTag, targetId);
    if (insertPos >= 0) {
      result = result.substring(0, insertPos) + insertBlockXml + result.substring(insertPos);
    } else {
      logLines.push(`<div class="old">⚠ ブロック挿入位置が特定できませんでした</div>`);
    }
  }

  // cell-specの挿入（最後のcell-specの後、またはrow-axis-specの後）
  if (insertCellXml) {
    const lastCellMatch = result.lastIndexOf('</cell-spec>');
    if (lastCellMatch >= 0) {
      const pos = lastCellMatch + '</cell-spec>'.length;
      result = result.substring(0, pos) + insertCellXml + result.substring(pos);
    } else {
      // cell-specがない場合、</row-axis-spec>の後に挿入
      const rowEnd = result.lastIndexOf('</row-axis-spec>');
      if (rowEnd >= 0) {
        const pos = rowEnd + '</row-axis-spec>'.length;
        result = result.substring(0, pos) + insertCellXml + result.substring(pos);
      }
    }
    logLines.push(`<div style="margin-top:4px">cell-spec ${cellSpecs.length * count}件を複製しました</div>`);
  }

  document.getElementById('resultXml').value = result;
  document.getElementById('log').innerHTML = logLines.join('');
  document.getElementById('copyBtn').style.display = 'flex';
}

function collectIds(el, result) {
  if (el.getAttribute('id') !== null) result.push(el);
  for (const child of el.children) {
    collectIds(child, result);
  }
}

function generateNewId(existingIds) {
  let id = 1;
  // 既存の最大値 + 1 から始める
  for (const eid of existingIds) {
    if (eid >= id) id = eid + 1;
  }
  return id;
}

function replaceIdInXml(xml, oldId, newId) {
  return xml.replace(
    new RegExp(`(\\bid=")${escRe(oldId)}(")`, 'g'), `$1${newId}$2`
  );
}

function findClosingTagPosition(xml, tagName, id) {
  // id属性を持つ開始タグを見つける
  const openRe = new RegExp(`<${tagName}[^>]*\\bid="${escRe(id)}"[^>]*>`, 'g');
  const match = openRe.exec(xml);
  if (!match) return -1;

  // そこから対応する閉じタグを探す（ネスト対応）
  let pos = match.index + match[0].length;
  let depth = 1;
  const openTag = new RegExp(`<${tagName}[\\s>]`, 'g');
  const closeTag = `</${tagName}>`;

  while (depth > 0 && pos < xml.length) {
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose < 0) return -1;

    // その間に開始タグがあるか
    openTag.lastIndex = pos;
    let nextOpen = openTag.exec(xml);

    if (nextOpen && nextOpen.index < nextClose) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return nextClose + closeTag.length;
      }
      pos = nextClose + closeTag.length;
    }
  }
  return -1;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════════════════════════════════════════════════════════════
// Copy & Clear
// ═══════════════════════════════════════════════════════════════════
async function copyResult() {
  const text = document.getElementById('resultXml').value;
  if (!text) return;
  const btn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ コピーしました';
    setTimeout(() => btn.innerHTML = orig, 2000);
  } catch {
    document.getElementById('resultXml').select();
    document.execCommand('copy');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ コピーしました';
    setTimeout(() => btn.innerHTML = orig, 2000);
  }
}

function clearAll() {
  document.getElementById('xmlInput').value = '';
  document.getElementById('resultXml').value = '';
  document.getElementById('treeArea').innerHTML = '<div class="tree-empty">XMLを入力して構造解析を実行してください</div>';
  document.getElementById('cloneControls').classList.remove('visible');
  document.getElementById('log').innerHTML = '';
  document.getElementById('copyBtn').style.display = 'none';
  parsedDoc = null;
  selectedNode = null;
  selectedMeta = null;
  nodeMap = {};
  crsCounters = {};
}

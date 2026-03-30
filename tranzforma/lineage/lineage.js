'use strict';

/* ================================================================
   Lineage — Dimension hierarchy editor
   ================================================================ */

/* ── State ── */
let roots      = [];
let unlinked   = [];
let allNodes   = [];
let nextId     = 1;

/* ── Selection ── */
const selectedIds = new Set();

/* ── Drag ── */
let dragIds    = [];   // IDs being dragged (may be multiple)
let dragSrcId  = null; // the node the user grabbed

/* ── Search ── */
let searchQuery   = '';
let searchHitIds  = [];   // node IDs with matches, in tree order
let searchCursor  = -1;   // index into searchHitIds

/* ── Undo ── */
const undoStack = [];
const MAX_UNDO  = 50;

/* ── Column mapping ── */
let headerRow  = [];
let col = { label: -1, parent: -1, isRoot: -1, nameJa: -1, nameEn: -1, leaf: -1 };

/* ── DOM refs ── */
let $inputView, $treeView, $pasteArea, $btnParse;
let $treeContainer, $nodeCount, $dropIndicator, $dropChildIndicator;
let $dragGhost = null;

/* ================================================================
   Parse
   ================================================================ */
function unquote(s) {
  const t = (s || '').trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1);
  return t;
}

function parseInput(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length === 0) return { roots: [], unlinked: [] };

  const rows = lines.map(l => l.split('\t'));
  let hdrIdx = rows.findIndex(r => r[1] === 'HDR');
  if (hdrIdx === -1) return { roots: parseFallback(lines), unlinked: [] };

  headerRow = rows[hdrIdx];
  col = { label: -1, parent: -1, isRoot: -1, nameJa: -1, nameEn: -1, leaf: -1 };
  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i].trim().toUpperCase();
    if (h === 'LABEL')         col.label  = i;
    else if (h === 'PARENT')   col.parent = i;
    else if (h === 'IS_ROOT')  col.isRoot = i;
    else if (h === 'NAME:JA')  col.nameJa = i;
    else if (h === 'NAME:EN')  col.nameEn = i;
    else if (h === 'P:#LEAF')  col.leaf   = i;
  }
  if (col.label === -1) { showToast('LABEL 列が見つかりません', true); return { roots: [], unlinked: [] }; }

  const nodeMap = new Map();
  const nodeList = [];
  for (let i = 0; i < rows.length; i++) {
    if (i === hdrIdx || rows[i][1] !== 'DTL') continue;
    const cleaned = rows[i].map(f => unquote(f));
    const label = (cleaned[col.label] || '').trim();
    if (!label) continue;
    const node = { id: nextId++, row: cleaned, children: [], collapsed: false };
    if (!nodeMap.has(label)) nodeMap.set(label, []);
    nodeMap.get(label).push(node);
    nodeList.push(node);
  }

  const treeRoots = [], orphans = [];
  for (const node of nodeList) {
    const parentLabel = col.parent >= 0 ? (node.row[col.parent] || '').trim() : '';
    const isRootVal   = col.isRoot >= 0 ? (node.row[col.isRoot] || '').trim().toUpperCase() === 'TRUE' : false;
    if (isRootVal) { treeRoots.push(node); }
    else if (parentLabel) {
      const candidates = nodeMap.get(parentLabel);
      const parentNode = candidates ? candidates.find(n => n !== node) || candidates[0] : null;
      if (parentNode) parentNode.children.push(node); else orphans.push(node);
    } else { orphans.push(node); }
  }
  allNodes = nodeList;
  // Large data: collapse all nodes that have children for faster initial render
  if (nodeList.length > 200) {
    for (const n of nodeList) if (n.children.length > 0) n.collapsed = true;
  }
  return { roots: treeRoots, unlinked: orphans };
}

function parseFallback(lines) {
  headerRow = [];
  col = { label: -1, parent: -1, isRoot: -1, nameJa: -1, nameEn: -1, leaf: -1 };
  const result = [], stack = [{ depth: -1, children: result }];
  for (const raw of lines) {
    const m = raw.match(/^(\t*)(.*)/);
    const depth = m[1].length, content = m[2];
    if (!content.trim()) continue;
    const node = { id: nextId++, row: content.split('\t').map(f => f.trim()), children: [], collapsed: false };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push({ depth, children: node.children, node });
    allNodes.push(node);
  }
  return result;
}

/* ================================================================
   Node display / property helpers
   ================================================================ */
function getLabel(node) {
  return (node.row[col.label >= 0 ? col.label : 0] || '').trim();
}
function getDisplayName(node) {
  if (col.nameJa >= 0 && (node.row[col.nameJa] || '').trim()) return node.row[col.nameJa].trim();
  if (col.nameEn >= 0 && (node.row[col.nameEn] || '').trim()) return node.row[col.nameEn].trim();
  if (headerRow.length === 0 && node.row.length > 1) return (node.row[1] || '').trim();
  return '';
}
function isLeafNode(node) {
  if (col.leaf < 0) return false;
  return (node.row[col.leaf] || '').trim().toUpperCase() === 'TRUE';
}

/* ================================================================
   Tree helpers
   ================================================================ */
function findNodeGlobal(id) { return findNode(id, roots) || findNode(id, unlinked); }

function findNode(id, nodes) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(id, n.children);
    if (f) return f;
  }
  return null;
}

function findParent(id, nodes, parent) {
  for (const n of nodes) {
    if (n.id === id) return { parent, siblings: nodes };
    const f = findParent(id, n.children, n);
    if (f) return f;
  }
  return null;
}

function findParentGlobal(id) { return findParent(id, roots, null) || findParent(id, unlinked, null); }

function removeNode(id) {
  let info = findParent(id, roots, null) || findParent(id, unlinked, null);
  if (!info) return null;
  const idx = info.siblings.findIndex(n => n.id === id);
  return info.siblings.splice(idx, 1)[0];
}

function isDescendant(ancestorId, nodeId) {
  const a = findNodeGlobal(ancestorId);
  return a ? !!findNode(nodeId, a.children) : false;
}

function countNodes(nodes) {
  let c = nodes.length;
  for (const n of nodes) c += countNodes(n.children);
  return c;
}

function syncParentFields(node, parentNode) {
  if (col.parent >= 0) node.row[col.parent] = parentNode ? getLabel(parentNode) : '';
  if (col.isRoot >= 0) node.row[col.isRoot] = parentNode ? 'FALSE' : 'TRUE';
}

/** Deep-clone a node tree with new IDs */
function cloneNodeDeep(node) {
  return {
    id:        nextId++,
    row:       node.row.slice(),
    children:  node.children.map(c => cloneNodeDeep(c)),
    collapsed: node.collapsed,
  };
}

/** Collect IDs in tree-traversal order, filtered to a set */
function collectInOrder(nodes, filterSet, result) {
  for (const n of nodes) {
    if (filterSet.has(n.id)) result.push(n.id);
    collectInOrder(n.children, filterSet, result);
  }
}

/** From a set of selected IDs, keep only top-level ones (exclude nodes whose ancestor is also selected) */
function getTopLevelIds(ids) {
  return ids.filter(id => {
    let cur = id;
    while (true) {
      const info = findParentGlobal(cur);
      if (!info || !info.parent) break;
      if (selectedIds.has(info.parent.id)) return false;
      cur = info.parent.id;
    }
    return true;
  });
}

/* ================================================================
   Selection
   ================================================================ */
function selectNode(id, ctrlKey) {
  if (ctrlKey) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  } else {
    selectedIds.clear();
    selectedIds.add(id);
  }
  updateSelectionUI();
}

function clearSelection() {
  selectedIds.clear();
  updateSelectionUI();
}

function updateSelectionUI() {
  document.querySelectorAll('.node-row').forEach(row => {
    const id = Number(row.dataset.id);
    row.classList.toggle('selected', selectedIds.has(id));
  });
}

/* ================================================================
   Undo
   ================================================================ */
function cloneNodes(nodes) {
  return nodes.map(n => ({ id: n.id, row: n.row.slice(), children: cloneNodes(n.children), collapsed: n.collapsed }));
}
function saveSnapshot() {
  undoStack.push({ roots: cloneNodes(roots), unlinked: cloneNodes(unlinked), nextId });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  updateUndoBtn();
}
function undo() {
  if (undoStack.length === 0) return;
  const snap = undoStack.pop();
  roots = snap.roots; unlinked = snap.unlinked; nextId = snap.nextId;
  selectedIds.clear();
  renderTree(); updateUndoBtn();
  showToast('元に戻しました');
}
function updateUndoBtn() {
  const btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = undoStack.length === 0;
}

/* ================================================================
   Search
   ================================================================ */
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function highlightText(text, query, isCurrent) {
  if (!query || !text) return escHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return escHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), (m) => {
    return `<span class="search-hit${isCurrent ? ' current' : ''}">${m}</span>`;
  });
}

function nodeMatchesSearch(node, query) {
  const q = query.toLowerCase();
  return getLabel(node).toLowerCase().includes(q) || getDisplayName(node).toLowerCase().includes(q);
}

/** Build searchHitIds in tree order, auto-expand ancestors of hits */
function buildSearchHits() {
  searchHitIds = [];
  if (!searchQuery) return;
  function walk(nodes, ancestors) {
    for (const n of nodes) {
      if (nodeMatchesSearch(n, searchQuery)) {
        searchHitIds.push(n.id);
        // expand all ancestors so the hit is visible
        for (const a of ancestors) a.collapsed = false;
      }
      walk(n.children, [...ancestors, n]);
    }
  }
  walk(roots, []);
  walk(unlinked, []);
}

function updateSearchUI() {
  const $count   = document.getElementById('search-count');
  const $btnNext = document.getElementById('btn-search-next');
  const $btnPrev = document.getElementById('btn-search-prev');
  if (searchHitIds.length > 0) {
    $count.textContent = `${searchCursor + 1}/${searchHitIds.length}`;
    $btnNext.disabled = false;
    $btnPrev.disabled = false;
  } else if (searchQuery) {
    $count.textContent = '0';
    $btnNext.disabled = true;
    $btnPrev.disabled = true;
  } else {
    $count.textContent = '';
    $btnNext.disabled = true;
    $btnPrev.disabled = true;
  }
}

let _searchTimer = null;
function onSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    searchQuery = document.getElementById('search-input').value.trim();
    buildSearchHits();
    searchCursor = searchHitIds.length > 0 ? 0 : -1;
    renderTree();
    updateSearchUI();
    scrollToCurrentHit();
  }, 200);
}

function onSearchKey(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) searchPrev(); else searchNext();
  }
  if (e.key === 'Escape') {
    document.getElementById('search-input').value = '';
    searchQuery = '';
    searchHitIds = [];
    searchCursor = -1;
    renderTree();
    updateSearchUI();
  }
}

function searchNext() {
  if (searchHitIds.length === 0) return;
  searchCursor = (searchCursor + 1) % searchHitIds.length;
  renderTree();
  updateSearchUI();
  scrollToCurrentHit();
}

function searchPrev() {
  if (searchHitIds.length === 0) return;
  searchCursor = (searchCursor - 1 + searchHitIds.length) % searchHitIds.length;
  renderTree();
  updateSearchUI();
  scrollToCurrentHit();
}

function scrollToCurrentHit() {
  if (searchCursor < 0 || searchCursor >= searchHitIds.length) return;
  const id = searchHitIds[searchCursor];
  requestAnimationFrame(() => {
    const el = $treeContainer.querySelector(`.node-row[data-id="${id}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

/* ================================================================
   Render
   ================================================================ */
function setCollapseAll(collapsed) {
  function walk(nodes) { for (const n of nodes) { n.collapsed = collapsed; walk(n.children); } }
  walk(roots);
  walk(unlinked);
  renderTree();
}

function renderTree() {
  $treeContainer.innerHTML = '';
  if (roots.length === 0 && unlinked.length === 0) {
    $treeContainer.innerHTML =
      '<div style="padding:40px;text-align:center;color:var(--text3);font:14px var(--sans)">' +
      'ノードがありません。「+ ルート追加」でノードを追加してください。</div>';
  } else {
    for (const node of roots) $treeContainer.appendChild(renderNode(node, 0));
    if (unlinked.length > 0) {
      const section = document.createElement('div');
      section.className = 'unlinked-section';
      const heading = document.createElement('div');
      heading.className = 'unlinked-heading';
      const unlinkedCount = countNodes(unlinked);
      heading.textContent = 'ツリー外 (' + unlinkedCount + ')';
      const hasUnlinkedHit = searchHitIds.some(id => findNode(id, unlinked));
      const startCollapsed = unlinkedCount > 200 && !hasUnlinkedHit;
      if (startCollapsed) heading.classList.add('collapsed');
      section.appendChild(heading);
      const list = document.createElement('div');
      list.className = 'unlinked-list';
      let unlinkedRendered = !startCollapsed;
      if (unlinkedRendered) for (const node of unlinked) list.appendChild(renderNode(node, 0));
      heading.addEventListener('click', () => {
        const isCollapsed = heading.classList.toggle('collapsed');
        if (!isCollapsed && !unlinkedRendered) {
          unlinkedRendered = true;
          for (const node of unlinked) list.appendChild(renderNode(node, 0));
        }
      });
      section.appendChild(list);
      $treeContainer.appendChild(section);
    }
  }
  const total = countNodes(roots) + countNodes(unlinked);
  $nodeCount.textContent = total + ' nodes';
}

function renderNode(node, depth) {
  const leaf = isLeafNode(node);
  const el = document.createElement('div');
  el.className = 'tree-node';
  el.dataset.id = node.id;

  const row = document.createElement('div');
  row.className = 'node-row' + (leaf ? ' is-leaf' : '') + (selectedIds.has(node.id) ? ' selected' : '');
  row.draggable = true;
  row.style.paddingLeft = (depth * 22 + 8) + 'px';
  row.dataset.id = node.id;

  // Click → selection
  row.addEventListener('click', (e) => {
    // Ignore if click was on a button
    if (e.target.closest('button')) return;
    e.stopPropagation();
    selectNode(node.id, e.ctrlKey || e.metaKey);
  });

  const toggle = document.createElement('button');
  const hasChildren = node.children.length > 0;
  toggle.className = 'node-toggle' + (!hasChildren ? ' leaf' : '');
  toggle.innerHTML = hasChildren ? (node.collapsed ? '▶' : '▼') : '';
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (hasChildren) { node.collapsed = !node.collapsed; renderTree(); }
  });

  const label = document.createElement('span');
  label.className = 'node-label';
  const labelText = getLabel(node);
  const nameText  = getDisplayName(node);
  const isCurrent = searchHitIds.length > 0 && searchHitIds[searchCursor] === node.id;

  if (searchQuery) {
    label.innerHTML = highlightText(labelText, searchQuery, isCurrent);
  } else {
    label.textContent = labelText;
  }

  const name = document.createElement('span');
  name.className = 'node-name';
  if (searchQuery) {
    name.innerHTML = highlightText(nameText, searchQuery, isCurrent);
  } else {
    name.textContent = nameText;
  }

  const actions = document.createElement('span');
  actions.className = 'node-actions';
  if (!leaf) {
    const btnAdd = document.createElement('button');
    btnAdd.title = '子ノード追加';
    btnAdd.textContent = '+';
    btnAdd.addEventListener('click', (e) => { e.stopPropagation(); addChild(node.id); });
    actions.appendChild(btnAdd);
  }
  const inUnlinked = isInUnlinked(node.id);
  const btnDel = document.createElement('button');
  btnDel.className = 'btn-del';
  btnDel.title = inUnlinked ? '完全に削除' : 'ツリー外へ移動';
  btnDel.textContent = '×';
  btnDel.addEventListener('click', (e) => { e.stopPropagation(); deleteNode(node.id); });
  actions.appendChild(btnDel);

  row.append(toggle, label, name, actions);

  row.addEventListener('dragstart', onDragStart);
  row.addEventListener('dragover',  onDragOver);
  row.addEventListener('dragleave', onDragLeave);
  row.addEventListener('drop',      onDrop);
  row.addEventListener('dragend',   onDragEnd);

  el.appendChild(row);

  const childrenEl = document.createElement('div');
  childrenEl.className = 'node-children' + (node.collapsed ? ' collapsed' : '');
  for (const child of node.children) childrenEl.appendChild(renderNode(child, depth + 1));
  el.appendChild(childrenEl);

  return el;
}

/* ================================================================
   Node operations
   ================================================================ */
function addChild(parentId) {
  const parent = findNodeGlobal(parentId);
  if (!parent || isLeafNode(parent)) return;
  const label = prompt('ラベルを入力:');
  if (!label) return;
  saveSnapshot();
  const newRow = headerRow.length > 0 ? headerRow.map(() => '') : [label];
  if (headerRow.length > 0) {
    newRow[0] = headerRow[0] ? 'ADD_OR_UPDATE_MEMBER' : '';
    newRow[1] = 'DTL';
    if (col.label  >= 0) newRow[col.label]  = label;
    if (col.parent >= 0) newRow[col.parent] = getLabel(parent);
    if (col.isRoot >= 0) newRow[col.isRoot] = 'FALSE';
    if (col.leaf   >= 0) newRow[col.leaf]   = 'TRUE';
  }
  const node = { id: nextId++, row: newRow, children: [], collapsed: false };
  parent.children.push(node);
  parent.collapsed = false;
  allNodes.push(node);
  renderTree();
}

function addRoot() {
  const label = prompt('ラベルを入力:');
  if (!label) return;
  saveSnapshot();
  const newRow = headerRow.length > 0 ? headerRow.map(() => '') : [label];
  if (headerRow.length > 0) {
    newRow[0] = headerRow[0] ? 'ADD_OR_UPDATE_MEMBER' : '';
    newRow[1] = 'DTL';
    if (col.label  >= 0) newRow[col.label]  = label;
    if (col.parent >= 0) newRow[col.parent] = '';
    if (col.isRoot >= 0) newRow[col.isRoot] = 'TRUE';
    if (col.leaf   >= 0) newRow[col.leaf]   = 'FALSE';
  }
  const node = { id: nextId++, row: newRow, children: [], collapsed: false };
  roots.push(node);
  allNodes.push(node);
  renderTree();
}

/** Flatten a node subtree into a list of individual nodes */
function flattenSubtree(nodes, result) {
  for (const n of nodes) {
    result.push(n);
    flattenSubtree(n.children, result);
  }
}

/** Collect all labels in a node list (recursively) */
function collectLabels(nodes, labelSet) {
  for (const n of nodes) {
    labelSet.add(getLabel(n));
    collectLabels(n.children, labelSet);
  }
}

/** Check if a node lives in the unlinked list */
function isInUnlinked(id) { return !!findNode(id, unlinked); }

/** Move nodes to unlinked, flattening subtrees, skipping duplicate labels */
function moveNodesToUnlinked(ids) {
  const existingLabels = new Set();
  collectLabels(unlinked, existingLabels);

  for (const id of ids) {
    const removed = removeNode(id);
    if (!removed) continue;
    const flat = [];
    flattenSubtree([removed], flat);
    for (const n of flat) {
      const lbl = getLabel(n);
      if (existingLabels.has(lbl)) continue;
      n.children = [];
      if (col.parent >= 0) n.row[col.parent] = '';
      if (col.isRoot >= 0) n.row[col.isRoot] = 'FALSE';
      unlinked.push(n);
      existingLabels.add(lbl);
    }
  }
}

function deleteNode(id) {
  const node = findNodeGlobal(id);
  if (!node) return;

  if (isInUnlinked(id)) {
    // Already in unlinked → actually remove
    saveSnapshot();
    removeNode(id);
  } else {
    // In tree → move to unlinked
    saveSnapshot();
    moveNodesToUnlinked([id]);
  }
  selectedIds.delete(id);
  renderTree();
}

function deleteSelected() {
  if (selectedIds.size === 0) return;

  const ordered = [];
  collectInOrder(roots, selectedIds, ordered);
  collectInOrder(unlinked, selectedIds, ordered);
  const topIds = getTopLevelIds(ordered);
  if (topIds.length === 0) return;

  // Separate: tree nodes → move to unlinked, unlinked nodes → actually delete
  const treeIds     = topIds.filter(id => !isInUnlinked(id));
  const unlinkedIds = topIds.filter(id => isInUnlinked(id));

  saveSnapshot();
  if (treeIds.length > 0)     moveNodesToUnlinked(treeIds);
  if (unlinkedIds.length > 0) for (const id of unlinkedIds) removeNode(id);
  selectedIds.clear();
  renderTree();
}

/* ================================================================
   Drag & Drop
   ================================================================ */
function onDragStart(e) {
  const clickedId = Number(e.currentTarget.dataset.id);

  // If dragged node is in selection, drag all selected; otherwise drag just this one
  if (selectedIds.has(clickedId) && selectedIds.size > 1) {
    const ordered = [];
    collectInOrder(roots, selectedIds, ordered);
    collectInOrder(unlinked, selectedIds, ordered);
    dragIds = getTopLevelIds(ordered);
  } else {
    dragIds = [clickedId];
    // Select just this node
    selectedIds.clear();
    selectedIds.add(clickedId);
    updateSelectionUI();
  }

  dragSrcId = clickedId;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', String(clickedId));

  // Ghost
  const firstNode = findNodeGlobal(dragIds[0]);
  if (firstNode) {
    $dragGhost = document.createElement('div');
    $dragGhost.className = 'drag-ghost';
    const txt = getLabel(firstNode);
    $dragGhost.textContent = dragIds.length > 1 ? txt + ' +' + (dragIds.length - 1) : txt;
    document.body.appendChild($dragGhost);
    e.dataTransfer.setDragImage($dragGhost, 0, 16);
  }
}

function getDropPosition(e, rowEl) {
  const rect  = rowEl.getBoundingClientRect();
  const y     = e.clientY - rect.top;
  const ratio = y / rect.height;

  const targetId = Number(rowEl.dataset.id);
  const targetNode = findNodeGlobal(targetId);
  if (targetNode && isLeafNode(targetNode)) return ratio < 0.5 ? 'before' : 'after';
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'inside';
}

function isDragTarget(targetId) {
  // Target cannot be any of the dragged nodes or their descendants
  for (const id of dragIds) {
    if (targetId === id) return true;
    if (isDescendant(id, targetId)) return true;
  }
  return false;
}

function onDragOver(e) {
  e.preventDefault();
  const isCtrl = e.ctrlKey || e.metaKey;
  e.dataTransfer.dropEffect = isCtrl ? 'copy' : 'move';

  const rowEl    = e.currentTarget;
  const targetId = Number(rowEl.dataset.id);
  if (isDragTarget(targetId)) return;

  clearDropIndicators();

  const pos = getDropPosition(e, rowEl);
  if (pos === 'inside') {
    rowEl.classList.add('drop-inside');
    $dropIndicator.style.display = 'none';
    const rect  = rowEl.getBoundingClientRect();
    const style = window.getComputedStyle(rowEl);
    const pLeft = parseInt(style.paddingLeft, 10);
    const childLeft = rect.left + pLeft + 22;
    $dropChildIndicator.style.top   = rect.bottom + 'px';
    $dropChildIndicator.style.left  = childLeft + 'px';
    $dropChildIndicator.style.width = Math.max(60, rect.right - childLeft - 8) + 'px';
    $dropChildIndicator.style.display = 'block';
  } else {
    const rect  = rowEl.getBoundingClientRect();
    const y     = pos === 'before' ? rect.top : rect.bottom;
    const style = window.getComputedStyle(rowEl);
    const left  = rect.left + parseInt(style.paddingLeft, 10) + 20;
    $dropIndicator.style.top   = y + 'px';
    $dropIndicator.style.left  = left + 'px';
    $dropIndicator.style.width = (rect.right - left - 8) + 'px';
    $dropIndicator.style.display = 'block';
    $dropChildIndicator.style.display = 'none';
  }
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drop-inside');
}

function onDrop(e) {
  e.preventDefault();
  clearDropIndicators();

  const targetId = Number(e.currentTarget.dataset.id);
  if (isDragTarget(targetId)) return;

  const pos    = getDropPosition(e, e.currentTarget);
  const isCtrl = e.ctrlKey || e.metaKey;

  saveSnapshot();

  // Prepare source nodes: clone or remove
  const srcNodes = [];
  for (const id of dragIds) {
    if (isCtrl) {
      const orig = findNodeGlobal(id);
      if (orig) srcNodes.push(cloneNodeDeep(orig));
    } else {
      const removed = removeNode(id);
      if (removed) srcNodes.push(removed);
    }
  }
  if (srcNodes.length === 0) return;

  if (pos === 'inside') {
    const target = findNodeGlobal(targetId);
    if (target && !isLeafNode(target)) {
      for (const n of srcNodes) {
        target.children.push(n);
        syncParentFields(n, target);
      }
      target.collapsed = false;
    }
  } else {
    // Find target's container list
    let info = findParent(targetId, roots, null);
    let targetList = roots;
    if (!info) { info = findParent(targetId, unlinked, null); targetList = unlinked; }

    if (info) {
      let idx = info.siblings.findIndex(n => n.id === targetId);
      if (pos === 'after') idx++;
      for (let i = 0; i < srcNodes.length; i++) {
        info.siblings.splice(idx + i, 0, srcNodes[i]);
        syncParentFields(srcNodes[i], info.parent);
      }
    } else {
      let idx = targetList.findIndex(n => n.id === targetId);
      if (pos === 'after') idx++;
      for (let i = 0; i < srcNodes.length; i++) {
        targetList.splice(idx + i, 0, srcNodes[i]);
        if (targetList === roots) syncParentFields(srcNodes[i], null);
        else {
          if (col.parent >= 0) srcNodes[i].row[col.parent] = '';
          if (col.isRoot >= 0) srcNodes[i].row[col.isRoot] = 'FALSE';
        }
      }
    }
  }

  dragIds = [];
  dragSrcId = null;
  selectedIds.clear();
  renderTree();
  showToast(isCtrl ? '複製しました' : '移動しました');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  clearDropIndicators();
  dragIds = [];
  dragSrcId = null;
  if ($dragGhost) { $dragGhost.remove(); $dragGhost = null; }
}

function clearDropIndicators() {
  $dropIndicator.style.display = 'none';
  $dropChildIndicator.style.display = 'none';
  document.querySelectorAll('.drop-inside').forEach(el => el.classList.remove('drop-inside'));
}

/* ================================================================
   Export
   ================================================================ */
function collectNodes(nodes, result) {
  for (const node of nodes) {
    result.push(node.row.join('\t'));
    collectNodes(node.children, result);
  }
}

/** Calculate maximum depth of a node list */
function getMaxDepth(nodes, depth) {
  let max = nodes.length > 0 ? depth : 0;
  for (const n of nodes) max = Math.max(max, getMaxDepth(n.children, depth + 1));
  return max;
}

/** Export: Level columns — each depth gets its own column, plus name */
function exportLevelColumns(nodes, depth, maxDepth, lines) {
  for (const node of nodes) {
    const cols = new Array(maxDepth + 1).fill('');
    cols[depth] = getLabel(node);
    const name = getDisplayName(node);
    if (name) cols.push(name);
    lines.push(cols.join('\t'));
    exportLevelColumns(node.children, depth + 1, maxDepth, lines);
  }
}

/** Export: Tree view with ├─ └─ │ connectors */
function exportTreeView(nodes, prefix, lines) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = prefix.length === 0 ? '' : (isLast ? '└─ ' : '├─ ');
    const label = getLabel(node);
    const name  = getDisplayName(node);
    const text  = name ? label + '\t' + name : label;
    lines.push(prefix + connector + text);
    const childPrefix = prefix.length === 0
      ? '  '
      : prefix + (isLast ? '   ' : '│  ');
    exportTreeView(node.children, childPrefix, lines);
  }
}

function copyToClipboard() {
  const format = document.getElementById('export-format').value;
  const lines = [];

  if (format === 'original') {
    if (headerRow.length > 0) lines.push(headerRow.join('\t'));
    collectNodes(roots, lines);
    collectNodes(unlinked, lines);
  } else if (format === 'levels') {
    const maxDepth = Math.max(getMaxDepth(roots, 0), getMaxDepth(unlinked, 0));
    // Header: Level0, Level1, ..., Name
    const hdr = [];
    for (let i = 0; i <= maxDepth; i++) hdr.push('Level' + i);
    hdr.push('Name');
    lines.push(hdr.join('\t'));
    exportLevelColumns(roots, 0, maxDepth, lines);
    if (unlinked.length > 0) {
      lines.push('');
      lines.push('--- ツリー外 ---');
      exportLevelColumns(unlinked, 0, maxDepth, lines);
    }
  } else if (format === 'tree') {
    exportTreeView(roots, '', lines);
    if (unlinked.length > 0) {
      lines.push('');
      lines.push('--- ツリー外 ---');
      exportTreeView(unlinked, '', lines);
    }
  }

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    showToast('クリップボードにコピーしました');
  }).catch(() => {
    showToast('コピーに失敗しました', true);
  });
}

/* ================================================================
   UI state
   ================================================================ */
function showInputView() {
  roots = []; unlinked = []; allNodes = [];
  nextId = 1; undoStack.length = 0;
  selectedIds.clear(); dragIds = [];
  searchQuery = ''; searchHitIds = []; searchCursor = -1;
  headerRow = [];
  col = { label: -1, parent: -1, isRoot: -1, nameJa: -1, nameEn: -1, leaf: -1 };
  $pasteArea.value = ''; $btnParse.disabled = true;
  document.getElementById('search-input').value = '';
  $inputView.style.display = '';
  $treeView.style.display  = 'none';
}

function showTreeView() {
  $inputView.style.display = 'none';
  $treeView.style.display  = '';
  renderTree();
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 2000);
}

/* ================================================================
   Init
   ================================================================ */
function init() {
  $inputView          = document.getElementById('input-view');
  $treeView           = document.getElementById('tree-view');
  $pasteArea          = document.getElementById('paste-area');
  $btnParse           = document.getElementById('btn-parse');
  $treeContainer      = document.getElementById('tree-container');
  $nodeCount          = document.getElementById('node-count');
  $dropIndicator      = document.getElementById('drop-indicator');
  $dropChildIndicator = document.getElementById('drop-child-indicator');

  $pasteArea.addEventListener('input', () => { $btnParse.disabled = !$pasteArea.value.trim(); });

  $btnParse.addEventListener('click', () => {
    const text = $pasteArea.value;
    if (!text.trim()) return;
    const result = parseInput(text);
    roots = result.roots || []; unlinked = result.unlinked || [];
    if (roots.length === 0 && unlinked.length === 0) { showToast('解析できるデータがありませんでした', true); return; }
    showTreeView();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ($treeView.style.display === 'none') return;
    // Ctrl+Z: undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    // Delete / Backspace: delete selected
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't intercept if focus is in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (selectedIds.size > 0) { e.preventDefault(); deleteSelected(); }
    }
    // Escape: clear selection
    if (e.key === 'Escape') { clearSelection(); }
  });

  // Click on empty area → clear selection
  $treeContainer.addEventListener('click', (e) => {
    if (e.target === $treeContainer || e.target.closest('.unlinked-section') === e.target) {
      clearSelection();
    }
  });

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-expand').addEventListener('click', () => { setCollapseAll(false); });
  document.getElementById('btn-collapse').addEventListener('click', () => { setCollapseAll(true); });
  document.getElementById('btn-search-prev').addEventListener('click', searchPrev);
  document.getElementById('btn-search-next').addEventListener('click', searchNext);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('btn-clear').addEventListener('click', () => {
    const total = countNodes(roots) + countNodes(unlinked);
    if (total > 0 && !confirm('ツリーをクリアして入力画面に戻りますか？')) return;
    showInputView();
  });
}

document.addEventListener('DOMContentLoaded', init);

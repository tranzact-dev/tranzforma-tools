// apd-parser.js - APD file parser for Requester Wizard

/**
 * Parse an APD file and extract wizard-relevant data.
 * @param {string} xml - raw APD file content
 * @returns {object} parsed result
 */
function parseAPD(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('APD の XML 解析に失敗しました');
  }

  // APPLICATION entry (top-level)
  const appEntry = Array.from(doc.documentElement.children)
    .find(n => n.tagName === 'entry' && n.getAttribute('type') === 'APPLICATION');
  if (!appEntry) throw new Error('APPLICATION エントリが見つかりません');

  const result = {
    application:       appEntry.getAttribute('label') || '',
    applicationType:   '',   // ENTERPRISE / WORKGROUP_GROUP etc.
    schemaVersion:     '',   // e.g. S135
    forms:             [],
    dimensions:        [],
    scripts:           [],
    translationTables: [],
    fiscalYears:       [],   // FY19, FY20, ...
    periodMembers:     [],   // M04, M05, ... in FY order
    scenarioMembers:   [],
  };

  // ── helpers ─────────────────────────────────────────────────────────

  /** Get <elements> > <entry type="..."> children */
  function childEntries(parent, type) {
    const el = Array.from(parent.children).find(n => n.tagName === 'elements');
    if (!el) return [];
    const all = Array.from(el.children).filter(n => n.tagName === 'entry');
    return type ? all.filter(e => e.getAttribute('type') === type) : all;
  }

  /** Get text content of first <content> child */
  function contentText(entry) {
    const c = Array.from(entry.children).find(n => n.tagName === 'content');
    return c ? c.textContent : '';
  }

  /** Parse HTML-entity-encoded inner XML stored in <content> */
  function parseInnerXml(entry) {
    const text = contentText(entry);
    if (!text) return null;
    return parser.parseFromString(text, 'application/xml');
  }

  /** Extract form name from rawSpec XML (prefers ja, falls back to en) */
  function extractFormName(rawSpec) {
    if (!rawSpec) return '';
    const specDoc = parser.parseFromString(rawSpec, 'application/xml');
    if (specDoc.querySelector('parsererror')) return '';
    const nameEl = specDoc.querySelector('name');
    if (!nameEl) return '';
    const text = nameEl.textContent || '';
    // Format: en;"English name";ja;"Japanese name"
    const jaMatch = text.match(/ja;"([^"]*)"/);
    if (jaMatch) return jaMatch[1];
    const enMatch = text.match(/en;"([^"]*)"/);
    if (enMatch) return enMatch[1];
    return text.trim();
  }

  // ── SCHEMA_VERSION ───────────────────────────────────────────────────
  const schemaVerEntry = childEntries(appEntry, 'SCHEMA_VERSION')[0];
  if (schemaVerEntry) result.schemaVersion = contentText(schemaVerEntry).trim();

  // ── APPLICATION_TYPE ─────────────────────────────────────────────────
  const appTypeEntry = childEntries(appEntry, 'APPLICATION_TYPE')[0];
  if (appTypeEntry) result.applicationType = contentText(appTypeEntry).trim();

  // ── FORM list ────────────────────────────────────────────────────────
  // Path: FORM_LISTS > FORM_LIST > FORMS > FORM
  const formListsEntry = childEntries(appEntry, 'FORM_LISTS')[0];
  if (formListsEntry) {
    for (const fl of childEntries(formListsEntry, 'FORM_LIST')) {
      const formsEntry = childEntries(fl, 'FORMS')[0];
      if (formsEntry) {
        for (const f of childEntries(formsEntry, 'FORM')) {
          const label = f.getAttribute('label');
          if (!label) continue;
          const specEntry = childEntries(f, 'DOCUMENT_SPEC')[0]
                         || childEntries(f, 'SIMPLE_DOCUMENT_SPEC')[0];
          const rawSpec = specEntry ? contentText(specEntry) : '';
          const name = extractFormName(rawSpec);
          result.forms.push({ label, name, rawSpec });
        }
      }
    }
  }

  // ── DIMENSION list ───────────────────────────────────────────────────
  // Path: DIMENSIONS > DIMENSION
  const dimensionsEntry = childEntries(appEntry, 'DIMENSIONS')[0];
  if (dimensionsEntry) {
    for (const d of childEntries(dimensionsEntry, 'DIMENSION')) {
      const label = d.getAttribute('label');
      if (label) result.dimensions.push(label);
    }
  }

  // ── SCRIPT list ──────────────────────────────────────────────────────
  // Path: SCRIPTS > SCRIPT
  const scriptsEntry = childEntries(appEntry, 'SCRIPTS')[0];
  if (scriptsEntry) {
    for (const s of childEntries(scriptsEntry, 'SCRIPT')) {
      const label = s.getAttribute('label');
      if (label) result.scripts.push(label);
    }
  }

  // ── TRANSLATION_TABLE list ───────────────────────────────────────────
  // Path: TRANSLATION_TABLES > TRANSLATION_TABLE
  const ttListEntry = childEntries(appEntry, 'TRANSLATION_TABLES')[0];
  if (ttListEntry) {
    for (const tt of childEntries(ttListEntry, 'TRANSLATION_TABLE')) {
      const label = tt.getAttribute('label');
      if (label) result.translationTables.push(label);
    }
  }

  // ── FISCAL_YEAR list ─────────────────────────────────────────────────
  // Direct children: FISCAL_YEAR_TABLE > FISCAL_YEAR (no encoding)
  const fyTableEntry = childEntries(appEntry, 'FISCAL_YEAR_TABLE')[0];
  if (fyTableEntry) {
    for (const fy of childEntries(fyTableEntry, 'FISCAL_YEAR')) {
      const label = fy.getAttribute('label');
      if (label) result.fiscalYears.push(label);
    }
  }

  // ── #PERIOD members (encoded inner XML) ──────────────────────────────
  // Month-level relative-period: label matches /^M\d+$/
  const periodTableEntry = childEntries(appEntry, 'PERIOD_TABLE')[0];
  if (periodTableEntry) {
    const inner = parseInnerXml(periodTableEntry);
    if (inner) {
      for (const rp of inner.querySelectorAll('relative-period')) {
        const label = rp.getAttribute('label');
        if (label && /^M\d+$/.test(label)) result.periodMembers.push(label);
      }
    }
  }

  // ── SCENARIO members ─────────────────────────────────────────────────
  // Path: SCENARIO_TABLE > SCENARIO (same pattern as FISCAL_YEAR_TABLE > FISCAL_YEAR)
  const scenarioTableEntry = childEntries(appEntry, 'SCENARIO_TABLE')[0];
  if (scenarioTableEntry) {
    for (const s of childEntries(scenarioTableEntry, 'SCENARIO')) {
      const label = s.getAttribute('label');
      if (label) result.scenarioMembers.push(label);
    }
  }

  return result;
}

/**
 * Extract POV parameter dimension labels from a DOCUMENT_SPEC raw XML string.
 * Reads <parameter-specs> > <parameter-spec> > <dimension-label> elements.
 * @param {string} rawSpec - decoded inner XML string of DOCUMENT_SPEC
 * @returns {string[]} dimension labels e.g. ['#FY', '#PERIOD', 'SCENARIO']
 */
function getFormParamDimensions(rawSpec) {
  if (!rawSpec) return [];
  try {
    const doc = new DOMParser().parseFromString(rawSpec, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    const els = doc.querySelectorAll('parameter-specs parameter-spec dimension-label');
    return Array.from(els).map(el => el.textContent.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/* ──────────────────────────────────────────────
   XML Import Spec Generator — Business Logic
   ────────────────────────────────────────────── */

/**
 * Parse form-definition XML and validate import-spec presence.
 * @param {string} xmlText
 * @returns {{ hasImportSpec: boolean, sourceFieldCount: number }}
 */
function parseFormXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('XML parse error: ' + parseError.textContent.slice(0, 120));

  const importSpec = doc.querySelector('import-spec');
  if (!importSpec) return { hasImportSpec: false, sourceFieldCount: 0 };

  const sfs = importSpec.querySelector('transformation-spec > source-field-specs');
  const sourceFieldCount = sfs
    ? sfs.querySelectorAll(':scope > source-field-spec').length
    : 0;

  // Extract source-ledger-label for target-ledger-label
  const sll = doc.querySelector('source-ledger-label');
  const sourceLedgerLabel = sll ? sll.textContent.trim() : '';

  // Document label
  const docSpec = doc.querySelector('document-spec');
  const docLabel = docSpec ? (docSpec.getAttribute('label') || '') : '';

  // Derived-field-specs status
  const dfs = importSpec.querySelector('transformation-spec > derived-field-specs');
  const derivedCount = dfs ? dfs.querySelectorAll(':scope > derived-field-spec').length : 0;

  // Dimension labels from loop-specs (row + column axes)
  const loopSpecs = doc.querySelectorAll('loop-spec > member-list-spec > dimension-label');
  const dimensions = [...new Set([...loopSpecs].map(el => el.textContent.trim()))];

  // Export-spec status
  const exportSpec = doc.querySelector('export-spec > enabled');
  const exportEnabled = exportSpec ? exportSpec.textContent.trim() === 'true' : false;

  // Import enabled
  const importEnabled = importSpec.querySelector('enabled');
  const importEnabledVal = importEnabled ? importEnabled.textContent.trim() === 'true' : false;

  return {
    hasImportSpec: true, sourceFieldCount, sourceLedgerLabel,
    docLabel, derivedCount, dimensions, exportEnabled, importEnabledVal
  };
}

/**
 * Parse Excel column-definition (.xlsx).
 * Requires SheetJS (XLSX) loaded globally.
 * @param {ArrayBuffer} buf
 * @returns {Array<{ columnId: string, label: string, name: string, isValue: boolean, fieldKey: string }>}
 */
function parseColumnDef(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (rows.length < 2) throw new Error('Excel has no data rows (header + at least 1 row required)');

  return rows.slice(1)
    .filter(r => r[0] != null && String(r[0]).trim() !== '')
    .map(r => ({
      columnId: String(r[0] ?? '').trim(),
      label:    String(r[1] ?? r[0] ?? '').trim(),
      name:     String(r[2] ?? '').trim() || String(r[1] ?? r[0] ?? '').trim(),
      isValue:  String(r[3] ?? '').toUpperCase() === 'TRUE',
      fieldKey: String(r[4] ?? '').trim(),
    }));
}

/**
 * Build <source-field-spec> XML fragment string from columns.
 * @param {Array} columns
 * @param {string} indent — base indentation for each spec element
 * @returns {string}
 */
function buildSourceFieldSpecsXml(columns, indent) {
  const ci = indent + '    '; // child indent
  return columns.map(col => {
    const lines = [];
    lines.push(col.name
      ? `${ci}<name>ja;"${escXml(col.name)}"</name>`
      : `${ci}<name/>`);
    if (col.isValue) {
      lines.push(`${ci}<is-value>true</is-value>`);
    }
    if (col.fieldKey) {
      lines.push(`${ci}<value-field-key>${escXml(col.fieldKey)}</value-field-key>`);
    }
    return `${indent}<source-field-spec label="${escXml(col.label)}">\n${lines.join('\n')}\n${indent}</source-field-spec>`;
  }).join('\n');
}

/**
 * Replace <source-field-specs> content in the original XML string.
 * Preserves all other parts of the XML exactly as-is.
 * @param {string} xmlText — original XML
 * @param {Array} columns — output of parseColumnDef
 * @returns {{ resultXml: string, count: number }}
 */
function generateImportSpecs(xmlText, columns) {
  // Match <source-field-specs/> or <source-field-specs>...</source-field-specs>
  const re = /(<source-field-specs)\s*\/>/s;
  const re2 = /(<source-field-specs[^>]*>)([\s\S]*?)(<\/source-field-specs>)/;

  // Detect indentation from the original XML
  const indentMatch = xmlText.match(/^([ \t]*)<source-field-specs/m);
  const baseIndent = indentMatch ? indentMatch[1] : '            ';
  const specIndent = baseIndent + '    ';

  const specsContent = buildSourceFieldSpecsXml(columns, specIndent);
  const replacement = `<source-field-specs>\n${specsContent}\n${baseIndent}</source-field-specs>`;

  let resultXml;
  if (re.test(xmlText)) {
    resultXml = xmlText.replace(re, replacement);
  } else if (re2.test(xmlText)) {
    resultXml = xmlText.replace(re2, replacement);
  } else {
    throw new Error('<source-field-specs> not found in XML');
  }

  // Insert target-ledger-label and sign-type into import-spec
  resultXml = insertImportSpecMeta(resultXml);

  // Insert derived-field-specs if empty
  resultXml = insertDerivedFieldSpecs(resultXml, columns);

  return { resultXml, count: columns.length };
}

/**
 * Insert <target-ledger-label> and <sign-type> into <import-spec>
 * between <enabled> and <transformation-spec>, if not already present.
 */
function insertImportSpecMeta(xmlText) {
  // Extract source-ledger-label value
  const sllMatch = xmlText.match(/<source-ledger-label>([^<]*)<\/source-ledger-label>/);
  if (!sllMatch) return xmlText;
  const ledgerLabel = sllMatch[1].trim();

  // Detect import-spec indentation
  const importIndentMatch = xmlText.match(/^([ \t]*)<import-spec>/m);
  const importIndent = importIndentMatch ? importIndentMatch[1] : '    ';
  const childIndent = importIndent + '    ';

  // Insert after <enabled>...</enabled> if target-ledger-label not already present
  if (!/<target-ledger-label>/.test(xmlText)) {
    const enabledRe = /([ \t]*<enabled>[^<]*<\/enabled>)/;
    const insert = `$1\n${childIndent}<target-ledger-label>${escXml(ledgerLabel)}</target-ledger-label>\n${childIndent}<sign-type>ACCOUNT</sign-type>`;
    xmlText = xmlText.replace(enabledRe, insert);
  }

  return xmlText;
}

/**
 * Extract existing source-field-specs from XML and return as column definitions.
 * @param {string} xmlText
 * @returns {Array<{ columnId: string, label: string, name: string }>}
 */
function extractSourceFields(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const specs = doc.querySelectorAll('import-spec > transformation-spec > source-field-specs > source-field-spec');
  const columns = [];
  let colIdx = 0;

  specs.forEach(spec => {
    const label = spec.getAttribute('label') || '';
    const nameEl = spec.querySelector('name');
    let name = '';
    if (nameEl && nameEl.textContent) {
      const m = nameEl.textContent.match(/ja;"(.+)"/);
      name = m ? m[1] : nameEl.textContent;
    }
    const isValueEl = spec.querySelector('is-value');
    const isValue = isValueEl ? isValueEl.textContent.trim().toLowerCase() === 'true' : false;
    const fieldKeyEl = spec.querySelector('value-field-key');
    const fieldKey = fieldKeyEl ? fieldKeyEl.textContent.trim() : '';
    columns.push({
      columnId: String.fromCharCode(65 + colIdx),
      label,
      name,
      isValue,
      fieldKey,
    });
    colIdx++;
  });
  return columns;
}

/**
 * Export column definitions to an xlsx ArrayBuffer.
 * @param {Array} columns — output of extractSourceFields
 * @returns {ArrayBuffer}
 */
function exportColumnDefExcel(columns) {
  const header = ['column_id', 'field_label', 'field_name', 'is_value', 'field_key'];
  const rows = [header, ...columns.map(c => [c.columnId, c.label, c.name, c.isValue ? 'TRUE' : '', c.fieldKey || ''])];
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths
  ws['!cols'] = [
    { wch: 10 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ColumnDef');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

/**
 * Insert derived-field-specs (#CHANGE, #VIEW, #FY, #PERIOD) if derived is empty.
 * Skips any label that already exists in source-field-specs.
 */
function insertDerivedFieldSpecs(xmlText, columns) {
  // Check if derived-field-specs already has content
  const derivedEmpty = /&lt;derived-field-specs\s*\/&gt;/.test(xmlText)
    || /<derived-field-specs\s*\/>/.test(xmlText);
  const derivedWithContent = /<derived-field-specs[^/]*>[\s\S]*?<\/derived-field-specs>/.test(xmlText);

  if (derivedWithContent) {
    // Check if it actually has child elements
    const inner = xmlText.match(/<derived-field-specs[^/]*>([\s\S]*?)<\/derived-field-specs>/);
    if (inner && inner[1].trim().length > 0) return xmlText; // has content, don't touch
  }
  if (!derivedEmpty && !derivedWithContent) return xmlText; // no derived-field-specs tag at all

  // Collect source labels to skip conflicts
  const sourceLabels = new Set(columns.map(c => c.label));

  // Detect date format from YYYYMM source-field-spec's name
  const dateFormat = detectDateFormat(columns);

  // Build derived specs
  const derivedSpecs = [];
  if (!sourceLabels.has('#CHANGE')) {
    derivedSpecs.push({ label: '#CHANGE', expression: '"#NONE"' });
  }
  if (!sourceLabels.has('#VIEW')) {
    derivedSpecs.push({ label: '#VIEW', expression: '"PER"' });
  }
  if (!sourceLabels.has('#FY') && dateFormat) {
    derivedSpecs.push({ label: '#FY', expression: buildFyExpression(dateFormat) });
  }
  if (!sourceLabels.has('#PERIOD') && dateFormat) {
    derivedSpecs.push({ label: '#PERIOD', expression: buildPeriodExpression(dateFormat) });
  }

  if (derivedSpecs.length === 0) return xmlText;

  // Detect indentation
  const indentMatch = xmlText.match(/^([ \t]*)<derived-field-specs/m);
  const baseIndent = indentMatch ? indentMatch[1] : '            ';
  const specIndent = baseIndent + '    ';
  const ci = specIndent + '    ';

  const specsXml = derivedSpecs.map(d =>
    `${specIndent}<derived-field-spec label="${escXml(d.label)}">\n` +
    `${ci}<name/>\n` +
    `${ci}<expression>${escXml(d.expression)}</expression>\n` +
    `${specIndent}</derived-field-spec>`
  ).join('\n');

  const replacement = `<derived-field-specs>\n${specsXml}\n${baseIndent}</derived-field-specs>`;

  // Replace empty derived-field-specs
  if (derivedEmpty) {
    xmlText = xmlText.replace(/<derived-field-specs\s*\/>/, replacement);
  } else {
    xmlText = xmlText.replace(/<derived-field-specs[^/]*>[\s\S]*?<\/derived-field-specs>/, replacement);
  }
  return xmlText;
}

/**
 * Detect date format from the YYYYMM source-field-spec's name.
 * Returns 'SLASH' | 'NOSLASH' | null
 */
function detectDateFormat(columns) {
  const yyyymmCol = columns.find(c => c.label === 'YYYYMM');
  if (!yyyymmCol) return null;
  return yyyymmCol.name.includes('/') ? 'SLASH' : 'NOSLASH';
}

/** Build #FY expression based on date format (April start) */
function buildFyExpression(format) {
  if (format === 'SLASH') {
    return 'if @numeric(@split(YYYYMM,"/",2)) <= 3 then "FY" & @text(@numeric(@left(YYYYMM,4))-1,"0000") else "FY" & @text(@left(YYYYMM,4),"0000") endif';
  }
  return 'if @mid(YYYYMM,5,2) <= "03" then "FY" & @text(@numeric(@left(YYYYMM,4))-1,"0000") else "FY" & @text(@left(YYYYMM,4),"0000") endif';
}

/** Build #PERIOD expression based on date format (April start) */
function buildPeriodExpression(format) {
  if (format === 'SLASH') {
    const m = '@numeric(@split(YYYYMM,"/",2))';
    return `if ${m} <= 3 then "M" & @text(${m} +9,"#0") else "M" & @text(${m} -3,"#0") endif`;
  }
  const m = '@numeric(@mid(YYYYMM,5,2))';
  return `if ${m} <= 3 then "M" & @text(${m} +9,"#0") else "M" & @text(${m} -3,"#0") endif`;
}

/** Escape special XML characters in attribute/text values */
function escXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

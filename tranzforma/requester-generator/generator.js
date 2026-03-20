// generator.js - Requester Wizard: bat / XML generation logic

/** Schema version → requester JAR version mapping */
const SCHEMA_TO_JAR = {
  'S135': '14.0.2',
};

/** Returns JAR version for a schema version, or null if unknown */
function jarVersion(schemaVersion) {
  return SCHEMA_TO_JAR[schemaVersion] || null;
}

/** Returns JAR filename with fallback wildcard */
function jarFilename(c) {
  const ver = jarVersion(c.schemaVersion);
  return ver ? `fusion_place-requester-${ver}.jar` : 'fusion_place-requester-*.jar';
}

/**
 * Parse POV textarea text into an array of {key, value} objects.
 * Each non-empty line should be "DIM_NAME MEMBER_NAME".
 * Lines starting with "//" are treated as comments and ignored.
 */
function parsePovText(text) {
  return (text || '').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//'))
    .map(l => {
      const sp = l.indexOf(' ');
      if (sp < 0) return null;
      return { key: l.substring(0, sp).trim(), value: l.substring(sp + 1).trim() };
    })
    .filter(p => p && p.key && p.value);
}

function genEnvBat(c) {
  const apl = (c && c.applicationName) ? c.applicationName : 'YOUR_APPLICATION';
  const url = c.serverType === 'SDX'
    ? 'http://ec2-3-114-169-70.ap-northeast-1.compute.amazonaws.com:50000/fusionplace'
    : 'http://localhost:50000/fusionplace';
  return `@echo off\r\nset URL=${url}\r\nset USER=admin\r\nset PW=admin\r\nset APL=${apl}\r\n`;
}

/**
 * Generate <contents> block for each request type.
 */
function genContents(reqType) {
  switch (reqType) {
    case 'EXPORT_VALUES':
      return `    <contents>\n      returned-contents-file=csv/output.csv\n    </contents>\n`;
    case 'IMPORT_VALUES':
      return `    <contents>\n      request-contents-file=src/input.csv\n      returned-contents-file=logs/imp_log.csv\n    </contents>\n`;
    case 'UPDATE_DIMENSION':
    case 'IMPORT_TRANSLATION_TABLE':
      return `    <contents>\n      request-contents-file=src/input.csv\n    </contents>\n`;
    case 'BACKUP_APPLICATION':
      return `    <contents>\n      returned-contents-file=response/backup.fpbackup, hex2bin\n    </contents>\n`;
    case 'CALCULATE_BY_FORM':
    case 'EXPORT_DIMENSION':
    case 'RUN_SCRIPT':
    default:
      return `    <contents></contents>\n`;
  }
}

function genRequestXml(c) {
  const apl = '%APL%';
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<requests>\n`;

  // Helper: emit loop dim POV parameters
  const loopDimPovs = (indent) => (c.loopDims || []).map(d => {
    const varName = d.dim.replace(/^#/, '');
    return `${indent}<parameter name="POV" key="${d.dim}" value="%${varName}%"/>\n`;
  }).join('');

  if (c.reqType === 'EXPORT_VALUES') {
    xml += `  <request type="EXPORT_VALUES" desc="Export ${c.pForm || 'FORM_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="FORM" value="${c.pForm || 'FORM_LABEL'}"/>\n`;
    xml += `      <parameter name="PARTICIPANT" value="${c.pParticipant || 'ADMIN'}"/>\n`;
    for (const pov of (c.formPovDims || [])) {
      const varName = pov.dim.replace(/^#/, '');
      xml += `      <parameter name="POV" key="${pov.dim}" value="%${varName}%"/>\n`;
    }
    xml += loopDimPovs('      ');
    if (c.exportFormat !== 'omit')     xml += `      <parameter name="FORMAT" value="${c.exportFormat}"/>\n`;
    if (c.exportNewline !== 'omit')    xml += `      <parameter name="NEWLINE_STYLE" value="${c.exportNewline}"/>\n`;
    if (c.exportQuoteStyle !== 'omit') xml += `      <parameter name="QUOTE_STYLE" value="${c.exportQuoteStyle}"/>\n`;
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'IMPORT_VALUES') {
    xml += `  <request type="IMPORT_VALUES" desc="Import ${c.pForm || 'FORM_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="FORM" value="${c.pForm || 'FORM_LABEL'}"/>\n`;
    xml += `      <parameter name="PARTICIPANT" value="${c.pParticipant || 'ADMIN'}"/>\n`;
    for (const pov of (c.formPovDims || [])) {
      const varName = pov.dim.replace(/^#/, '');
      xml += `      <parameter name="POV" key="${pov.dim}" value="%${varName}%"/>\n`;
    }
    xml += loopDimPovs('      ');
    if (c.importFormat !== 'omit')   xml += `      <parameter name="FORMAT" value="${c.importFormat}"/>\n`;
    if (c.importNewline !== 'omit')  xml += `      <parameter name="NEWLINE_STYLE" value="${c.importNewline}"/>\n`;
    if (c.importSeverity !== 'omit') xml += `      <parameter name="MIN_SEVERITY" value="${c.importSeverity}"/>\n`;
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'CALCULATE_BY_FORM') {
    xml += `  <request type="CALCULATE_BY_FORM" desc="Calculate ${c.pForm || 'FORM_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="FORM" value="${c.pForm || 'FORM_LABEL'}"/>\n`;
    xml += `      <parameter name="PARTICIPANT" value="${c.pParticipant || '#NONE'}"/>\n`;
    for (const pov of (c.formPovDims || [])) {
      const varName = pov.dim.replace(/^#/, '');
      xml += `      <parameter name="POV" key="${pov.dim}" value="%${varName}%"/>\n`;
    }
    xml += loopDimPovs('      ');
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'UPDATE_DIMENSION') {
    xml += `  <request type="UPDATE_DIMENSION" desc="Update dimension ${c.pDimension || 'DIM_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="DIMENSION" value="${c.pDimension || 'DIM_LABEL'}"/>\n`;
    xml += `      <parameter name="ROLE" value="${c.pDimRole}"/>\n`;
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'EXPORT_DIMENSION') {
    xml += `  <request type="EXPORT_DIMENSION" desc="Export dimension ${c.pDimension || 'DIM_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="DIMENSION" value="${c.pDimension || 'DIM_LABEL'}"/>\n`;
    if (c.exportDimFmtVer !== 'omit') xml += `      <parameter name="FORMAT_VERSION" value="${c.exportDimFmtVer}"/>\n`;
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'IMPORT_TRANSLATION_TABLE') {
    xml += `  <request type="IMPORT_TRANSLATION_TABLE" desc="Import translation table ${c.pTT || ''}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="TRANSLATION_TABLE" value="${c.pTT || 'TABLE_LABEL'}"/>\n`;
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'RUN_SCRIPT') {
    xml += `  <request type="RUN_SCRIPT" desc="Run script ${c.pScript || 'SCRIPT_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="SCRIPT" value="${c.pScript || 'SCRIPT_LABEL'}"/>\n`;
    xml += `      <parameter name="PARTICIPANT" value="${c.pScriptParticipant || 'ADMIN'}"/>\n`;
    xml += loopDimPovs('      ');
    for (const p of parsePovText(c.scriptPovText)) {
      xml += `      <parameter name="POV" key="${p.key}" value="${p.value}"/>\n`;
    }
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'BACKUP_APPLICATION') {
    xml += `  <request type="BACKUP_APPLICATION" desc="Backup application">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;
  }

  xml += `</requests>\n`;
  return xml;
}

function genRunBat(c) {
  const isInteractive  = c.execMode === 'interactive';
  const isFull         = c.errLevel === 'full';
  const isExport       = c.reqType === 'EXPORT_VALUES';
  const isImportValues = c.reqType === 'IMPORT_VALUES';
  const isImport       = ['IMPORT_VALUES', 'UPDATE_DIMENSION', 'IMPORT_TRANSLATION_TABLE'].includes(c.reqType);

  const loopDims = c.loopDims || [];
  const hasDim1  = loopDims.length >= 1;
  const hasDim2  = loopDims.length >= 2;
  const dim1     = hasDim1 ? loopDims[0] : null;
  const dim2     = hasDim2 ? loopDims[1] : null;
  const dim1Var  = dim1 ? dim1.dim.replace(/^#/, '') : '';
  const dim2Var  = dim2 ? dim2.dim.replace(/^#/, '') : '';

  let b = `@echo off\r\ncd /d %~dp0\r\nsetlocal enabledelayedexpansion\r\n\r\n`;

  b += `Call ..\\env.bat\r\n\r\n`;

  // Confirmation (interactive mode)
  if (isInteractive) {
    b += `rem --- Confirm settings ---\r\n`;
    b += `echo.\r\n`;
    b += `echo ========================================\r\n`;
    b += `echo   URL  : %URL%\r\n`;
    b += `echo   USER : %USER%\r\n`;
    b += `echo   APL  : %APL%\r\n`;
    b += `echo ========================================\r\n`;
    b += `set /p CONFIRM=Run with these settings? [y/n]: \r\n`;
    b += `if /i not "%CONFIRM%"=="y" (\r\n`;
    b += `  echo Cancelled.\r\n`;
    b += `  pause\r\n`;
    b += `  exit /b 0\r\n`;
    b += `)\r\n`;
    b += `echo.\r\n\r\n`;
  }

  // IMPORT_VALUES without loop: pre-run source file check
  if (isImportValues && !hasDim1) {
    b += `rem --- Check source file ---\r\n`;
    b += `if not exist "src\\input.csv" (\r\n`;
    b += `  echo ERROR: src\\input.csv not found.\r\n`;
    if (isInteractive) b += `  pause\r\n`;
    b += `  exit /b 1\r\n)\r\n\r\n`;
  }

  // POV variable setup (form-based types)
  const isFormBased = ['EXPORT_VALUES', 'IMPORT_VALUES', 'CALCULATE_BY_FORM'].includes(c.reqType);
  const hasPov = isFormBased && c.formPovDims && c.formPovDims.length > 0;
  if (hasPov) {
    b += `rem --- POV parameters ---\r\n`;
    for (const pov of c.formPovDims) {
      const varName = pov.dim.replace(/^#/, '');
      if (pov.mode === 'fixed') {
        b += `set ${varName}=${pov.value}\r\n`;
      } else {
        b += `set /p ${varName}=${pov.dim} value: \r\n`;
      }
    }
    b += `\r\n`;
  }

  // Summary log setup
  if (isFull) {
    b += `rem --- Summary log setup ---\r\n`;
    b += `for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set d=%%a%%b%%c%%d\r\n`;
    b += `for /f "tokens=1-2 delims=: " %%a in ('time /t') do set t=%%a%%b\r\n`;
    b += `set SUMMARY_LOG=logs\\summary_%d%%t%.log\r\n`;
    b += `echo Run Summary Log > "%SUMMARY_LOG%"\r\n`;
    b += `echo ======================================== >> "%SUMMARY_LOG%"\r\n\r\n`;
    b += `set ERR_COUNT=0\r\nset OK_COUNT=0\r\n\r\n`;
  }

  const jar = jarFilename(c);

  if (hasDim1) {
    // Loop dim value definitions
    b += `rem --- Loop dimension values ---\r\n`;
    b += `set DIM1_VALUES=${dim1.values}\r\n`;
    if (hasDim2) b += `set DIM2_VALUES=${dim2.values}\r\n`;
    b += `\r\n`;

    b += `rem --- Main loop ---\r\n`;
    b += `for %%A in (%DIM1_VALUES%) do (\r\n`;
    b += `  set ${dim1Var}=%%A\r\n`;
    if (hasDim2) {
      b += `  for %%B in (%DIM2_VALUES%) do (\r\n`;
      b += `    set ${dim2Var}=%%B\r\n`;
      b += genLoopBody(c, '    ', '[%%A][%%B]', 'logs/response_%%A_%%B.xml', '%%A_%%B', jar, isExport, isImportValues, isFull);
      b += `  )\r\n`;
    } else {
      b += genLoopBody(c, '  ', '[%%A]', 'logs/response_%%A.xml', '%%A', jar, isExport, isImportValues, isFull);
    }
    b += `)\r\n\r\n`;

  } else {
    // Single execution (no loop)
    b += `echo Processing...\r\n\r\n`;
    b += `java -Xms4096m -Xmx8192m -jar ..\\${jar} ^\r\n`;
    b += `  -url %URL% -user %USER% -pass %PW% ^\r\n`;
    const respOut = isImportValues ? 'response/response.xml' : 'logs/response.xml';
    b += `  -external true < request.xml > ${respOut} 2>nul\r\n`;
    b += `set RC=%ERRORLEVEL%\r\n\r\n`;
    b += genRcCheckSimple(c, '', isFull, isImportValues);
  }

  // Footer
  if (isFull) {
    b += `echo ========================================\r\necho All done.\r\n`;
    b += `echo   OK:      %OK_COUNT%\r\necho   ISSUES:  %ERR_COUNT%\r\necho ========================================\r\n`;
    b += `echo ======================================== >> "%SUMMARY_LOG%"\r\n`;
    b += `echo All done.  OK: %OK_COUNT%  ISSUES: %ERR_COUNT% >> "%SUMMARY_LOG%"\r\n\r\n`;
    b += `if %ERR_COUNT% GTR 0 (\r\n  echo.\r\n  echo --- WARNING list (see also: %SUMMARY_LOG%) ---\r\n  findstr /i "WARNING" "%SUMMARY_LOG%"\r\n  echo ---\r\n)\r\necho Summary log: %SUMMARY_LOG%\r\n`;
  } else {
    b += `echo Done.\r\n`;
  }

  if (isInteractive) b += `pause\r\n`;
  b += `endlocal\r\n`;
  return b;
}

function genLoopBody(c, indent, label, respFile, csvSuffix, jar, isExport, isImportValues, isFull) {
  let b = '';
  b += `${indent}echo   ${label} Processing...\r\n`;

  if (isImportValues) {
    const ei = indent + '  ';
    b += `${indent}if exist "src\\${csvSuffix}.csv" (\r\n`;
    b += `${ei}copy /y "src\\${csvSuffix}.csv" "src\\input.csv" >nul\r\n`;
    b += `${ei}java -Xms4096m -Xmx8192m -jar ..\\${jar} ^\r\n`;
    b += `${ei}  -url %URL% -user %USER% -pass %PW% ^\r\n`;
    b += `${ei}  -external true < request.xml > ${respFile} 2>nul\r\n`;
    b += `${ei}set RC=!ERRORLEVEL!\r\n`;
    b += genRcCheckLoop(isFull, ei, label, csvSuffix, isExport);
    b += `${indent}) else (\r\n`;
    b += `${indent}  echo   ${label} SKIP: src\\${csvSuffix}.csv not found\r\n`;
    if (isFull) b += `${indent}  echo INFO:    ${label} src\\${csvSuffix}.csv not found >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent})\r\n`;
  } else {
    b += `${indent}java -Xms4096m -Xmx8192m -jar ..\\${jar} ^\r\n`;
    b += `${indent}  -url %URL% -user %USER% -pass %PW% ^\r\n`;
    b += `${indent}  -external true < request.xml > ${respFile} 2>nul\r\n`;
    b += `${indent}set RC=!ERRORLEVEL!\r\n`;
    b += genRcCheckLoop(isFull, indent, label, csvSuffix, isExport);
  }

  return b;
}

function genRcCheckLoop(isFull, indent, label, csvSuffix, isExport) {
  let b = '';
  if (isFull) {
    b += `${indent}if !RC! EQU 1 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   ${label} WARNING: RC=1\r\n`;
    b += `${indent}  echo WARNING: ${label} RC=1 >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else if !RC! EQU 2 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   ${label} ERROR: RC=2\r\n`;
    b += `${indent}  echo ERROR:   ${label} RC=2 >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else if !RC! EQU 4 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   ${label} FAILED: RC=4\r\n`;
    b += `${indent}  echo FAILED:  ${label} RC=4 >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else if !RC! EQU 8 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   ${label} ABORTED: RC=8\r\n`;
    b += `${indent}  echo ABORTED: ${label} RC=8 >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else if !RC! NEQ 0 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   ${label} WARNING: unknown RC=!RC!\r\n`;
    b += `${indent}  echo WARNING: ${label} unknown RC=!RC! >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else (\r\n`;
    if (isExport) {
      b += `${indent}  if exist csv\\output.csv (\r\n`;
      b += `${indent}    for %%F in (csv\\output.csv) do set csvSize=%%~zF\r\n`;
      b += `${indent}    if !csvSize! LEQ 1 (\r\n`;
      b += `${indent}      del csv\\output.csv\r\n`;
      b += `${indent}      echo   ${label} INFO: output.csv is empty, skipped\r\n`;
      b += `${indent}      echo INFO:    ${label} output.csv was empty >> "%SUMMARY_LOG%"\r\n`;
      b += `${indent}    ) else (\r\n`;
      b += `${indent}      ren csv\\output.csv ${csvSuffix}.csv\r\n`;
      b += `${indent}      set /a OK_COUNT+=1\r\n`;
      b += `${indent}      echo   ${label} Done -^> csv\\${csvSuffix}.csv\r\n`;
      b += `${indent}      echo OK:      ${label} csv\\${csvSuffix}.csv >> "%SUMMARY_LOG%"\r\n`;
      b += `${indent}    )\r\n`;
      b += `${indent}  ) else (\r\n`;
      b += `${indent}    set /a ERR_COUNT+=1\r\n`;
      b += `${indent}    echo   ${label} WARNING: output.csv not found\r\n`;
      b += `${indent}    echo WARNING: ${label} output.csv not found >> "%SUMMARY_LOG%"\r\n`;
      b += `${indent}  )\r\n`;
    } else {
      b += `${indent}  set /a OK_COUNT+=1\r\n`;
      b += `${indent}  echo   ${label} Done\r\n`;
      b += `${indent}  echo OK:      ${label} >> "%SUMMARY_LOG%"\r\n`;
    }
    b += `${indent})\r\n`;
  } else {
    b += `${indent}if !RC! NEQ 0 (\r\n`;
    b += `${indent}  echo   ${label} ERROR: RC=!RC!\r\n`;
    b += `${indent}) else (\r\n`;
    if (isExport) {
      b += `${indent}  if exist csv\\output.csv ren csv\\output.csv ${csvSuffix}.csv\r\n`;
    }
    b += `${indent}  echo   ${label} Done\r\n`;
    b += `${indent})\r\n`;
  }
  return b;
}

function genRcCheckSimple(c, indent, isFull, isImportValues) {
  let b = '';
  if (isFull) {
    b += `if %RC% NEQ 0 (\r\n  set /a ERR_COUNT+=1\r\n  echo ERROR: RC=%RC%\r\n  echo ERROR: RC=%RC% >> "%SUMMARY_LOG%"\r\n) else (\r\n  set /a OK_COUNT+=1\r\n  echo Done.\r\n  echo OK >> "%SUMMARY_LOG%"\r\n`;
    if (isImportValues) {
      b += `  if exist "logs\\imp_log.csv" ren "logs\\imp_log.csv" "log_%d%%t%.csv"\r\n`;
    }
    b += `)\r\n\r\n`;
  } else {
    if (isImportValues) {
      b += `if %RC% NEQ 0 (\r\n  echo ERROR: RC=%RC%\r\n) else (\r\n  echo Done.\r\n  if exist "logs\\imp_log.csv" ren "logs\\imp_log.csv" "log.csv"\r\n)\r\n\r\n`;
    } else {
      b += `if %RC% NEQ 0 (echo ERROR: RC=%RC%) else (echo Done.)\r\n\r\n`;
    }
  }
  return b;
}

function genReadme(c) {
  return `Requester Setup
===============

1. Download and place the JAR file:
   ${jarFilename(c)}
   -> Place it in this folder (Requester/)

2. Edit env.bat with your connection settings:
   URL, USER, PW, APL

3. Edit process/request.xml as needed.

4. Run process/run.bat

`;
}

// generator.js - Requester Wizard: bat / XML generation logic

function genEnvBat(c) {
  const apl = (c && c.applicationName) ? c.applicationName : 'YOUR_APPLICATION';
  const url = c.serverType === 'SDX'
    ? 'http://ec2-3-114-169-70.ap-northeast-1.compute.amazonaws.com:50000/fusionplace'
    : 'http://localhost:50000/fusionplace';
  return `@echo off\r\nset URL=${url}\r\nset USER=admin\r\nset PW=admin\r\nset APL=${apl}\r\n`;
}

/**
 * Generate <contents> block for each request type.
 * Edit this function to change contents per request type.
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
    case 'CALCULATE_BY_FORM':
    case 'EXPORT_DIMENSION':
    case 'RUN_SCRIPT':
    case 'BACKUP_APPLICATION':
    default:
      return `    <contents></contents>\n`;
  }
}

function genRequestXml(c) {
  const apl = '%APL%';
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<requests>\n`;

  if (c.reqType === 'EXPORT_VALUES') {
    xml += `  <request type="EXPORT_VALUES" desc="Export ${c.pForm || 'FORM_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="FORM" value="${c.pForm || 'FORM_LABEL'}"/>\n`;
    xml += `      <parameter name="PARTICIPANT" value="${c.pParticipant || 'ADMIN'}"/>\n`;
    if (c.monthLoop === 'yes') {
      xml += `      <parameter name="POV" key="#FY" value="%FY%"/>\n`;
      xml += `      <parameter name="POV" key="#PERIOD" value="%PERIOD%"/>\n`;
    }
    if (c.loopScenario) xml += `      <parameter name="POV" key="SCENARIO" value="%SCENARIO%"/>\n`;
    if (c.loopSbu)      xml += `      <parameter name="POV" key="SBU" value="%SBU%"/>\n`;
    xml += `      <!-- TODO: Add more POV parameters as needed -->\n`;
    xml += `      <parameter name="FORMAT" value="csv"/>\n`;
    xml += `      <parameter name="NEWLINE_STYLE" value="crlf"/>\n`;
    xml += `      <parameter name="QUOTE_STYLE" value="always"/>\n`;
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'IMPORT_VALUES') {
    xml += `  <request type="IMPORT_VALUES" desc="Import ${c.pForm || 'FORM_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="FORM" value="${c.pForm || 'FORM_LABEL'}"/>\n`;
    xml += `      <parameter name="PARTICIPANT" value="${c.pParticipant || 'ADMIN'}"/>\n`;
    for (const pov of (c.importPovDims || [])) {
      const varName = pov.dim.replace(/^#/, '');
      xml += `      <parameter name="POV" key="${pov.dim}" value="%${varName}%"/>\n`;
    }
    xml += `      <parameter name="FORMAT" value="${c.importFormat || 'csv'}"/>\n`;
    xml += `      <parameter name="NEWLINE_STYLE" value="${c.importNewline || 'lf'}"/>\n`;
    if ((c.importSeverity || 'INFO') !== 'ALL') {
      xml += `      <parameter name="MIN_SEVERITY" value="${c.importSeverity}"/>\n`;
    }
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'CALCULATE_BY_FORM') {
    xml += `  <request type="CALCULATE_BY_FORM" desc="Calculate ${c.pForm || 'FORM_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="FORM" value="${c.pForm || 'FORM_LABEL'}"/>\n`;
    xml += `      <parameter name="PARTICIPANT" value="${c.pParticipant || '#NONE'}"/>\n`;
    if (c.monthLoop === 'yes') {
      xml += `      <parameter name="POV" key="#FY" value="%FY%"/>\n`;
      xml += `      <parameter name="POV" key="#PERIOD" value="%PERIOD%"/>\n`;
    }
    xml += `      <!-- TODO: Add more POV parameters as needed -->\n`;
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
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'IMPORT_TRANSLATION_TABLE') {
    xml += `  <request type="IMPORT_TRANSLATION_TABLE" desc="Import translation table">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <!-- TODO: Add TABLE and other parameters as needed -->\n`;
    xml += `    </parameters>\n`;
    xml += genContents(c.reqType);
    xml += `  </request>\n`;

  } else if (c.reqType === 'RUN_SCRIPT') {
    xml += `  <request type="RUN_SCRIPT" desc="Run script ${c.pScript || 'SCRIPT_LABEL'}">\n`;
    xml += `    <parameters>\n`;
    xml += `      <parameter name="APPLICATION" value="${apl}"/>\n`;
    xml += `      <parameter name="SCRIPT" value="${c.pScript || 'SCRIPT_LABEL'}"/>\n`;
    if (c.monthLoop === 'yes') {
      xml += `      <parameter name="POV" key="#FY" value="%FY%"/>\n`;
      xml += `      <parameter name="POV" key="#PERIOD" value="%PERIOD%"/>\n`;
    }
    xml += `      <!-- TODO: Add more POV parameters as needed -->\n`;
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
  let hasMonthLoop     = c.monthLoop === 'yes';
  let hasScenario      = hasMonthLoop && c.loopScenario && c.scenarioList;
  let hasSbu           = hasMonthLoop && c.loopSbu && c.sbuList;
  const isFull         = c.errLevel === 'full';
  const isExport       = c.reqType === 'EXPORT_VALUES';
  const isImportValues = c.reqType === 'IMPORT_VALUES';
  const isImport       = ['IMPORT_VALUES', 'UPDATE_DIMENSION', 'IMPORT_TRANSLATION_TABLE'].includes(c.reqType);

  // IMPORT_VALUES: loop not supported in this version
  if (isImportValues) { hasMonthLoop = false; hasScenario = false; hasSbu = false; }

  let b = `@echo off\r\ncd /d %~dp0\r\nsetlocal enabledelayedexpansion\r\n\r\n`;

  // Connection info (always env.bat in this version)
  b += `Call ..\\env.bat\r\n\r\n`;

  // Confirmation (interactive mode only)
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

  // IMPORT_VALUES: pre-run source file check + POV variable setup
  if (isImportValues) {
    b += `rem --- Check source file ---\r\n`;
    b += `if not exist "src\\input.csv" (\r\n`;
    b += `  echo ERROR: src\\input.csv not found.\r\n`;
    if (isInteractive) b += `  pause\r\n`;
    b += `  exit /b 1\r\n)\r\n\r\n`;

    const hasPov = c.importPovDims && c.importPovDims.length > 0;
    if (hasPov) {
      b += `rem --- POV parameters ---\r\n`;
      for (const pov of c.importPovDims) {
        const varName = pov.dim.replace(/^#/, '');
        if (pov.mode === 'fixed') {
          b += `set ${varName}=${pov.value}\r\n`;
        } else {
          b += `set /p ${varName}=${pov.dim} value: \r\n`;
        }
      }
      b += `\r\n`;
    }
  }

  // Month range input
  if (hasMonthLoop) {
    if (isInteractive) {
      b += `rem --- Start year/month input ---\r\n`;
      b += `set /p startYM=Start year/month (e.g. 202501):\r\n`;
      b += `if "%startYM%"=="" (\r\n  echo ERROR: No input\r\n  pause\r\n  exit /b 1\r\n)\r\n\r\n`;
      b += `rem --- End year/month input (Enter = same as start) ---\r\n`;
      b += `echo End year/month (press Enter to use same as start: %startYM%):\r\n`;
      b += `set /p endYM=\r\n`;
      b += `if "%endYM%"=="" set endYM=%startYM%\r\n\r\n`;
      b += `echo Start: %startYM%  End: %endYM%\r\n\r\n`;
    }
  }

  // Summary log
  if (isFull) {
    b += `rem --- Summary log setup ---\r\n`;
    b += `for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set d=%%a%%b%%c%%d\r\n`;
    b += `for /f "tokens=1-2 delims=: " %%a in ('time /t') do set t=%%a%%b\r\n`;
    if (hasMonthLoop) {
      b += `set SUMMARY_LOG=logs\\summary_%startYM%-%endYM%_%d%%t%.log\r\n`;
      b += `echo Run Summary Log > "%SUMMARY_LOG%"\r\n`;
      b += `echo Start: %startYM%  End: %endYM% >> "%SUMMARY_LOG%"\r\n`;
    } else {
      b += `set SUMMARY_LOG=logs\\summary_%d%%t%.log\r\n`;
      b += `echo Run Summary Log > "%SUMMARY_LOG%"\r\n`;
    }
    b += `echo ======================================== >> "%SUMMARY_LOG%"\r\n\r\n`;
    b += `set ERR_COUNT=0\r\nset OK_COUNT=0\r\n\r\n`;
  }

  // Scenario / SBU lists
  if (hasScenario) b += `rem --- Scenario list ---\r\nset SCENARIOS=${c.scenarioList}\r\n\r\n`;
  if (hasSbu)      b += `rem --- SBU list ---\r\nset SBUS=${c.sbuList}\r\n\r\n`;

  // Main loop or single execution
  if (hasMonthLoop) {
    b += `rem --- Main loop ---\r\nset currentYM=%startYM%\r\n\r\n`;
    b += `:loop\r\n`;
    b += `set yearStr=!currentYM:~0,4!\r\nset monthStr=!currentYM:~4,2!\r\n`;
    b += `set /a monthNum=1!monthStr! - 100\r\nset /a yearNum=!yearStr!\r\n\r\n`;
    b += `if !monthNum! LSS 10 (set PERIOD=M0!monthNum!) else (set PERIOD=M!monthNum!)\r\n\r\n`;
    b += `if !monthNum! GEQ 4 (\r\n  set /a fyYear=!yearNum!\r\n) else (\r\n  set /a fyYear=!yearNum! - 1\r\n)\r\n`;
    b += `set fyYearStr=!fyYear!\r\nset FY=FY!fyYearStr:~-2!\r\n\r\n`;
    b += `echo ----------------------------------------\r\necho FY=!FY!    PERIOD=!PERIOD!\r\necho ----------------------------------------\r\n\r\n`;

    const innerOpen  = (hasScenario ? `for %%C in (%SCENARIOS%) do (\r\n  set SCENARIO=%%C\r\n` : '')
                     + (hasSbu      ? `  for %%S in (%SBUS%) do (\r\n  set SBU=%%S\r\n` : '');
    const innerClose = (hasSbu      ? `  )\r\n` : '')
                     + (hasScenario ? `)\r\n` : '');
    const indent = hasScenario || hasSbu ? '  ' : '';

    if (innerOpen) b += innerOpen;

    let label = '!FY![!PERIOD!]';
    if (hasScenario) label += '[%%C]';
    if (hasSbu)      label += '[%%S]';

    let respFile = 'logs/response_!currentYM!';
    if (hasScenario) respFile += '_%%C';
    if (hasSbu)      respFile += '_%%S';
    respFile += '.xml';

    b += `${indent}echo   [${label}] Processing...\r\n\r\n`;
    b += `${indent}java -Xms4096m -Xmx8192m -jar ../fusion_place-requester-14.0.2.jar ^\r\n`;
    b += `${indent}  -url %URL% -user %USER% -pass %PW% ^\r\n`;
    b += `${indent}  -external true < request.xml > ${respFile} 2>nul\r\n`;
    b += `${indent}set RC=!ERRORLEVEL!\r\n\r\n`;

    b += genRcCheck(c, indent, label, respFile, isExport, isImport, isFull, hasScenario, hasSbu);

    if (innerClose) b += innerClose;

    b += `\r\nrem --- Increment month ---\r\n`;
    b += `set /a nextMonth=!monthNum! + 1\r\nset /a nextYear=!yearNum!\r\n`;
    b += `if !nextMonth! GTR 12 (\r\n  set /a nextMonth=1\r\n  set /a nextYear+=1\r\n)\r\n`;
    b += `if !nextMonth! LSS 10 (set nextMonthStr=0!nextMonth!) else (set nextMonthStr=!nextMonth!)\r\n`;
    b += `set currentYM=!nextYear!!nextMonthStr!\r\n\r\n`;
    b += `if !currentYM! LEQ %endYM% goto loop\r\n\r\n`;

  } else {
    b += `echo Processing...\r\n\r\n`;
    b += `java -Xms4096m -Xmx8192m -jar ../fusion_place-requester-14.0.2.jar ^\r\n`;
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

function genRcCheck(c, indent, label, respFile, isExport, isImport, isFull, hasScenario, hasSbu) {
  let b = '';
  let csvSuffix = '!currentYM!';
  if (hasScenario) csvSuffix += '_%%C';
  if (hasSbu)      csvSuffix += '_%%S';

  if (isFull) {
    b += `${indent}if !RC! EQU 1 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   [${label}] WARNING: requester returned RC=1\r\n`;
    b += `${indent}  echo WARNING: [${label}] requester RC=1 >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else if !RC! EQU 2 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   [${label}] ERROR: requester returned RC=2\r\n`;
    b += `${indent}  echo ERROR:   [${label}] requester RC=2 >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else if !RC! EQU 4 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   [${label}] FAILED: requester returned RC=4\r\n`;
    b += `${indent}  echo FAILED:  [${label}] requester RC=4 >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else if !RC! EQU 8 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   [${label}] ABORTED: requester returned RC=8\r\n`;
    b += `${indent}  echo ABORTED: [${label}] requester RC=8 >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else if !RC! NEQ 0 (\r\n`;
    b += `${indent}  set /a ERR_COUNT+=1\r\n`;
    b += `${indent}  echo   [${label}] WARNING: requester returned unknown RC=!RC!\r\n`;
    b += `${indent}  echo WARNING: [${label}] requester unknown RC=!RC! >> "%SUMMARY_LOG%"\r\n`;
    b += `${indent}) else (\r\n`;

    if (isExport) {
      b += `${indent}  if exist csv\\output.csv (\r\n`;
      b += `${indent}    for %%F in (csv\\output.csv) do set csvSize=%%~zF\r\n`;
      b += `${indent}    if !csvSize! LEQ 1 (\r\n`;
      b += `${indent}      del csv\\output.csv\r\n`;
      b += `${indent}      echo   [${label}] INFO: output.csv is empty, skipped\r\n`;
      b += `${indent}      echo INFO:    [${label}] output.csv was empty >> "%SUMMARY_LOG%"\r\n`;
      b += `${indent}    ) else (\r\n`;
      b += `${indent}      ren csv\\output.csv ${csvSuffix}.csv\r\n`;
      b += `${indent}      set /a OK_COUNT+=1\r\n`;
      b += `${indent}      echo   [${label}] Done -^> csv\\${csvSuffix}.csv\r\n`;
      b += `${indent}      echo OK:      [${label}] csv\\${csvSuffix}.csv >> "%SUMMARY_LOG%"\r\n`;
      b += `${indent}    )\r\n`;
      b += `${indent}  ) else (\r\n`;
      b += `${indent}    set /a ERR_COUNT+=1\r\n`;
      b += `${indent}    echo   [${label}] WARNING: output.csv not found\r\n`;
      b += `${indent}    echo WARNING: [${label}] output.csv not found >> "%SUMMARY_LOG%"\r\n`;
      b += `${indent}  )\r\n`;
    } else {
      b += `${indent}  set /a OK_COUNT+=1\r\n`;
      b += `${indent}  echo   [${label}] Done\r\n`;
      b += `${indent}  echo OK:      [${label}] >> "%SUMMARY_LOG%"\r\n`;
    }

    b += `${indent})\r\n\r\n`;
  } else {
    b += `${indent}if !RC! NEQ 0 (\r\n`;
    b += `${indent}  echo   [${label}] ERROR: RC=!RC!\r\n`;
    b += `${indent}) else (\r\n`;
    if (isExport) {
      b += `${indent}  if exist csv\\output.csv ren csv\\output.csv ${csvSuffix}.csv\r\n`;
    }
    b += `${indent}  echo   [${label}] Done\r\n`;
    b += `${indent})\r\n\r\n`;
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

function genReadme() {
  return `Requester Setup
===============

1. Download and place the JAR file:
   fusion_place-requester-14.0.2.jar
   -> Place it in this folder (Requester/)

2. Edit env.bat with your connection settings:
   URL, USER, PW, APL

3. Edit process/request.xml as needed.

4. Run process/run.bat

`;
}

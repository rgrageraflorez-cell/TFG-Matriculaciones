@echo off
REM ============================================================
REM  PIPELINE DE ACTUALIZACION DEL DASHBOARD
REM  TFG - Analisis de la demanda automovilistica en Espana
REM
REM  Uso:
REM    run_update.bat            -> flujo completo
REM    run_update.bat --force    -> forzar aunque no haya cambios
REM    run_update.bat --skip-r   -> solo rebuild (R ya ejecutado)
REM    run_update.bat --check    -> solo comprobar datos nuevos
REM    run_update.bat --skip-dl  -> saltar descarga DGT
REM ============================================================

setlocal EnableDelayedExpansion

REM ── Rutas ──
set "SCRIPT_DIR=%~dp0"
set "BASE_DIR=%SCRIPT_DIR%.."
set "DATA_DIR=%BASE_DIR%\..\Filtrado de datos\Dataset\Matriculaciones ES"
set "PUBLIC_DIR=%BASE_DIR%\Datasets web\Web dashboard\public"
set "WEB_DIR=%BASE_DIR%\Datasets web\Web dashboard"
set "SCRIPTS_DIR=%BASE_DIR%\Datasets web\Web dashboard\scripts"
set "PIPELINE_R=%SCRIPT_DIR%update_pipeline.R"
set "MD_DIARIO_R=%SCRIPT_DIR%export_md_diario.R"
set "PROPHET_R=%SCRIPT_DIR%export_prophet.R"
set "MARCA_PROV_R=%SCRIPT_DIR%export_marca_provincia.R"
set "DOWNLOAD_PY=%SCRIPT_DIR%download_dgt.py"
set "ALERT_PY=%SCRIPTS_DIR%\alert_engine.py"
set "REPORT_PY=%SCRIPTS_DIR%\monthly_report.py"
set "TIMESTAMP=%SCRIPT_DIR%.last_update"

REM ── Rscript: buscar en PATH y en instalaciones conocidas ──
set "RSCRIPT="
where Rscript >nul 2>&1 && set "RSCRIPT=Rscript"
if not defined RSCRIPT (
  if exist "C:\Program Files\R\R-4.3.1\bin\Rscript.exe" (
    set "RSCRIPT=C:\Program Files\R\R-4.3.1\bin\Rscript.exe"
  ) else if exist "C:\Program Files\R\R-4.2.2\bin\Rscript.exe" (
    set "RSCRIPT=C:\Program Files\R\R-4.2.2\bin\Rscript.exe"
  ) else (
    for /d %%v in ("C:\Program Files\R\R-*") do (
      if exist "%%v\bin\Rscript.exe" set "RSCRIPT=%%v\bin\Rscript.exe"
    )
  )
)
if not defined RSCRIPT (
  echo ERROR: No se encontro Rscript. Instala R o añade al PATH.
  exit /b 1
)

REM ── npm: preferir ruta completa de npm.cmd (call lo necesita) ──
set "NPM="
if exist "C:\Program Files\nodejs\npm.cmd" (
  set "NPM=C:\Program Files\nodejs\npm.cmd"
) else (
  for /f "delims=" %%p in ('where npm.cmd 2^>nul') do if not defined NPM set "NPM=%%p"
)
if not defined NPM (
  echo ERROR: No se encontro npm.cmd. Instala Node.js.
  exit /b 1
)

REM ── python: py launcher > python.exe ──
set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo AVISO: No se encontro Python. La descarga DGT se saltara.
)

echo ========================================
echo PIPELINE DE ACTUALIZACION DEL DASHBOARD
echo %date% %time%
echo ========================================
echo Rscript: %RSCRIPT%
echo npm:     %NPM%
echo.

REM ── Argumentos ──
set "ARG=%~1"

if "%ARG%"=="--check" goto :check_only
if "%ARG%"=="--skip-r" goto :skip_r
if "%ARG%"=="--skip-dl" (
  set "SKIP_DL=1"
  shift
  set "ARG=%~1"
)
goto :full_run

REM ============================================================
:check_only
echo [CHECK] Comprobando si hay datos nuevos...
call :check_new_data
if !NEW_DATA!==1 (
  echo  -> Hay ficheros nuevos para procesar.
  exit /b 0
) else (
  echo  -> No hay ficheros nuevos.
  exit /b 1
)

REM ============================================================
:skip_r
echo [SKIP-R] Saltando pipeline R. Solo rebuild web.
call :verify_csvs
call :rebuild_dashboard
call :save_timestamp
goto :done

REM ============================================================
:full_run
if not "%SKIP_DL%"=="1" (
  call :download_dgt
)

call :check_new_data
if !NEW_DATA!==0 (
  if not "%ARG%"=="--force" (
    echo No hay datos nuevos. Usa --force para forzar la actualizacion.
    goto :end
  )
  echo Forzando actualizacion...
)

call :run_r_pipeline
if errorlevel 1 exit /b 1

call :verify_csvs
if errorlevel 1 exit /b 1

call :run_alerts
call :run_monthly_report

call :rebuild_dashboard
if errorlevel 1 exit /b 1

call :save_timestamp
goto :done

REM ============================================================
REM  FUNCIONES
REM ============================================================

:download_dgt
echo.
echo [0/4] Descargando datos nuevos de la DGT...
if not defined PY (
  echo   Python no disponible, saltando descarga.
  goto :eof
)
if not exist "%DOWNLOAD_PY%" (
  echo   AVISO: %DOWNLOAD_PY% no existe. Saltando.
  goto :eof
)
%PY% "%DOWNLOAD_PY%" auto
if errorlevel 1 (
  echo   AVISO: download_dgt.py termino con errores ^(no critico^).
) else (
  echo   Descarga DGT completada.
)
goto :eof

REM ──────────────────────────────────────────
:check_new_data
set "NEW_DATA=0"
echo.
echo [1/4] Comprobando si hay datos nuevos...

if not exist "%TIMESTAMP%" (
  echo   No hay registro de actualizacion previa.
  set "NEW_DATA=1"
  goto :eof
)

set /p LAST_UPDATE=<"%TIMESTAMP%"
echo   Ultima actualizacion: %LAST_UPDATE%

REM Contar Excel en el directorio de datos
set "EXCEL_COUNT=0"
for %%f in ("%DATA_DIR%\*.xlsx") do set /a EXCEL_COUNT+=1

if %EXCEL_COUNT%==0 (
  echo   AVISO: No se encontraron ficheros Excel en:
  echo   %DATA_DIR%
  set "NEW_DATA=0"
  goto :eof
)

echo   Ficheros Excel encontrados: %EXCEL_COUNT%
REM En Windows es dificil comparar timestamps de archivos con fechas de texto
REM Por simplicidad: si hay Excel, marcar como "hay datos" si no hay timestamp
REM Para deteccion real de nuevos archivos usar --force despues de añadir datos
set "NEW_DATA=1"
echo   Usa --force para forzar regeneracion completa.
goto :eof

REM ──────────────────────────────────────────
:run_r_pipeline
echo.
echo [2/4] Ejecutando pipeline R...
echo   Script: %PIPELINE_R%

"%RSCRIPT%" "%PIPELINE_R%"
if errorlevel 1 (
  echo   ERROR: El pipeline R fallo.
  exit /b 1
)
echo   Pipeline mensual completado.

REM Prophet ANTES que MD diario (MD lo usa como forecast de escalado)
if exist "%PROPHET_R%" (
  echo.
  echo   Ejecutando export Prophet...
  "%RSCRIPT%" "%PROPHET_R%"
  if errorlevel 1 (
    echo   AVISO: export_prophet.R fallo ^(no critico, continuando^)
  ) else (
    echo   Export Prophet completado.
  )
)

if exist "%MD_DIARIO_R%" (
  echo.
  echo   Ejecutando export MD diario...
  "%RSCRIPT%" "%MD_DIARIO_R%"
  if errorlevel 1 (
    echo   AVISO: export_md_diario.R fallo ^(no critico, continuando^)
  ) else (
    echo   Export MD diario completado.
  )
)

if exist "%MARCA_PROV_R%" (
  echo.
  echo   Ejecutando export marca x provincia anual...
  "%RSCRIPT%" "%MARCA_PROV_R%"
  if errorlevel 1 (
    echo   AVISO: export_marca_provincia.R fallo ^(no critico, continuando^)
  ) else (
    echo   Export marca x provincia anual completado.
  )
)

echo   Pipeline R completado.
goto :eof

REM ──────────────────────────────────────────
:run_alerts
echo.
echo [3.5/4] Motor de alertas push (Resend)...
if not defined PY (
  echo   Python no disponible, saltando motor de alertas.
  goto :eof
)
if not exist "%ALERT_PY%" (
  echo   AVISO: %ALERT_PY% no existe. Saltando.
  goto :eof
)
REM El propio alert_engine.py carga .env via python-dotenv y reporta si
REM faltan KV / RESEND_API_KEY. No parseamos el .env desde el batch.
if not exist "%SCRIPTS_DIR%\subscribers.json" (
  if not exist "%WEB_DIR%\.env" if not exist "%SCRIPTS_DIR%\.env" (
    echo   Sin Vercel KV ni subscribers.json local, no hay destinatarios. Saltando.
    goto :eof
  )
)
%PY% "%ALERT_PY%"
if errorlevel 1 (
  echo   AVISO: alert_engine.py termino con errores ^(no critico^).
) else (
  echo   Motor de alertas ejecutado.
)
goto :eof

REM ──────────────────────────────────────────
:run_monthly_report
echo.
echo [3.6/4] Informe ejecutivo mensual (Resend)...
if not defined PY (
  echo   Python no disponible, saltando informe mensual.
  goto :eof
)
if not exist "%REPORT_PY%" (
  echo   AVISO: %REPORT_PY% no existe. Saltando.
  goto :eof
)
REM Solo enviamos el informe ejecutivo el dia 1-3 de cada mes (datos recien
REM publicados por la DGT). Fuera de esa ventana, lo saltamos para evitar
REM enviar dos veces el mismo informe si la pipeline corre por --force.
for /f "tokens=1 delims=/- " %%a in ("%date%") do set "DAY=%%a"
if "%DAY:~0,1%"=="0" set "DAY=%DAY:~1%"
if %DAY% GTR 3 (
  echo   Hoy es dia %DAY%; el informe mensual solo se envia los dias 1-3. Saltando.
  goto :eof
)
REM monthly_report.py carga .env via python-dotenv y reporta si faltan
REM credenciales. Solo comprobamos que haya algun destinatario potencial.
if not exist "%SCRIPTS_DIR%\subscribers.json" (
  if not exist "%WEB_DIR%\.env" if not exist "%SCRIPTS_DIR%\.env" (
    echo   Sin Vercel KV ni subscribers.json local, no hay destinatarios. Saltando.
    goto :eof
  )
)
%PY% "%REPORT_PY%"
if errorlevel 1 (
  echo   AVISO: monthly_report.py termino con errores ^(no critico^).
) else (
  echo   Informe ejecutivo mensual enviado.
)
goto :eof

REM ──────────────────────────────────────────
:verify_csvs
echo.
echo [3/4] Verificando CSVs generados...

set "ALL_OK=1"
for %%f in (
  df_mensual_agrupado.csv
  df_mensual_marca.csv
  df_mensual_marca_lugar.csv
  df_mapa_densidad.csv
  df_real_pred_mensual_total.csv
) do (
  if exist "%PUBLIC_DIR%\%%f" (
    echo   OK: %%f
  ) else (
    echo   FALTA: %%f
    set "ALL_OK=0"
  )
)

if "%ALL_OK%"=="0" (
  echo   AVISO: Algunos CSVs no se generaron correctamente.
  exit /b 1
)
echo   Todos los CSVs presentes.
goto :eof

REM ──────────────────────────────────────────
:rebuild_dashboard
echo.
echo [4/4] Reconstruyendo dashboard...

if not exist "%WEB_DIR%\package.json" (
  echo   ERROR: No se encontro package.json en %WEB_DIR%
  exit /b 1
)

pushd "%WEB_DIR%"

if not exist "node_modules" (
  echo   Instalando dependencias npm...
  call "%NPM%" install --legacy-peer-deps
  if errorlevel 1 (
    echo   ERROR: npm install fallo
    popd
    exit /b 1
  )
)

echo   Ejecutando npm run build...
call "%NPM%" run build
if errorlevel 1 (
  echo   ERROR: El build fallo
  popd
  exit /b 1
)
popd
echo   Dashboard reconstruido exitosamente.
goto :eof

REM ──────────────────────────────────────────
:save_timestamp
echo %date% %time%>"%TIMESTAMP%"
echo   Timestamp guardado.
goto :eof

REM ============================================================
:done
echo.
echo ========================================
echo ACTUALIZACION COMPLETADA
echo %date% %time%
echo ========================================
echo.
echo Los insights de la pestana Cognitiva se
echo actualizaran al recargar el dashboard.
echo.

:end
endlocal

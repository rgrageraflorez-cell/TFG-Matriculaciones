@echo off
REM ============================================================
REM  install_schedule.bat
REM  Registra la tarea programada "DGT_Pipeline_Monthly" que se
REM  ejecutara el dia 10 de cada mes a las 04:00, invocando
REM  run_monthly.bat.
REM
REM  Por que el dia 10 (no el 1):
REM    La DGT publica el ZIP mensual agregado con 2-3 semanas de
REM    retraso respecto al fin de mes. Si el cron corre el dia 1,
REM    el mensual del mes recien terminado todavia no esta
REM    publicado y solo se descargan los diarios. Esperando al
REM    dia 10, el mensual ya suele estar disponible y el pipeline
REM    actualiza tambien los CSVs agregados (df_mensual_marca,
REM    df_mapa_densidad, etc.).
REM
REM  Uso:
REM    install_schedule.bat              -> instala / actualiza
REM    install_schedule.bat --uninstall  -> elimina la tarea
REM
REM  Tras instalar, recomendado aplicar settings robustos con
REM  PowerShell (StartWhenAvailable, RestartCount, etc.):
REM    Set-ScheduledTask -TaskName "DGT_Pipeline_Monthly" `
REM      -Settings (New-ScheduledTaskSettingsSet `
REM        -StartWhenAvailable -WakeToRun `
REM        -RestartCount 3 -RestartInterval (New-TimeSpan -Hours 1))
REM ============================================================

setlocal
set "SCRIPT_DIR=%~dp0"
set "TASK=DGT_Pipeline_Monthly"
set "WRAPPER=%SCRIPT_DIR%run_monthly.bat"

if /I "%~1"=="--uninstall" goto :uninstall

if not exist "%WRAPPER%" (
  echo ERROR: No existe %WRAPPER%
  exit /b 1
)

echo Instalando tarea programada "%TASK%"...
echo  - Ejecutable: %WRAPPER%
echo  - Periodicidad: dia 10 de cada mes a las 04:00
echo.

schtasks /Create ^
  /TN "%TASK%" ^
  /TR "\"%WRAPPER%\"" ^
  /SC MONTHLY /D 10 /ST 04:00 ^
  /RL LIMITED /F
if errorlevel 1 (
  echo ERROR: No se pudo crear la tarea.
  exit /b 1
)

echo.
echo Tarea registrada. Para lanzarla manualmente:
echo   schtasks /Run /TN "%TASK%"
echo Para eliminarla:
echo   %~nx0 --uninstall
exit /b 0

:uninstall
echo Eliminando tarea "%TASK%"...
schtasks /Delete /TN "%TASK%" /F
exit /b %ERRORLEVEL%

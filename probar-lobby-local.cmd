@echo off
rem Doble clic: sirve el repo en http://localhost:8765/ y abre el navegador.
rem Con "dos" como argumento abre tambien una ventana de incognito (2 jugadores).
if /i "%~1"=="dos" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-server.ps1" -DosJugadores
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-server.ps1"
)
pause

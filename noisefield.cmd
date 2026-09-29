@echo off
chcp 65001 >nul
setlocal
rem Запуск визуализатора на Windows: локальный сервер + браузер.
rem Сервер живёт, пока открыто это окно. Закрыть окно или Ctrl+C — остановить.

rem Второй вход в этот же файл: фоновое ожидание сервера и открытие вкладки.
if "%~1"==":open" goto :open

set "DIR=%~dp0"
set PORT=5180
set "URL=http://127.0.0.1:%PORT%/noisefield.html"
title noisefield :%PORT%

rem py -3 — лаунчер с python.org; python3 из WindowsApps не берём: это
rem заглушка, которая открывает Microsoft Store вместо интерпретатора.
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (python --version >nul 2>&1 && set "PY=python")
if not defined PY call :die "Нет Python 3. Поставьте его с python.org (галка «Add python.exe to PATH»)." & exit /b 1
if not exist "%DIR%noisefield.html" call :die "Не нашёл %DIR%noisefield.html" & exit /b 1

rem Сервер уже поднят прошлым запуском — просто открываем вкладку.
curl.exe -s -o nul --max-time 1 "%URL%" && (
  echo сервер уже на %PORT%, открываю вкладку
  start "" "%URL%"
  exit /b 0
)

cd /d "%DIR%" || (call :die "Не смог зайти в %DIR%" & exit /b 1)
start "" /b cmd /c ""%~f0" :open "%URL%""
echo noisefield: %URL%
echo закройте это окно, чтобы остановить сервер
echo.
%PY% -m http.server %PORT% --bind 127.0.0.1
exit /b

:open
curl.exe -s -o nul --retry 20 --retry-connrefused --retry-delay 1 "%~2" || (
  echo ОШИБКА: сервер не поднялся
  exit /b 1
)
start "" "%~2"
exit /b 0

:die
echo ОШИБКА: %~1
pause
exit /b 1

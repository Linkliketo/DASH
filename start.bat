@echo off
title DASH V0 Launcher
cd /d "%~dp0"

:menu
echo ============================================
echo   DASH V0 Launcher - Select Mode
echo ============================================
echo   1. Body mode    (SysMocap self-render)
echo   2. Face mode    (miniface self-render)
echo   3. Fusion mode  (dual-cam: body + face - viewer render)
echo   4. Synthetic test (no camera - fake body+face to verify viewer)
echo   0. Exit
echo ============================================
set /p mode=Select [1/2/3/4/0]: 

if "%mode%"=="1" goto body
if "%mode%"=="2" goto face
if "%mode%"=="3" goto fusion
if "%mode%"=="4" goto fake
if "%mode%"=="0" exit
echo Invalid input
goto menu

:body
echo Starting SysMocap (full body mocap)...
start "" "SysMocapApp\SysMocap-win32-x64\SysMocap.exe"
echo [OK] SysMocap launched. Drag a VRM/GLB, then Mocap tab - Start.
goto menu

:face
echo Starting miniface (face mocap, port 3000)...
start "miniface" cmd /c "cd /d facial-motion-capture && npx serve -s build -l 3000 --no-clipboard"
timeout /t 4 >nul
start "" http://localhost:3000
echo [OK] Browser opened http://localhost:3000 - allow camera permission.
goto menu

:fusion
echo Starting fusion server (ws 8765 / 8766)...
start "fusion-server" cmd /c "cd /d fusion && node server.mjs"
timeout /t 2 >nul
echo Starting fusion viewer (port 8081)...
start "fusion-viewer" cmd /c "npx serve . -l 8081 --no-clipboard"
timeout /t 4 >nul
start "" http://localhost:8081/viewer/
echo.
echo ============================================
echo  Fusion mode needs 3 parts ready:
echo   1. Fusion server   - auto started (ws://127.0.0.1:8766)
echo   2. Fusion viewer   - browser auto opened
echo   3. Capture sources - start MANUALLY (two cameras needed):
echo      a. SysMocap: Settings - enable Forward - Mocap - Start (body)
echo      b. miniface: run Mode 2, or open http://localhost:3000 (face)
echo ============================================
goto menu

:fake
echo Starting fusion server + synthetic source + viewer...
start "fusion-server" cmd /c "cd /d fusion && node server.mjs"
timeout /t 2 >nul
start "fake-source" cmd /c "cd /d fusion && node fake_source.mjs"
timeout /t 1 >nul
start "fusion-viewer" cmd /c "npx serve . -l 8081 --no-clipboard"
timeout /t 4 >nul
start "" http://localhost:8081/viewer/
echo.
echo [OK] Synthetic test running - model should wave + blink + open mouth.
echo      (No camera needed. Close the fake-source window to stop.)
goto menu

@echo off
chcp 65001 >nul
title miniface video source
cd /d "%~dp0"

set Y4M=%~1
if "%Y4M%"=="" set Y4M=test_5s.y4m

echo Starting miniface (port 3000)...
start "miniface" cmd /c "cd /d facial-motion-capture && npx serve -s build -l 3000 --no-clipboard"
timeout /t 4 >nul

echo Launching Chrome with fake camera = %Y4M%
start "miniface-video" "C:\Program Files\Google\Chrome\Application\chrome.exe" --no-first-run --use-fake-device-for-media-stream --use-fake-ui-for-media-stream "--use-file-for-fake-video-capture=D:\DASH\V0FastTest\%Y4M%" --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows http://localhost:3000

echo.
echo [OK] miniface now reads video file as camera: %Y4M%
echo [Tip] Convert your own video first:
echo       python tools\video_to_y4m.py your.mp4 your.y4m 640x480 30 5 1

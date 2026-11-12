@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================================
echo   TA TRACKER - HE THONG QUAN LY UNG VIEN NOI BO (LAN)
echo ========================================================

if not exist "node_modules" (
    echo [1/4] Dang cai dat thu vien phu thuoc (npm install)...
    call npm install
    if errorlevel 1 (
        echo [LOI] Khong the cai dat thu vien. Vui long kiem tra Node.js.
        pause
        exit /b 1
    )
) else (
    echo [1/4] Thu vien node_modules da san sang.
)

if not exist "data" (
    mkdir data
)

if not exist ".env" (
    echo [2/4] Tao file .env tu .env.example...
    copy /Y ".env.example" ".env" >nul
    echo Vui long cap nhat INITIAL_ADMIN_USERNAME va INITIAL_ADMIN_PASSWORD ^(toi thieu 8 ky tu^) trong file .env truoc khi dang nhap lan dau.
)

echo [3/4] Dia chi truy cap mang noi bo (LAN):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set ip=%%a
    set ip=!ip:~1!
    echo   - http://!ip!:3000
)
echo   - http://localhost:3000
echo.
echo Luu y: Lan chay dau tien he thong khoi tao tai khoan admin tu bien moi truong
echo INITIAL_ADMIN_USERNAME va INITIAL_ADMIN_PASSWORD trong .env ^(bat buoc doi mat khau khi dang nhap lan dau^).
echo ========================================================
echo [4/4] Dang khoi dong may chu TA TRACKER...

call npx tsx server.ts
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Отправка изменений на GitHub...
git add -A
git commit -m "Обновление"
git push
echo.
echo Готово. Теперь на GitHub: Actions, Собрать APK, Run workflow.
pause

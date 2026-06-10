@echo off
rem harness launcher Windows shim (P2/bw-windows-shim, 2026-06-10)
rem - Runs harness commands without npm/package.json from cmd.exe or PowerShell.
rem - POSIX environments (macOS/Linux/Git Bash) use the sibling `harness` sh launcher.
rem - Git hooks run under Git Bash even on Windows, so hooks keep using the sh launcher.
rem - Messages stay ASCII-only to avoid cp949/UTF-8 mojibake in Windows terminals.
setlocal

set "ROOT=%~dp0..\.."
set "CMD=%~1"

if "%CMD%"=="" goto :usage
if "%CMD%"=="-h" goto :usage
if "%CMD%"=="--help" goto :usage
if "%CMD%"=="help" goto :usage

set "SCRIPT="
set "PRE="
if "%CMD%"=="check"           set "SCRIPT=guard.mjs"
if "%CMD%"=="impact"          set "SCRIPT=policy-harness.mjs" & set "PRE=impact"
if "%CMD%"=="scan"            set "SCRIPT=scan-project.mjs" & set "PRE=--write"
if "%CMD%"=="handoff"         set "SCRIPT=handoff.mjs" & set "PRE=--write"
if "%CMD%"=="guide"           set "SCRIPT=harness-guide.mjs"
if "%CMD%"=="sync"            set "SCRIPT=sync-context.mjs"
if "%CMD%"=="context"         set "SCRIPT=build-context.mjs"
if "%CMD%"=="outdated"        set "SCRIPT=outdated-harness.mjs"
if "%CMD%"=="update"          set "SCRIPT=update-harness.mjs"
if "%CMD%"=="changelog"       set "SCRIPT=changelog-delta.mjs"
if "%CMD%"=="hooks:install"   set "SCRIPT=install-hooks.mjs"
if "%CMD%"=="standards:list"  set "SCRIPT=list-stack-standards.mjs"
if "%CMD%"=="templates:list"  set "SCRIPT=list-templates.mjs"
if "%CMD%"=="stack:apply"     set "SCRIPT=apply-stack.mjs"
if "%CMD%"=="stack:reset"     set "SCRIPT=apply-stack.mjs" & set "PRE=--reset"
if "%CMD%"=="stack:status"    set "SCRIPT=apply-stack.mjs" & set "PRE=--status"
if "%CMD%"=="template:apply"  set "SCRIPT=apply-stack.mjs" & set "PRE=--template"
if "%CMD%"=="template:reset"  set "SCRIPT=apply-stack.mjs" & set "PRE=--template-reset"
if "%CMD%"=="template:status" set "SCRIPT=apply-stack.mjs" & set "PRE=--template-status"

if "%SCRIPT%"=="" (
  echo Unknown command: %CMD% 1>&2
  echo. 1>&2
  call :usage_body 1>&2
  exit /b 1
)

rem Collect remaining args (cmd shift does not update %*).
shift
set "ARGS="
:collect
if "%~1"=="" goto :run
set ARGS=%ARGS% %1
shift
goto :collect

:run
pushd "%ROOT%" || exit /b 1
rem Run the minimum-Node check first so old Node prints upgrade guidance instead of syntax errors.
node .harness\bin\check-node-version.mjs
if errorlevel 1 ( popd & exit /b 1 )
node ".harness\bin\%SCRIPT%" %PRE% %ARGS%
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%

:usage
call :usage_body
exit /b 0

:usage_body
echo Usage: harness ^<command^> [args...]
echo   Runs harness without npm. With package.json, `npm run harness:*` behaves the same.
echo.
echo Commands:
echo   check [--strict^|--fast]    integrated check       (npm run harness:check)
echo   impact                     policy impact analysis  (harness:impact)
echo   scan                       project scan report     (harness:scan)
echo   handoff                    install/update handoff  (harness:handoff)
echo   guide                      current status guide    (harness:guide)
echo   sync                       agent context sync      (harness:sync)
echo   context "<task>"           task decision context   (harness:context)
echo   outdated                   update candidates       (harness:outdated)
echo   update                     harness update          (harness:update)
echo   changelog                  last update changelog   (harness:changelog)
echo   hooks:install              git hooks + template    (hooks:install)
echo   standards:list             stack harness catalog   (standards:list)
echo   templates:list             scaffold templates      (templates:list)
echo   stack:apply ^| stack:reset ^| stack:status
echo   template:apply ^| template:reset ^| template:status
exit /b 0

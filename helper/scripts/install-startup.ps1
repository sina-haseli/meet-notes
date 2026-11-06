# Creates "Meet Notes Helper.lnk" in the Windows Startup folder so the helper
# starts (without a console window) when you log in. Run once:
#   powershell -ExecutionPolicy Bypass -File helper\scripts\install-startup.ps1
$ErrorActionPreference = 'Stop'

$helperDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pythonw = Join-Path $helperDir '.venv\Scripts\pythonw.exe'
if (-not (Test-Path $pythonw)) {
    throw "pythonw.exe not found at $pythonw. Create the venv first (see README, 'Helper setup')."
}

$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Meet Notes Helper.lnk'

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $pythonw
$sc.Arguments = '-m meetnotes'
$sc.WorkingDirectory = $helperDir
$sc.Description = 'Meet Notes helper (127.0.0.1:47821)'
$sc.Save()

Write-Host "Created $lnk"

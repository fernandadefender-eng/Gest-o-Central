# Atualiza a API sem deixar o sistema parado.
#  1. (-Prisma) Regenera o cliente do banco: a API para ~2 s (o Windows trava o arquivo do
#     Prisma enquanto ela roda) e volta NA HORA com a versão atual.
#  2. Compila com a API NO AR (tenta de novo se o OneDrive travar um arquivo — EBUSY).
#  3. Só se compilou: reinicia a API e confere que voltou (~6 s).
#  4. Se a compilação falhar e a API estiver fora, religa a versão que existe.
# Uso (NUNCA encadear a saída com "| tail": o terminal espera o processo da API):
#   powershell -ExecutionPolicy Bypass -File scripts\atualizar-api.ps1 [-Prisma]
param([switch]$Prisma)

$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
$api = Join-Path $raiz 'apps\api'
$logs = Join-Path $raiz 'logs'
$env:PATH = "C:\Program Files\nodejs;$env:PATH"

function PararApi { Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*dist*main.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } }
function SubirApi {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'dist/src/main.js' -WorkingDirectory $api -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "api-$stamp.log") -RedirectStandardError (Join-Path $logs "api-$stamp.err.log")
}
function ApiNoAr { try { return (Invoke-WebRequest 'http://127.0.0.1:3000/webhooks/whatsapp' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { return $false } }
function EsperarApi { for ($i = 0; $i -lt 30; $i++) { Start-Sleep 2; if (ApiNoAr) { return ($i + 1) * 2 } }; return $null }

Push-Location $api
if ($Prisma) {
  PararApi
  Start-Sleep 1
  & npx prisma generate 2>&1 | Select-String 'Generated|Error' | ForEach-Object { Write-Output $_.Line }
  SubirApi   # volta já com a versão atual enquanto compila a nova
  $s = EsperarApi
  Write-Output "cliente do banco regenerado; API de volta em $s s"
}

$ok = $false
for ($t = 1; $t -le 4 -and -not $ok; $t++) {
  $saida = & npm run build 2>&1
  if ($LASTEXITCODE -eq 0 -and (Test-Path 'dist\src\main.js')) { $ok = $true }
  else {
    Write-Output "compilação falhou (tentativa $t): $(($saida | Select-String -Pattern 'error' | Select-Object -First 1).Line)"
    Start-Sleep 5
  }
}
if (-not $ok) {
  if (-not (ApiNoAr) -and (Test-Path 'dist\src\main.js')) { SubirApi; $s = EsperarApi; Write-Output "compilação falhou; API religada com a versão existente ($s s)" }
  else { Write-Output 'NÃO reiniciei: a compilação não passou. A API atual continua no ar.' }
  Pop-Location; exit 1
}

PararApi
SubirApi
Pop-Location
$s = EsperarApi
if ($s) { Write-Output "API atualizada e no ar em $s s"; exit 0 }
Write-Output 'A API não respondeu em 60 s — o vigia do sistema vai religar; confira logs\api-*.err.log'
exit 1

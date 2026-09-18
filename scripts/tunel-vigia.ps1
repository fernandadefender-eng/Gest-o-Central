# Vigia do sistema PR7 — nada pode ficar parado. A cada 30 s confere, nesta ordem:
#  1. Docker: banco (Postgres) e fila (Redis) rodando; se um parou, liga de novo.
#  2. API: responde em 127.0.0.1:3000; se não responder 2 vezes seguidas, sobe de novo
#     (antes, API caída não voltava sozinha — e o vigia achava que era o túnel).
#  3. Túnel (só com a API no ar): o gratuito da Cloudflare cai sem aviso e muda de
#     endereço; se cair, sobe outro e reconfigura o webhook da Z-API sozinho.
# Tudo fica em logs/tunel-vigia.log. Mensagens não se perdem numa queda: a varredura
# da API reclassifica o que ficou parado.
# Uso (fica rodando em segundo plano):
#   powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts\tunel-vigia.ps1
# Solução definitiva: servidor na nuvem com domínio fixo (ver docs/hospedagem.md).

$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
$api = Join-Path $raiz 'apps\api'
$logs = Join-Path $raiz 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$registro = Join-Path $logs 'tunel-vigia.log'
$exe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$node = 'C:\Program Files\nodejs\node.exe'
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$containers = @('projetowhatsapppr7-postgres-1', 'projetowhatsapppr7-redis-1')

function Anotar($texto) { "$(Get-Date -Format 'dd/MM HH:mm:ss') $texto" | Add-Content -LiteralPath $registro -Encoding utf8 }

function ApiNoAr {
  try {
    $r = Invoke-WebRequest 'http://127.0.0.1:3000/webhooks/whatsapp' -UseBasicParsing -TimeoutSec 8
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Saudavel($url) {
  if (-not $url) { return $false }
  try {
    $hostName = ([uri]$url).Host
    Resolve-DnsName $hostName -Server 1.1.1.1 -ErrorAction Stop | Out-Null
    $r = Invoke-WebRequest "$url/webhooks/whatsapp" -UseBasicParsing -TimeoutSec 15
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function ConferirDocker {
  $rodando = docker ps --format '{{.Names}}' 2>$null
  if ($LASTEXITCODE -ne 0) {
    Anotar 'Docker não responde — tentando abrir o Docker Desktop'
    $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue) -and (Test-Path $dd)) { Start-Process $dd }
    return $false
  }
  $ok = $true
  foreach ($c in $containers) {
    if (-not ($rodando -contains $c)) {
      Anotar "container $c parado — ligando"
      docker start $c 2>&1 | Out-Null
      $ok = $false
    }
  }
  return $ok
}

function SubirApi {
  Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*dist*main.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
  Start-Process -FilePath $node -ArgumentList 'dist/src/main.js' -WorkingDirectory $api -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "api-$stamp.log") -RedirectStandardError (Join-Path $logs "api-$stamp.err.log")
  Anotar "API fora do ar — subindo de novo (log: api-$stamp.log)"
}

function NovoTunel {
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
  $log = Join-Path $env:TEMP ("cloudflared-vigia-{0}.log" -f (Get-Date -Format 'yyyyMMddHHmmss'))
  Start-Process -FilePath $exe -ArgumentList @('tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3000', '--logfile', "`"$log`"") -WindowStyle Hidden
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep 2
    if (Test-Path -LiteralPath $log) {
      $m = Select-String -LiteralPath $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
      if ($m) { return $m.Matches[0].Value }
    }
  }
  return $null
}

$urlArquivo = Join-Path $env:TEMP 'tunel-url.txt'
$url = if (Test-Path -LiteralPath $urlArquivo) { (Get-Content -LiteralPath $urlArquivo -Raw).Trim() } else { $null }
$falhasApi = 0
$ultimaSubida = [datetime]::MinValue
Anotar "vigia do sistema iniciado (túnel atual: $url)"

while ($true) {
  # 1) Banco e fila
  $dockerOk = ConferirDocker

  # 2) API — só religa depois de 2 falhas seguidas e com 2 min de carência após subir
  if (ApiNoAr) {
    if ($falhasApi -ge 2) { Anotar 'API de volta ao ar' }
    $falhasApi = 0
  } else {
    $falhasApi++
    if ($dockerOk -and $falhasApi -ge 2 -and ((Get-Date) - $ultimaSubida).TotalSeconds -gt 120) {
      SubirApi
      $ultimaSubida = Get-Date
    }
  }

  # 3) Túnel — com a API fora, a falha é da API (não troca o túnel à toa)
  if ($falhasApi -eq 0 -and -not (Saudavel $url)) {
    Anotar "túnel fora do ar ($url) — subindo outro"
    $novo = NovoTunel
    if ($novo) {
      # Espera o endereço novo propagar antes de avisar a Z-API
      for ($i = 0; $i -lt 20 -and -not (Saudavel $novo); $i++) { Start-Sleep 3 }
      Set-Content -LiteralPath $urlArquivo -Value $novo -Encoding utf8
      $url = $novo
      Push-Location $api
      $saida = & npx ts-node -T scripts/zapi-webhook.ts configurar $novo 2>&1 | Select-String 'webhook|status' | ForEach-Object { $_.Line }
      Pop-Location
      Anotar "túnel novo: $novo · Z-API: $($saida -join ' | ')"
    } else {
      Anotar 'falha ao subir túnel — tenta de novo em 30 s'
    }
  }
  Start-Sleep 30
}

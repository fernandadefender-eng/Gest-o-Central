# Backup completo do banco (PostgreSQL no Docker) para a pasta backups/.
# Mantém os últimos 14 arquivos. Uso: powershell -File scripts\backup-banco.ps1
# Restaurar: Get-Content backups\<arquivo>.sql | docker exec -i projetowhatsapppr7-postgres-1 psql -U atendimento -d atendimento
# ATENÇÃO: o backup contém dados pessoais (nomes, telefones) — não compartilhar nem subir para nuvem pública.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$pasta = Join-Path $raiz 'backups'
New-Item -ItemType Directory -Force $pasta | Out-Null

$arquivo = Join-Path $pasta ("atendimento-{0}.sql" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
docker exec projetowhatsapppr7-postgres-1 pg_dump -U atendimento -d atendimento --clean --if-exists | Out-File -Encoding utf8 $arquivo
if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou (código $LASTEXITCODE)" }

Get-ChildItem $pasta -Filter 'atendimento-*.sql' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item -Confirm:$false
Write-Output ("Backup salvo: {0} ({1:N1} MB)" -f $arquivo, ((Get-Item $arquivo).Length / 1MB))

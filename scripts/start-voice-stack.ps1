$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$envFile = Join-Path $root ".env.voice-stack"
$envExampleFile = Join-Path $root ".env.voice-stack.example"
$composeFile = Join-Path $root "docker-compose.voice-stack.yml"

if (-not (Test-Path $envFile)) {
  if (Test-Path $envExampleFile) {
    Copy-Item $envExampleFile $envFile
    Write-Host "Создан шаблон .env.voice-stack из .env.voice-stack.example." -ForegroundColor Yellow
    Write-Host "Проверь PUBLIC_HOST и POSTGRES_PASSWORD, затем запусти скрипт ещё раз." -ForegroundColor Yellow
    exit 1
  }
  throw ".env.voice-stack не найден"
}

if (-not (Test-Path $composeFile)) {
  throw "docker-compose.voice-stack.yml не найден"
}

Write-Host "Запускаю голосовой стек..." -ForegroundColor Cyan
docker compose --env-file $envFile -f $composeFile up -d --build

$publicHost = ""
Get-Content $envFile | ForEach-Object {
  if ($_ -match "^PUBLIC_HOST=(.+)$") {
    $publicHost = $Matches[1].Trim()
  }
}

Write-Host ""
Write-Host "Готово." -ForegroundColor Green
Write-Host "Открой игру по адресу: https://$publicHost/" -ForegroundColor Green
Write-Host "Если браузер ещё не пускает в микрофон, проверь, что порты 80/443/3478 и 49160-49200 открыты наружу." -ForegroundColor Yellow

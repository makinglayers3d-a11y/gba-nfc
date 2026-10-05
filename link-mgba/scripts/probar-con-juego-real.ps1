# Pruebas completas del Cable Link en este PC, con un juego de verdad.
#
#   powershell -ExecutionPolicy Bypass -File link-mgba\scripts\probar-con-juego-real.ps1
#   powershell -ExecutionPolicy Bypass -File link-mgba\scripts\probar-con-juego-real.ps1 -Rom "D:\otro\juego.gba"
#
# En GitHub las pruebas corren con una ROM libre, que no guarda partida ni
# tiene graficos, asi que alli se saltan las comprobaciones que necesitan un
# juego. Aqui se hacen todas.
#
# El juego se lee de donde este y NO se copia: el script se niega a usar una ROM
# que este dentro de la carpeta del repositorio, para que no pueda acabar en un
# commit por descuido.

param(
  # Carpeta con juegos. Por defecto, la copia de seguridad de este PC.
  [string]$Carpeta = "C:\AI\copia-contenido-protegido\games",
  # Un juego concreto. Si no se indica, se coge el primer .gba de la carpeta.
  [string]$Rom = "",
  # Segundos de la prueba de estabilidad de la fase 2.
  [int]$Segundos = 60
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Smoke = Join-Path $PSScriptRoot "smoke.cjs"
$Runtime = Join-Path $PSScriptRoot "runtime-check.cjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Output "Hace falta Node.js en este PC."
  exit 2
}

if (-not $Rom) {
  if (-not (Test-Path -LiteralPath $Carpeta -PathType Container)) {
    Write-Output "No existe la carpeta $Carpeta. Indica un juego con -Rom."
    exit 2
  }
  $primero = Get-ChildItem -LiteralPath $Carpeta -Filter *.gba | Sort-Object Name | Select-Object -First 1
  if (-not $primero) {
    Write-Output "No hay ningun .gba en $Carpeta. Indica un juego con -Rom."
    exit 2
  }
  $Rom = $primero.FullName
}

if (-not (Test-Path -LiteralPath $Rom -PathType Leaf)) {
  Write-Output "No existe el juego: $Rom"
  exit 2
}
$Rom = (Resolve-Path -LiteralPath $Rom).Path

if ($Rom.StartsWith($Repo, [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Output "Ese juego esta dentro del repositorio ($Repo)."
  Write-Output "Usa uno de fuera, para que no pueda subirse por descuido."
  exit 2
}

Write-Output "Juego: $Rom"
Write-Output ""

$fallos = @()
function Ejecuta($nombre, $script, $argumentos, $entorno) {
  Write-Output "=== $nombre ==="
  foreach ($clave in @("SMOKE_MODE", "SMOKE_LINK_SEATS", "SMOKE_LINK_FRAMES", "SMOKE_SECONDS")) {
    Remove-Item "Env:$clave" -ErrorAction SilentlyContinue
  }
  foreach ($clave in $entorno.Keys) { Set-Item "Env:$clave" $entorno[$clave] }
  & node $script @argumentos 2>&1 | Where-Object { $_ -match "^\s+FAIL|^smoke |^runtime|::error|OK$" } | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { $script:fallos += $nombre }
  Write-Output ""
}

Ejecuta "Nucleo y dos instancias (fases 1 y 2)" $Smoke @("multi", $Rom) @{ SMOKE_SECONDS = "$Segundos" }
foreach ($asientos in 2, 3, 4) {
  Ejecuta "Cable con $asientos consolas" $Smoke @("multi", $Rom) @{ SMOKE_MODE = "link"; SMOKE_LINK_SEATS = "$asientos"; SMOKE_LINK_FRAMES = "1800" }
}
Ejecuta "Residuo de memoria con el cable" $Smoke @("multi", $Rom) @{ SMOKE_MODE = "linkleak" }
Ejecuta "Trafico por el cable" $Smoke @("multi", $Rom) @{ SMOKE_MODE = "traffic" }
Ejecuta "Runtime de la pagina (2, 3 y 4 consolas)" $Runtime @($Rom) @{}

if ($fallos.Count) {
  Write-Output "HAN FALLADO: $($fallos -join ' | ')"
  exit 1
}
Write-Output "Todas las pruebas han pasado."

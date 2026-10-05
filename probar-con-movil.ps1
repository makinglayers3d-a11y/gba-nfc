# Prueba del Cable Link entre este PC y un movil.
#
#   powershell -ExecutionPolicy Bypass -File probar-con-movil.ps1
#
# Levanta el servidor local y un tunel de Cloudflare, que da una direccion
# https temporal. El movil necesita https: sin el, Chrome y Safari no dejan
# usar WebRTC y el lobby no conecta.
#
# El tunel abre una conexion de SALIDA desde este PC, asi que no hay que tocar
# el firewall de Windows ni abrir puertos en el router.
#
# Importante: por el tunel solo viajan la pagina y la creacion de la sala. La
# partida va directa entre el PC y el movil por la wifi, asi que la latencia
# que se mide es la de la wifi, no la de internet.
#
# Ctrl+C para parar las dos cosas.

param(
  [int]$Port = 8765,
  [switch]$SinQR
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Find-Cloudflared {
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if (-not $base) { continue }
    $p = Join-Path $base "cloudflared\cloudflared.exe"
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
  Write-Output ""
  Write-Output "No encuentro cloudflared. Instalalo con:"
  Write-Output "    winget install --id Cloudflare.cloudflared"
  Write-Output ""
  exit 1
}

# --- servidor local ---------------------------------------------------------

$yaEstaba = $false
try {
  Invoke-WebRequest "http://localhost:$Port/index.html" -UseBasicParsing -TimeoutSec 3 | Out-Null
  $yaEstaba = $true
} catch { }

if ($yaEstaba) {
  Write-Output "El servidor ya estaba escuchando en el puerto $Port."
} else {
  Write-Output "Arrancando el servidor local en el puerto $Port..."
  Start-Process powershell `
    -ArgumentList "-ExecutionPolicy","Bypass","-File","$Root\dev-server.ps1","-Port","$Port","-SinNavegador" `
    -WorkingDirectory $Root -WindowStyle Minimized
  Start-Sleep -Seconds 3
}

# --- tunel ------------------------------------------------------------------

Write-Output "Abriendo el tunel https (tarda unos segundos)..."
$salida = Join-Path $env:TEMP "ml3d-tunel.log"
if (Test-Path -LiteralPath $salida) { Remove-Item -LiteralPath $salida -Force }

# --http-host-header es imprescindible: dev-server.ps1 usa HttpListener con el
# prefijo "localhost", que rechaza con 400 Bad Request cualquier peticion cuya
# cabecera Host sea otra. Sin esto el tunel abre pero solo devuelve errores.
$tunel = Start-Process $cloudflared `
  -ArgumentList "tunnel","--no-autoupdate","--url","http://localhost:$Port",
                "--http-host-header","localhost:$Port" `
  -RedirectStandardError $salida -RedirectStandardOutput "$salida.out" `
  -PassThru -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 750
  if (Test-Path -LiteralPath $salida) {
    $texto = Get-Content -LiteralPath $salida -Raw -ErrorAction SilentlyContinue
    if ($texto -match "https://[a-z0-9-]+\.trycloudflare\.com") {
      $url = $Matches[0]
      break
    }
  }
}

if (-not $url) {
  Write-Output ""
  Write-Output "El tunel no dio direccion. Mira el registro: $salida"
  if ($tunel -and -not $tunel.HasExited) { Stop-Process -Id $tunel.Id -Force }
  exit 1
}

# --- pagina con el QR -------------------------------------------------------

$destino = "$url/index.html?skipintro=1"

if (-not $SinQR) {
  $pagina = Join-Path $Root "abrir-en-el-movil.html"
  $html = @"
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Abrir en el movil</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:flex; flex-direction:column;
         align-items:center; justify-content:center; gap:22px; padding:24px;
         background:#10141b; color:#eef2f8;
         font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; text-align:center }
  h1 { margin:0; font-size:22px; letter-spacing:.02em }
  #qr { background:#fff; padding:16px; border-radius:12px; line-height:0 }
  a { color:#7db8ff; word-break:break-all; font-size:15px }
  p { margin:0; max-width:46ch; opacity:.85 }
  .aviso { font-size:13px; opacity:.6; max-width:52ch }
</style>
<h1>Apunta con la camara del movil</h1>
<div id="qr"></div>
<p>O escribe esta direccion en el navegador del movil:</p>
<a href="$destino">$destino</a>
<p class="aviso">La direccion cambia cada vez que arrancas el tunel. Mientras
esta ventana y la del tunel sigan abiertas, el movil puede entrar.</p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
  new QRCode(document.getElementById("qr"), { text: "$destino", width: 260, height: 260 });
</script>
"@
  Set-Content -LiteralPath $pagina -Value $html -Encoding utf8
  Start-Process $pagina
}

Write-Output ""
Write-Output "==================================================================="
Write-Output " En el MOVIL abre:"
Write-Output "   $destino"
Write-Output ""
Write-Output " En el PC abre:"
Write-Output "   http://localhost:$Port/index.html?skipintro=1"
Write-Output "==================================================================="
Write-Output ""
Write-Output "No hace falta tocar el firewall: el tunel sale de este PC."
Write-Output "Deja esta ventana abierta. Ctrl+C para parar el tunel."
Write-Output ""

try {
  Set-Clipboard -Value $destino
  Write-Output "(la direccion del movil esta copiada en el portapapeles)"
} catch { }

try {
  while (-not $tunel.HasExited) { Start-Sleep -Seconds 1 }
} finally {
  if ($tunel -and -not $tunel.HasExited) {
    Stop-Process -Id $tunel.Id -Force
    Write-Output "Tunel cerrado."
  }
}

# Servidor estático para probar ML3Demuler y el lobby en este PC.
#
#   powershell -ExecutionPolicy Bypass -File dev-server.ps1
#   powershell -ExecutionPolicy Bypass -File dev-server.ps1 -DosJugadores
#
# Hace falta servidor: con file:// el lobby no arranca, porque rooms.js se pide
# por fetch. localhost cuenta como contexto seguro, así que geolocalización y
# WebRTC funcionan igual que en el sitio publicado.
#
# Ctrl+C para pararlo.

param(
  [int]$Port = 8765,
  [switch]$SinNavegador,
  # Abre además una ventana de incógnito: dos jugadores aislados en un PC.
  # Dos pestañas de la misma ventana no valen, comparten el bus del cable Link.
  [switch]$DosJugadores
)

$Root = $PSScriptRoot
$url = "http://localhost:$Port/"

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".webp" = "image/webp"
  ".svg"  = "image/svg+xml"
  ".wasm" = "application/wasm"
  ".mp3"  = "audio/mpeg"
  ".wav"  = "audio/wav"
  ".apk"  = "application/vnd.android.package-archive"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)

try {
  $listener.Start()
} catch {
  Write-Output "No se pudo abrir $url"
  Write-Output "Si el puerto está ocupado, prueba: -Port 8766"
  exit 1
}

Write-Output "ML3Demuler en $url  (carpeta: $Root)"
Write-Output "Menu (boton de arriba a la derecha) -> ML3D Link Lobby"
Write-Output "Ctrl+C para parar."

if (-not $SinNavegador) {
  Start-Process $url
  if ($DosJugadores) {
    $chrome = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if ($chrome) {
      Start-Sleep -Milliseconds 800
      Start-Process $chrome -ArgumentList "--incognito", $url
    } else {
      Write-Output "No encuentro Chrome: abre tú la segunda ventana en incógnito."
    }
  }
}

try {
  while ($listener.IsListening) {
    try {
      $context = $listener.GetContext()
    } catch {
      break
    }

    $path = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
    if ($path -eq "/") { $path = "/index.html" }
    $file = Join-Path $Root ($path.TrimStart("/") -replace "/", "\")

    # Nada fuera de la carpeta del repo.
    $full = [System.IO.Path]::GetFullPath($file)
    $inside = $full.StartsWith([System.IO.Path]::GetFullPath($Root), [System.StringComparison]::OrdinalIgnoreCase)

    if ($inside -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $type = $types[$ext]
      if (-not $type) { $type = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $context.Response.ContentType = $type
      $context.Response.Headers.Add("Cache-Control", "no-store")
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $context.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 $path")
      $context.Response.OutputStream.Write($msg, 0, $msg.Length)
    }

    $context.Response.OutputStream.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}

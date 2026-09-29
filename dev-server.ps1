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

# El worker de salas solo acepta el origen del sitio publicado, así que desde
# localhost el navegador se comería un error de CORS ("Failed to fetch").
# /api/... se reenvía desde aquí: petición servidor a servidor, sin Origin, y
# el lobby la ve como mismo origen. rooms.js ya apunta ahí en localhost.
$ApiTarget = "https://ml3d-link-lab.makinglayers3d.workers.dev"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Send-ToWorker($context, $target) {
  $request = [System.Net.HttpWebRequest]::Create($target)
  $request.Method = $context.Request.HttpMethod
  $request.Accept = "application/json"
  $request.Timeout = 20000

  $auth = $context.Request.Headers["Authorization"]
  if ($auth) { $request.Headers.Add("Authorization", $auth) }

  if ($context.Request.HasEntityBody) {
    $reader = New-Object System.IO.StreamReader($context.Request.InputStream, $context.Request.ContentEncoding)
    $body = $reader.ReadToEnd()
    $reader.Close()
    $payload = [System.Text.Encoding]::UTF8.GetBytes($body)
    $type = $context.Request.ContentType
    if (-not $type) { $type = "application/json" }
    $request.ContentType = $type
    $request.ContentLength = $payload.Length
    $out = $request.GetRequestStream()
    $out.Write($payload, 0, $payload.Length)
    $out.Close()
  } elseif ($request.Method -eq "POST" -or $request.Method -eq "PUT" -or $request.Method -eq "PATCH") {
    # Sin esto, un POST sin cuerpo (cerrar sala, heartbeat, expulsar) sale sin
    # Content-Length y lo rechazan con 411.
    $request.ContentLength = 0
    $request.GetRequestStream().Close()
  }

  try {
    $response = $request.GetResponse()
  } catch [System.Net.WebException] {
    $response = $_.Exception.Response
    if (-not $response) {
      $context.Response.StatusCode = 502
      $msg = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"proxy: sin respuesta del worker"}')
      $context.Response.ContentType = "application/json; charset=utf-8"
      $context.Response.OutputStream.Write($msg, 0, $msg.Length)
      return
    }
  }

  $stream = $response.GetResponseStream()
  $memory = New-Object System.IO.MemoryStream
  $stream.CopyTo($memory)
  $bytes = $memory.ToArray()
  $memory.Close()
  $stream.Close()

  $context.Response.StatusCode = [int]$response.StatusCode
  $context.Response.ContentType = $response.ContentType
  $context.Response.Headers.Add("Cache-Control", "no-store")
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.Close()
}

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

    if ($path -eq "/api" -or $path.StartsWith("/api/")) {
      $rest = $path.Substring(4)
      if (-not $rest) { $rest = "/" }
      try {
        Send-ToWorker $context ($ApiTarget + $rest + $context.Request.Url.Query)
      } catch {
        $context.Response.StatusCode = 502
        $msg = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"proxy: ' + $_.Exception.Message.Replace('"', "'") + '"}')
        $context.Response.ContentType = "application/json; charset=utf-8"
        $context.Response.OutputStream.Write($msg, 0, $msg.Length)
      }
      $context.Response.OutputStream.Close()
      continue
    }

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

# Sync ftth-simulator-core.js inline into simulator.html (Virtual City only — no Leaflet)
$root = Split-Path -Parent $PSScriptRoot
$htmlPath = Join-Path $root 'simulator.html'
$corePath = Join-Path $root 'js\ftth-simulator-core.js'

$html = Get-Content $htmlPath -Raw -Encoding UTF8
$core = Get-Content $corePath -Raw -Encoding UTF8
$core = $core -replace '</script>', '<\/script>'

$newBlock = "  <script>`r`n" + $core + "`r`n  </script>`r`n"

$leafletPattern = '(?s)<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"[^>]*></script>\s*.*?(?=</body>)'
$inlinePattern = '(?s)(<script>\s*/\*\*\s*\r?\n \* FTTH Network Simulator)[\s\S]*?(?=</body>)'

if ($html -match $leafletPattern) {
  $html = [regex]::Replace($html, $leafletPattern, $newBlock)
} elseif ($html -match $inlinePattern) {
  $html = [regex]::Replace($html, $inlinePattern, $newBlock.TrimEnd())
} else {
  Write-Error 'Could not find Leaflet or inline FTTH script block in simulator.html'
  exit 1
}

[System.IO.File]::WriteAllText($htmlPath, $html, [System.Text.UTF8Encoding]::new($false))
$lines = (Get-Content $htmlPath | Measure-Object -Line).Lines
Write-Output ("Sync complete - simulator.html " + $lines + " lines")

# Merge js/simulator.js inline into simulator.html (self-contained single file)
$root = Split-Path -Parent $PSScriptRoot
$htmlPath = Join-Path $root 'simulator.html'
$jsPath = Join-Path $root 'js\simulator.js'

if (-not (Test-Path $htmlPath)) { Write-Error "Missing $htmlPath"; exit 1 }
if (-not (Test-Path $jsPath)) { Write-Error "Missing $jsPath"; exit 1 }

$html = Get-Content $htmlPath -Raw -Encoding UTF8
$js = Get-Content $jsPath -Raw -Encoding UTF8
$js = $js -replace '</script>', '<\/script>'

$old = '<script src="js/simulator.js"></script>'
$new = "<script>`r`n$js`r`n</script>"

if ($html -notlike "*$old*") {
  if ($html -match '<script>\s*/\*\*\s*\r?\n\s*\* FTTH Network Simulator') {
    Write-Output 'simulator.html already contains inline bundle — rebuilding inline section'
    $html = [regex]::Replace($html, '(?s)<script>\s*/\*\*\s*\r?\n\s*\* FTTH Network Simulator.*?</script>\s*(?=</body>)', $new)
  } else {
    Write-Error 'Could not find external script tag or existing inline bundle'
    exit 1
  }
} else {
  $html = $html.Replace($old, $new)
}

[System.IO.File]::WriteAllText($htmlPath, $html, [System.Text.UTF8Encoding]::new($false))
$lines = (Get-Content $htmlPath | Measure-Object -Line).Lines
Write-Output ("OK - simulator.html now self-contained (" + $lines + " lines)")

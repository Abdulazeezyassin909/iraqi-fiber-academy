# Bundles ES module sources into single simulator.js (file:// compatible)
$root = Split-Path -Parent $PSScriptRoot
$jsDir = Join-Path $root 'js'
$files = @(
  'simContext.js',
  'fiberMetrics.js',
  'gisEquipmentTypes.js',
  'gisIcons.js',
  'gisStore.js',
  'mapLayers.js',
  'zoomPanManager.js',
  'equipmentManager.js',
  'designPersistence.js',
  'propertyPanel.js',
  'gisProject.js',
  'cableEngine.js',
  'osmMapEngine.js',
  'gisMapRenderer.js',
  'gisConnections.js',
  'gisTopology.js',
  'gisNetworkZone.js',
  'gisCableRouting.js',
  'gisPlacement.js',
  'mapModeManager.js',
  'gisController.js',
  'mainSimulator.js'
)

$header = @"
/**
 * FTTH Network Simulator — unified bundle (file:// compatible)
 * Auto-generated — do not edit; change source modules and rebuild.
 */
(function () {
  'use strict';

"@

$footer = @"

})();
"@

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append($header)

foreach ($f in $files) {
  $path = Join-Path $jsDir $f
  if (-not (Test-Path $path)) { Write-Error "Missing $f"; exit 1 }
  $content = Get-Content $path -Raw -Encoding UTF8
  # Strip import lines (single-line and multi-line)
  $content = [regex]::Replace($content, '(?ms)^import\s+\{.*?\}\s+from\s+[^;]+;\s*\r?\n', '')
  $content = [regex]::Replace($content, '(?m)^import\s+.*?;\s*\r?\n', '')
  # export const/let/var/function -> bare declaration
  $content = $content -replace 'export const ', 'var '
  $content = $content -replace 'export let ', 'var '
  $content = $content -replace 'export var ', 'var '
  $content = $content -replace 'export function ', 'function '
  $content = $content -replace 'export default ', ''
  # const -> var so concatenated modules never throw duplicate-declaration SyntaxErrors
  $content = $content -replace '\bconst ', 'var '
  # Remove module header comments that reference imports
  [void]$sb.Append("`n  /* ===== $f ===== */`n")
  [void]$sb.Append($content)
  [void]$sb.Append("`n")
}

[void]$sb.Append($footer)
$outPath = Join-Path $jsDir 'simulator.js'
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
$lines = (Get-Content $outPath | Measure-Object -Line).Lines
Write-Output ("Bundled simulator.js - " + $lines + " lines")

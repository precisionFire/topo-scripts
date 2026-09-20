$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$displayRoot = Join-Path $root 'AriView\storage\displays\DaYeTeGang'
$localRoot   = Join-Path $root (-join [char[]](0x5927,0x51B6,0x7279,0x94A2)) 

$out = New-Object System.Collections.ArrayList
$rx = [regex]'https?://[A-Za-z0-9\.\-:_/]+'

[void]$out.Add('#################### DISPLAY JSON ####################')
foreach ($f in (Get-ChildItem -Path $displayRoot -Recurse -Filter *.json -File)) {
    $rel = $f.FullName.Substring($displayRoot.Length + 1)
    $t = [System.IO.File]::ReadAllText($f.FullName)
    $ms = $rx.Matches($t)
    $set = @{}
    foreach ($m in $ms) {
        $u = $m.Value
        if ($u -match '172\.15\.88\.243|bar\.dayesteel\.com\.cn') {
            if ($set.ContainsKey($u)) { $set[$u]++ } else { $set[$u] = 1 }
        }
    }
    if ($set.Count -eq 0) { continue }
    [void]$out.Add('')
    [void]$out.Add('--- ' + $rel)
    foreach ($k in ($set.Keys | Sort-Object)) {
        [void]$out.Add(('    x{0}  {1}' -f $set[$k], $k))
    }
}

[void]$out.Add('')
[void]$out.Add('#################### LOCAL JS ####################')
foreach ($f in (Get-ChildItem -Path $localRoot -Recurse -Filter *.js -File)) {
    $rel = $f.FullName.Substring($localRoot.Length + 1)
    $t = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    $ms = $rx.Matches($t)
    $set = @{}
    foreach ($m in $ms) {
        $u = $m.Value
        if ($u -match '172\.15\.88\.243|bar\.dayesteel\.com\.cn') {
            if ($set.ContainsKey($u)) { $set[$u]++ } else { $set[$u] = 1 }
        }
    }
    if ($set.Count -eq 0) { continue }
    [void]$out.Add('')
    [void]$out.Add('--- ' + $rel)
    foreach ($k in ($set.Keys | Sort-Object)) {
        [void]$out.Add(('    x{0}  {1}' -f $set[$k], $k))
    }
}

$outFile = Join-Path $env:TEMP 'api-report.txt'
[System.IO.File]::WriteAllLines($outFile, $out, (New-Object System.Text.UTF8Encoding $false))
Write-Output ('report -> ' + $outFile)

$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$dq = -join [char[]](0x5927, 0x51B6, 0x7279, 0x94A2)
$bc = -join [char[]](0x68D2, 0x6750, 0x5382)
$localRoot   = Join-Path (Join-Path $root $dq) $bc
$displayRoot = Join-Path $root 'AriView\storage\displays\DaYeTeGang'

function Get-Lines([string]$s) {
    $s = $s -replace "`r", ''
    $res = New-Object System.Collections.ArrayList
    foreach ($l in ($s -split "`n")) { [void]$res.Add($l) }
    return $res
}

$locals = @()
foreach ($f in (Get-ChildItem -Path $localRoot -Recurse -Filter *.js)) {
    $txt = [System.IO.File]::ReadAllText($f.FullName)
    $n = $txt -replace "`r", ''
    $lines = Get-Lines $txt
    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($l in $lines) { $t = $l.Trim(); if ($t.Length -gt 0) { [void]$set.Add($t) } }
    $locals += [pscustomobject]@{ Rel = $f.FullName.Substring($localRoot.Length + 1); Norm = $n; Lines = $lines; Set = $set }
}

$re = [regex]'"onPostDeserialize"\s*:\s*"((?:[^"\\]|\\.)*)"'
$out = New-Object System.Collections.ArrayList

foreach ($jf in (Get-ChildItem -Path $displayRoot -Recurse -Filter *.json)) {
    $rel = $jf.FullName.Substring($displayRoot.Length + 1)
    if ($rel -like ('*' + (-join [char[]](0x5907, 0x4EFD)) + '*')) { continue }   # skip BACKUP dir

    $raw = [System.IO.File]::ReadAllText($jf.FullName)
    $m = $re.Match($raw)
    if (-not $m.Success) { continue }
    $script = [regex]::Unescape(($m.Groups[1].Value -replace '\\/', '/'))
    $wrapper = 'not-found'
    $body = $script
    $p = '__ht__function(json, dm, view, datas) {'
    if ($body.StartsWith($p)) { $body = $body.Substring($p.Length); $wrapper = 'std' }
    if ($body.EndsWith('}')) { $body = $body.Substring(0, $body.Length - 1) }
    $sNorm = $body -replace "`r", ''
    $sLines = Get-Lines $body
    $sSet = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($l in $sLines) { $t = $l.Trim(); if ($t.Length -gt 0) { [void]$sSet.Add($t) } }

    $best = $null; $bestPct = -1
    foreach ($l in $locals) {
        $c = 0; foreach ($x in $l.Set) { if ($sSet.Contains($x)) { $c++ } }
        $p = 100.0 * $c / $l.Set.Count
        if ($p -gt $bestPct) { $bestPct = $p; $best = $l }
    }

    [void]$out.Add(('## JSON: {0}' -f $rel))
    [void]$out.Add(('   json lines={0} chars={1}   | best local = {2} ({3}%)' -f $sLines.Count, $script.Length, $best.Rel, [Math]::Round($bestPct, 1)))

    if ($sNorm.Contains($best.Norm)) {
        $idx = $sNorm.IndexOf($best.Norm)
        $pre = $sNorm.Substring(0, $idx)
        $suf = $sNorm.Substring($idx + $best.Norm.Length)
        [void]$out.Add(('   >>> EXACT (wrapper={0}): json script == stdWrapper + localContent + "}}"' -f $wrapper))
        if ($pre.Length -gt 0) { [void]$out.Add(('       extraPrefix: {0}' -f ($pre -replace "\s+", ' '))) }
        if ($suf.Length -gt 0) { [void]$out.Add(('       extraSuffix: {0}' -f ($suf -replace "\s+", ' '))) }
    }
    else {
        $n = [Math]::Min($sLines.Count, $best.Lines.Count)
        $i = 0
        while ($i -lt $n -and $sLines[$i].Trim() -eq $best.Lines[$i].Trim()) { $i++ }
        $j = 0
        while ($j -lt ($n - $i) -and $sLines[$sLines.Count - 1 - $j].Trim() -eq $best.Lines[$best.Lines.Count - 1 - $j].Trim()) { $j++ }
        $sl = $sLines.Count - $i - $j
        $ll = $best.Lines.Count - $i - $j
        [void]$out.Add(('   >>> DIFFERENT: commonHeadLines={0} commonTailLines={1}  jsonMiddle={2} localMiddle={3}' -f $i, $j, $sl, $ll))
        [void]$out.Add('       --- json middle (first 25) ---')
        $c = 0
        for ($k = $i; $k -lt $sLines.Count - $j -and $c -lt 25; $k++) { [void]$out.Add(('       J{0,5}: {1}' -f $k, $sLines[$k])); $c++ }
        [void]$out.Add('       --- local middle (first 25) ---')
        $c = 0
        for ($k = $i; $k -lt $best.Lines.Count - $j -and $c -lt 25; $k++) { [void]$out.Add(('       L{0,5}: {1}' -f $k, $best.Lines[$k])); $c++ }
    }
    [void]$out.Add('')
}

$outFile = Join-Path $env:TEMP 'jsonmap3-report.txt'
[System.IO.File]::WriteAllLines($outFile, $out, (New-Object System.Text.UTF8Encoding $false))
Write-Output ("report -> " + $outFile)
Write-Output ("lines  -> " + $out.Count)

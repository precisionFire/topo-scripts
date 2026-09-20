$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path

$dq = -join [char[]](0x5927, 0x51B6, 0x7279, 0x94A2)
$bc = -join [char[]](0x68D2, 0x6750, 0x5382)
$localRoot   = Join-Path (Join-Path $root $dq) $bc
$displayRoot = Join-Path $root 'AriView\storage\displays\DaYeTeGang'

function Get-Lines([string]$s) {
    if ($null -eq $s) { return @() }
    $s = $s -replace "`r", ''
    $arr = $s -split "`n"
    $res = New-Object System.Collections.ArrayList
    foreach ($l in $arr) {
        $t = $l.Trim()
        if ($t.Length -gt 0) { [void]$res.Add($t) }
    }
    return $res
}

# ---- local js ----
$locals = @()
foreach ($f in (Get-ChildItem -Path $localRoot -Recurse -Filter *.js)) {
    $txt = [System.IO.File]::ReadAllText($f.FullName)
    $lines = Get-Lines $txt
    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($l in $lines) { [void]$set.Add($l) }
    $locals += [pscustomobject]@{
        Rel   = $f.FullName.Substring($localRoot.Length + 1)
        Len   = $txt.Length
        Lines = $lines
        Set   = $set
    }
}

$re = [regex]'"onPostDeserialize"\s*:\s*"((?:[^"\\]|\\.)*)"'
$out = New-Object System.Collections.ArrayList

foreach ($jf in (Get-ChildItem -Path $displayRoot -Recurse -Filter *.json)) {
    $raw = [System.IO.File]::ReadAllText($jf.FullName)
    $rel = $jf.FullName.Substring($displayRoot.Length + 1)
    $m = $re.Match($raw)
    if (-not $m.Success) {
        [void]$out.Add(('## {0}  >> NO SCRIPT' -f $rel))
        [void]$out.Add('')
        continue
    }
    $script = [regex]::Unescape(($m.Groups[1].Value -replace '\\/', '/'))
    $sLines = Get-Lines $script

    [void]$out.Add(('## {0}' -f $rel))
    [void]$out.Add(('   script: lines={0}  chars={1}' -f $sLines.Count, $script.Length))
    [void]$out.Add(('   first: {0}' -f $(if ($sLines.Count -gt 0) { $sLines[0].Substring(0, [Math]::Min(90, $sLines[0].Length)) } else { '' })))
    [void]$out.Add(('   last : {0}' -f $(if ($sLines.Count -gt 0) { $sLines[$sLines.Count - 1].Substring(0, [Math]::Min(90, $sLines[$sLines.Count - 1].Length)) } else { '' })))

    $sSet = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($l in $sLines) { [void]$sSet.Add($l) }

    $rank = @()
    foreach ($l in $locals) {
        $common = 0
        foreach ($x in $l.Set) { if ($sSet.Contains($x)) { $common++ } }
        if ($l.Set.Count -gt 0) {
            $pct = [Math]::Round(100.0 * $common / $l.Set.Count, 1)
        } else { $pct = 0 }
        # lines in local but not in json (local ahead)
        $ahead = $l.Set.Count - $common
        $rank += [pscustomobject]@{ Rel = $l.Rel; Common = $common; Pct = $pct; Ahead = $ahead; LLines = $l.Lines.Count }
    }
    $rank = $rank | Sort-Object -Property Pct -Descending
    foreach ($r in ($rank | Select-Object -First 3)) {
        [void]$out.Add(('   match {0,5}%  shared={1,5}  localOnly={2,5}  localLines={3,5}  {4}' -f $r.Pct, $r.Common, $r.Ahead, $r.LLines, $r.Rel))
    }
    [void]$out.Add('')
}

$outFile = Join-Path $env:TEMP 'jsonmap2-report.txt'
[System.IO.File]::WriteAllLines($outFile, $out, (New-Object System.Text.UTF8Encoding $false))
Write-Output ("report -> " + $outFile)
Write-Output ("lines  -> " + $out.Count)

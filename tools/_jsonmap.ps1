$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path

# build Chinese dir names from code points to avoid GBK mangling
$dq = -join [char[]](0x5927, 0x51B6, 0x7279, 0x94A2)   # DaYeTeGang (CN)
$bc = -join [char[]](0x68D2, 0x6750, 0x5382)           # BangCaiChang (CN)

$localRoot   = Join-Path (Join-Path $root $dq) $bc
$displayRoot = Join-Path $root 'AriView\storage\displays\DaYeTeGang'

$lines = New-Object System.Collections.ArrayList

function Norm([string]$s) {
    if ($null -eq $s) { return '' }
    return ($s -replace "`r", '').Trim()
}

# ---- collect local js ----
$locals = @()
foreach ($f in (Get-ChildItem -Path $localRoot -Recurse -Filter *.js)) {
    $txt = [System.IO.File]::ReadAllText($f.FullName)
    $rel = $f.FullName.Substring($localRoot.Length + 1)
    $head = (($txt -split "`n") | Select-Object -First 6) -join ' | '
    $head = ($head -replace "`r", '').Trim()
    $locals += [pscustomobject]@{
        Rel  = $rel
        Len  = $txt.Length
        Norm = (Norm $txt)
        NormLen = (Norm $txt).Length
        Head = $head
    }
    [void]$lines.Add(('LOCAL  len={0,-7} {1}' -f $txt.Length, $rel))
}

[void]$lines.Add('')
[void]$lines.Add('================ JSON MAP ================')
[void]$lines.Add('')

$re = [regex]'"onPostDeserialize"\s*:\s*"((?:[^"\\]|\\.)*)"'

foreach ($jf in (Get-ChildItem -Path $displayRoot -Recurse -Filter *.json)) {
    $raw = [System.IO.File]::ReadAllText($jf.FullName)
    $rel = $jf.FullName.Substring($displayRoot.Length + 1)
    $m = $re.Match($raw)
    if (-not $m.Success) {
        [void]$lines.Add(('JSON   {0}  >> NO onPostDeserialize' -f $rel))
        continue
    }
    $enc = $m.Groups[1].Value
    $enc = $enc -replace '\\/', '/'
    $script = [regex]::Unescape($enc)
    $sn = Norm $script

    $best = $null; $bestDiff = [int]::MaxValue; $exact = $false
    foreach ($l in $locals) {
        $d = [Math]::Abs($l.NormLen - $sn.Length)
        if ($d -lt $bestDiff) { $bestDiff = $d; $best = $l }
    }
    if ($best -and $sn -eq $best.Norm) { $exact = $true }

    $head = ($sn -replace "`r", '')
    $head = ($head -replace "\s+", ' ')
    if ($head.Length -gt 160) { $head = $head.Substring(0, 160) }

    [void]$lines.Add(('JSON   {0}' -f $rel))
    [void]$lines.Add(('       scriptLen={0}  best={1}  diff={2}  exact={3}' -f $sn.Length, ($(if ($best) { $best.Rel } else { 'NONE' })), $bestDiff, $exact))
    [void]$lines.Add(('       head: {0}' -f $head))
    [void]$lines.Add('')
}

$outFile = Join-Path $env:TEMP 'jsonmap-report.txt'
[System.IO.File]::WriteAllLines($outFile, $lines, (New-Object System.Text.UTF8Encoding $false))
Write-Output ("report -> " + $outFile)
Write-Output ("lines  -> " + $lines.Count)

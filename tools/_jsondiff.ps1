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

$locals = @{}
foreach ($f in (Get-ChildItem -Path $localRoot -Recurse -Filter *.js)) {
    $rel = $f.FullName.Substring($localRoot.Length + 1)
    $txt = [System.IO.File]::ReadAllText($f.FullName)
    $locals[$rel] = Get-Lines $txt
}

$re = [regex]'"onPostDeserialize"\s*:\s*"((?:[^"\\]|\\.)*)"'
$out = New-Object System.Collections.ArrayList

# local -> json mapping confirmed by prior report
$pairs = @(
    @{ J = '小棒线加热炉.json';     L = ((-join [char[]](0x5C0F,0x68D2,0x7EBF)) + '\' + (-join [char[]](0x5C0F,0x68D2,0x7EBF,0x52A0,0x70ED,0x7089)) + '.js') },
    @{ J = '小棒线一号加热炉.json'; L = ((-join [char[]](0x5C0F,0x68D2,0x7EBF)) + '\' + (-join [char[]](0x5C0F,0x68D2,0x7EBF,0x52A0,0x70ED,0x7089)) + '.js') },
    @{ J = '小棒线二号加热炉.json'; L = ((-join [char[]](0x5C0F,0x68D2,0x7EBF)) + '\' + (-join [char[]](0x5C0F,0x68D2,0x7EBF,0x52A0,0x70ED,0x7089)) + '.js') },
    @{ J = '扁棒线加热炉.json';     L = ((-join [char[]](0x6241,0x68D2,0x7EBF)) + '\' + (-join [char[]](0x6241,0x68D2,0x7EBF,0x52A0,0x70ED,0x7089)) + '.js') }
)

foreach ($p in $pairs) {
    $jf = Join-Path $displayRoot $p.J
    $raw = [System.IO.File]::ReadAllText($jf)
    $m = $re.Match($raw)
    if (-not $m.Success) { [void]$out.Add("!! no script in $($p.J)"); continue }
    $script = [regex]::Unescape(($m.Groups[1].Value -replace '\\/', '/'))
    $body = $script
    $pre = '__ht__function(json, dm, view, datas) {'
    if ($body.StartsWith($pre)) { $body = $body.Substring($pre.Length) }
    if ($body.EndsWith('}')) { $body = $body.Substring(0, $body.Length - 1) }
    $jl = Get-Lines $body
    $ll = $locals[$p.L]

    [void]$out.Add(('===== {0}   vs   {1}' -f $p.J, $p.L))
    [void]$out.Add(('   jsonLines={0}  localLines={1}' -f $jl.Count, $ll.Count))

    if ($jl.Count -eq $ll.Count) {
        $n = 0
        for ($i = 0; $i -lt $jl.Count; $i++) {
            if ($jl[$i].Trim() -ne $ll[$i].Trim()) {
                $n++
                if ($n -le 40) {
                    [void]$out.Add(('   [{0}] ' -f $i))
                    [void]$out.Add(('       J: {0}' -f $jl[$i].Trim()))
                    [void]$out.Add(('       L: {0}' -f $ll[$i].Trim()))
                }
            }
        }
        [void]$out.Add(('   >>> differing lines (same count): {0}' -f $n))
    }
    else {
        $js = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($l in $jl) { $t = $l.Trim(); if ($t) { [void]$js.Add($t) } }
        $ls = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($l in $ll) { $t = $l.Trim(); if ($t) { [void]$ls.Add($t) } }
        [void]$out.Add('   >>> line count differs -> set diff')
        [void]$out.Add('   --- only in JSON (first 20) ---')
        $c = 0; foreach ($x in $js) { if (-not $ls.Contains($x) -and $c -lt 20) { [void]$out.Add('       Jonly: ' + $x); $c++ } }
        [void]$out.Add('   --- only in LOCAL (first 20) ---')
        $c = 0; foreach ($x in $ls) { if (-not $js.Contains($x) -and $c -lt 20) { [void]$out.Add('       Lonly: ' + $x); $c++ } }
    }
    [void]$out.Add('')
}

$outFile = Join-Path $env:TEMP 'jsondiff-report.txt'
[System.IO.File]::WriteAllLines($outFile, $out, (New-Object System.Text.UTF8Encoding $false))
Write-Output ('report -> ' + $outFile)

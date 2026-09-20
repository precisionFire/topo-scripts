$displayRoot = Join-Path (Get-Location).Path 'AriView\storage\displays\DaYeTeGang'
$out = New-Object System.Collections.ArrayList
foreach ($f in (Get-ChildItem -Path $displayRoot -Filter *.json -File)) {
    $t = [System.IO.File]::ReadAllText($f.FullName)
    $c1 = ([regex]::Matches($t, 'onPostDeserialize')).Count
    $c2 = ([regex]::Matches($t, '__ht__function')).Count
    [void]$out.Add(('=== ' + $f.Name + '  onPostDeserialize=' + $c1 + '  __ht__function=' + $c2))
    $i = 0; $n = 0
    while ((($i = $t.IndexOf('/SLAB/IN', $i)) -ge 0) -and $n -lt 2) {
        $s = [Math]::Max(0, $i - 120)
        $len = [Math]::Min(230, $t.Length - $s)
        [void]$out.Add(('   [SLAB/IN @' + $i + '] ' + ($t.Substring($s, $len) -replace "`r", '' -replace "`n", '<LF>')))
        $i += 8; $n++
    }
}
$outFile = Join-Path $env:TEMP 'probe2-report.txt'
[System.IO.File]::WriteAllLines($outFile, $out, (New-Object System.Text.UTF8Encoding $false))
Write-Output ('report -> ' + $outFile)

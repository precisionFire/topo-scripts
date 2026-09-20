$displayRoot = Join-Path (Get-Location).Path 'AriView\storage\displays\DaYeTeGang'
$needles = @('172.15.88.243', 'bar.dayesteel.com.cn')
foreach ($f in (Get-ChildItem -Path $displayRoot -Filter *.json -File)) {
    $t = [System.IO.File]::ReadAllText($f.FullName)
    Write-Output ('##### ' + $f.Name + '  len=' + $t.Length)
    foreach ($n in $needles) {
        $i = 0
        while (($i = $t.IndexOf($n, $i)) -ge 0) {
            $s = [Math]::Max(0, $i - 55)
            $len = [Math]::Min(150, $t.Length - $s)
            Write-Output ('  [' + $n + ' @' + $i + '] ' + ($t.Substring($s, $len) -replace "`n", '<LF>') -replace "`r", '')
            $i += $n.Length
        }
    }
}

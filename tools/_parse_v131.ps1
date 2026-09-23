$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    'd:\工作文件\代码仓库\topo-scripts\tools\net-route-switch.ps1', [ref]$tokens, [ref]$errors)
if ($errors.Count -eq 0) { '语法 OK' }
else { $errors | ForEach-Object { 'ERR: ' + $_.ToString() } }
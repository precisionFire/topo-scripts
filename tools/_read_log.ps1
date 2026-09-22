$log = Join-Path $env:LOCALAPPDATA 'net-route-switch\last-run.log'
if (Test-Path $log) {
    Get-Content $log -Encoding UTF8
} else {
    'last-run.log 不存在'
}
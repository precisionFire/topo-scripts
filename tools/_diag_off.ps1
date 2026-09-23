$ErrorActionPreference = 'Continue'
'===== 当前网卡状态 ====='
Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -or $_.Name -in 'WLAN', '以太网' } |
    Select-Object Name, Status, LinkSpeed, InterfaceDescription | Format-Table -AutoSize

'===== 接口度量（自动/手工） ====='
Get-NetIPInterface -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -in 'WLAN', '以太网' } |
    Select-Object InterfaceAlias, InterfaceMetric, AutomaticMetric | Format-Table -AutoSize

'===== 默认路由 ====='
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object { $_.RouteMetric + $_.InterfaceMetric } |
    Select-Object InterfaceAlias, NextHop, @{n = '有效'; e = { $_.RouteMetric + $_.InterfaceMetric } }, State | Format-Table -AutoSize

'===== 172 静态路由（如果有） ====='
Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.DestinationPrefix -like '172.*' } |
    Select-Object DestinationPrefix, NextHop, InterfaceAlias, State | Format-Table -AutoSize

'===== 状态文件 ====='
if (Test-Path $env:LOCALAPPDATA\net-route-switch\state.json) {
    Get-Content $env:LOCALAPPDATA\net-route-switch\state.json -Raw
}
else { '（无状态文件）' }

'===== 以太网连通性 ====='
$ethIp = (Get-NetIPAddress -InterfaceAlias '以太网' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
"以太网 IP = $ethIp"
if ($ethIp) {
    ping.exe -n 2 -w 1000 -S $ethIp 192.168.124.1
    ping.exe -n 2 -w 1000 -S $ethIp 223.5.5.5
}
else { '以太网没有 IPv4' }

'===== WLAN 连通性 ====='
$wIp = (Get-NetIPAddress -InterfaceAlias 'WLAN' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
if ($wIp) {
    ping.exe -n 2 -w 1000 -S $wIp 223.5.5.5
}

'===== 注册表手工度量残留 ====='
Get-NetAdapter | Where-Object { $_.Name -in 'WLAN', '以太网' } | ForEach-Object {
    $key = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\' + $_.InterfaceGuid
    $m = (Get-ItemProperty -Path $key -Name 'InterfaceMetric' -ErrorAction SilentlyContinue).InterfaceMetric
    '{0}: 注册表 InterfaceMetric = {1}' -f $_.Name, $(if ($null -eq $m) { '(未设置=自动)' } else { $m })
}

'===== 最近一次运行日志 ====='
Get-Content $env:LOCALAPPDATA\net-route-switch\last-run.log -Tail 40 -ErrorAction SilentlyContinue
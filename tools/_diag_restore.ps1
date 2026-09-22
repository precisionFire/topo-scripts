$StatePath = Join-Path $env:LOCALAPPDATA 'net-route-switch\state.json'
if (Test-Path $StatePath) {
    '===== state.json ====='
    Get-Content $StatePath -Raw -Encoding UTF8
} else {
    'state.json 不存在（说明 off 已清掉状态文件）'
}

''
'===== 两张网卡当前度量 ====='
Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -in @('WLAN', '以太网') } |
    Select-Object InterfaceAlias, InterfaceIndex, InterfaceMetric, AutomaticMetric |
    Format-Table -AutoSize

'===== 注册表持久存储里的手工度量 ====='
foreach ($alias in @('WLAN', '以太网')) {
    $ad = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Name -eq $alias
    if ($ad) {
        $key = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\' + $ad.InterfaceGuid
        $m = (Get-ItemProperty -Path $key -Name 'InterfaceMetric' -ErrorAction SilentlyContinue).InterfaceMetric
        '{0}  ifIndex={1}  注册表 InterfaceMetric={2}' -f $alias, $ad.ifIndex, $(if ($null -ne $m) { $m } else { '(无)' })
    }
}

''
'===== 172.x 静态路由是否还在 ====='
Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.Protocol -eq 'NetMgmt' } |
    Select-Object DestinationPrefix, InterfaceAlias, NextHop, RouteMetric |
    Format-Table -AutoSize

''
'===== 默认路由 ====='
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object { $_.RouteMetric + $_.InterfaceMetric } |
    Select-Object InterfaceAlias, NextHop, RouteMetric, InterfaceMetric |
    Format-Table -AutoSize
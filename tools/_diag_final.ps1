'===== 以太网配置 ====='
$cfg = Get-NetIPConfiguration -InterfaceAlias '以太网'
[pscustomobject]@{
    IP  = $cfg.IPv4Address.IPAddress
    网关 = $cfg.IPv4DefaultGateway.NextHop
    DNS = ($cfg.DNSServer | Where-Object AddressFamily -eq 2).ServerAddresses -join ','
} | Format-List

'===== 网线出口测试 ====='
ping.exe -n 2 -w 1000 -S 192.168.124.2 223.5.5.5
ping.exe -n 1 -w 1500 www.baidu.com

'===== 残留的 172 手工路由（off 时会清掉） ====='
Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.DestinationPrefix -like '172.*' -and $_.Protocol -eq 'NetMgmt' } |
    Select-Object DestinationPrefix, NextHop, InterfaceAlias | Format-Table -AutoSize

'===== 默认路由 ====='
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object { $_.RouteMetric + $_.InterfaceMetric } |
    Select-Object InterfaceAlias, NextHop, RouteMetric, InterfaceMetric | Format-Table -AutoSize
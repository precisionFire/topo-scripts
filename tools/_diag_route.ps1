'===== 以太网(ifIndex=3)上的全部 IPv4 路由 ====='
Get-NetRoute -InterfaceIndex 3 -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Select-Object DestinationPrefix, NextHop, Protocol, RouteMetric, InterfaceMetric, State |
    Format-Table -AutoSize

'===== 全路由表里 172 开头的条目 ====='
Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.DestinationPrefix -like '172.*' } |
    Select-Object DestinationPrefix, InterfaceAlias, NextHop, Protocol, RouteMetric, InterfaceMetric |
    Format-Table -AutoSize

'===== Find-NetRoute 原始结果：172.15.156.254 ====='
Find-NetRoute -RemoteIPAddress 172.15.156.254 | Format-List InterfaceAlias, InterfaceIndex, NextHop, DestinationPrefix

'===== 强制从以太网源地址 ping 网关 ====='
ping.exe -n 2 -w 1500 -S 172.15.156.180 172.15.156.254

'===== 以太网链路速度 ====='
Get-NetAdapter -InterfaceIndex 3 | Select-Object Name, Status, LinkSpeed, FullDuplex | Format-List
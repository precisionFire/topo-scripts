<#
 * ============================================================
 *  网络路由开关  net-route-switch.ps1
 * ============================================================
 *  适用场景：WiFi 连内网、USB(手机共享 / NDIS 网卡) 连外网，
 *            把两条出口的分工一键固定下来并可随时关闭。
 *
 *  开启(on)：
 *    · USB 网卡接口度量压低（= 外网默认出口）
 *    · WiFi 网卡接口度量抬高（不再抢默认路由）
 *    · 配置里的内网网段加静态路由，指向 WiFi 网关
 *  关闭(off)：
 *    · 删除本脚本加的静态路由，网卡度量恢复为系统自动
 *
 *  用法：
 *    net-route-switch.bat                     # 双击，进交互菜单（会自动提权）
 *    .\net-route-switch.ps1 -Action on        # 开启
 *    .\net-route-switch.ps1 -Action off       # 关闭
 *    .\net-route-switch.ps1 -Action status    # 查看状态
 *    .\net-route-switch.ps1 -Action on -Prefix 10.0.0.0/8,172.16.0.0/12,10.1.2.3
 *
 *  说明：
 *    · 改路由 / 网卡度量需要管理员权限，脚本会自动弹 UAC 提权。
 *    · 静态路由写在 ActiveStore，不落盘，重启或重连网卡后自动消失。
 *    · 只动本脚本自己加的东西，关闭时按状态文件精确还原。
 *    · 运行过程同步写日志：%LOCALAPPDATA%\net-route-switch\last-run.log
 *
 * 【版本记录】
 *  v1.0  2026-09-11  初版：WiFi 内网 / USB 外网 一键开关
 *  v1.1  2026-09-11  修三处：① 网段解析把 172.0.0.0/8 错解析成 /0（嵌套捕获组取值错位）；
 *                    ② 关闭时未清理持久存储里的手工度量，网卡一重连旧度量又生效；
 *                    ③ 补运行日志与主流程异常捕获，提权窗口的报错可回查。
 #>

[CmdletBinding()]
param(
    [ValidateSet('menu', 'on', 'off', 'status')]
    [string]$Action = 'menu',

    # 临时追加的内网网段或单机地址，逗号分隔
    [string[]]$Prefix = @(),

    # 提权后的窗口结束时保持不关（内部使用）
    [switch]$Pause
)

$ErrorActionPreference = 'Stop'

# ==================== 配置区（按需修改） ====================
$Config = [ordered]@{
    # 网卡识别关键词（匹配 网卡名 + 描述，忽略大小写）
    WifiMatch           = @('Wi-?Fi', 'Wireless', 'WLAN', '802\.11', '无线')
    UsbMatch            = @('NDIS', 'RNDIS', 'USB', 'Tethering', 'Sharing')

    # 内网网段：这些地址走 WiFi 网关（留空 = 只靠 WiFi 直连网段）
    # 实测：bar.dayesteel.com.cn → 172.15.115.121，内网 DNS 172.15.88.1 / 172.15.88.2
    # 单个 IP 写法按 /32 处理；想更精确可把 172.0.0.0/8 收窄为 172.15.0.0/16
    IntranetPrefixes    = @('172.0.0.0/8')

    # 状态检查时要探活的内网目标
    IntranetProbes      = @('bar.dayesteel.com.cn', '172.15.88.1')

    # 外网探活目标
    InternetProbes      = @('223.5.5.5', 'www.baidu.com')

    # 接口度量：数值越小优先级越高
    UsbInterfaceMetric  = 10     # USB = 外网默认出口
    WifiInterfaceMetric = 60     # WiFi 不参与默认路由竞争

    # 内网静态路由的度量（越小越优先，1 基本必胜）
    IntranetRouteMetric = 1
}
# ==========================================================

$StatePath = Join-Path $env:LOCALAPPDATA 'net-route-switch\state.json'
$LogPath = Join-Path $env:LOCALAPPDATA 'net-route-switch\last-run.log'

# ---------------------- 输出辅助 ----------------------
# 提权窗口一闪而过，输出看不到，所以同步落一份日志到 last-run.log
function Add-Log([string]$level, [string]$text) {
    try {
        $dir = Split-Path $LogPath
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path $LogPath -Value ("[{0}] [{1}] {2}" -f (Get-Date).ToString('HH:mm:ss'), $level, $text) `
            -Encoding UTF8
    }
    catch { }
}

function Write-Head([string]$text) { Write-Host ''; Write-Host "==== $text ====" -ForegroundColor Cyan; Add-Log 'HEAD' $text }
function Write-Ok([string]$text) { Write-Host "  [OK]   $text" -ForegroundColor Green; Add-Log 'OK' $text }
function Write-Note([string]$text) { Write-Host "  [提示] $text" -ForegroundColor Yellow; Add-Log '提示' $text }
function Write-Fail([string]$text) { Write-Host "  [失败] $text" -ForegroundColor Red; Add-Log '失败' $text }
function Write-Dim([string]$text) { Write-Host "  $text" -ForegroundColor DarkGray; Add-Log 'INFO' $text }

# 表格：屏幕与日志各输出一份
function Write-Table($data) {
    $text = ($data | Out-String).TrimEnd()
    if ($text) { Write-Host $text }
    Add-Log 'TABLE' $text
}

function Test-Pattern([string]$text, [string[]]$patterns) {
    foreach ($p in $patterns) { if ($text -match $p) { return $true } }
    return $false
}

function Test-Admin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object System.Security.Principal.WindowsPrincipal $id).IsInRole(
        [System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Elevate {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'),
        '-Action', $Action, '-Pause')
    if ($Prefix.Count -gt 0) { $argList += @('-Prefix', ($Prefix -join ',')) }
    Write-Note '需要管理员权限，正在弹出 UAC 提权窗口…'
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs | Out-Null
}

# ---------------------- 网卡 / IP ----------------------
function Get-Adapters {
    try { $all = Get-NetAdapter -Physical -ErrorAction Stop }
    catch { $all = Get-NetAdapter }
    $up = @($all | Where-Object {
            $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Bluetooth|Sangfor|VNIC|Loopback'
        })

    $wifi = @($up | Where-Object { Test-Pattern "$($_.Name) $($_.InterfaceDescription)" $Config.WifiMatch } |
        Select-Object -First 1)
    $rest = @($up | Where-Object { -not $wifi -or $_.ifIndex -ne $wifi.ifIndex })

    $usb = @($rest | Where-Object { Test-Pattern "$($_.Name) $($_.InterfaceDescription)" $Config.UsbMatch } |
        Select-Object -First 1)
    if (-not $usb) {
        $usb = @($rest | Where-Object {
                (Get-NetIPConfiguration -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue).IPv4DefaultGateway
            } | Select-Object -First 1)
    }

    [pscustomobject]@{ Wifi = $wifi; Usb = $usb }
}

function Get-IpInfo([int]$ifIndex) {
    $addr = @(Get-NetIPAddress -InterfaceIndex $ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1)
    $cfg = Get-NetIPConfiguration -InterfaceIndex $ifIndex -ErrorAction SilentlyContinue
    $ni = Get-NetIPInterface -InterfaceIndex $ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue

    [pscustomobject]@{
        IfIndex      = $ifIndex
        IPAddress    = if ($addr) { $addr.IPAddress } else { $null }
        PrefixLength = if ($addr) { $addr.PrefixLength } else { $null }
        OnLinkPrefix = if ($addr) { ConvertFrom-NetworkAddress $addr.IPAddress $addr.PrefixLength } else { $null }
        Gateway      = ($cfg.IPv4DefaultGateway | Select-Object -First 1).NextHop
        Metric       = $ni.InterfaceMetric
    }
}

# ---------------------- 网段计算 ----------------------
function ConvertTo-IpInt([string]$ip) {
    $b = [System.Net.IPAddress]::Parse($ip).GetAddressBytes()
    [uint32](([uint32]$b[0] -shl 24) -bor ([uint32]$b[1] -shl 16) -bor ([uint32]$b[2] -shl 8) -bor [uint32]$b[3])
}

function ConvertFrom-IpInt([uint32]$value) {
    '{0}.{1}.{2}.{3}' -f (($value -shr 24) -band 255), (($value -shr 16) -band 255),
    (($value -shr 8) -band 255), ($value -band 255)
}

# 把 IP + 掩码长度 规格化成 "网络地址/长度"
function ConvertFrom-NetworkAddress([string]$ip, [int]$length) {
    if ($length -le 0) { return "$ip/0" }
    if ($length -ge 32) { return "$ip/32" }
    $value = ConvertTo-IpInt $ip
    $mask = [uint32]([uint32]::MaxValue -shl (32 - $length))
    "$(ConvertFrom-IpInt ($value -band $mask))/$length"
}

# 解析 -Prefix 里的网段写法：支持 "10.0.0.0/8" 与单机 "10.1.2.3"（按 /32）
function Resolve-Prefix([string]$text) {
    $t = $text.Trim()
    # 用命名组，避免嵌套捕获组把掩码长度取成 $Matches[2]
    if ($t -match '^(?<ip>\d{1,3}(?:\.\d{1,3}){3})$') { return "$t/32" }
    if ($t -match '^(?<ip>\d{1,3}(?:\.\d{1,3}){3})/(?<len>\d{1,2})$') {
        try { return ConvertFrom-NetworkAddress $Matches['ip'] ([int]$Matches['len']) }
        catch { return $null }
    }
    return $null
}

# ---------------------- 度量 ----------------------
function Get-IfMetricSnapshot([int]$ifIndex) {
    $ni = Get-NetIPInterface -InterfaceIndex $ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Index     = $ifIndex
        Automatic = [string]$ni.AutomaticMetric
        Interface = $ni.InterfaceMetric
    }
}

function Get-InterfaceRegKey([int]$ifIndex) {
    $ad = Get-NetAdapter -InterfaceIndex $ifIndex -ErrorAction SilentlyContinue
    if (-not $ad -or -not $ad.InterfaceGuid) { return $null }
    return 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\' + $ad.InterfaceGuid
}

# 恢复一张网卡的接口度量
#   ⚠ Set-NetIPInterface -InterfaceMetric 除了改活动存储，还会把手工程度量写进注册表（持久存储）；
#     只恢复活动存储的话，网卡重连（USB 共享很常见）时旧值会再次生效，所以这里连带清理持久存储。
#   $appliedMetric：本次开启写进去的值（或候选值数组），只有注册表里的值属于本次写入才删。
function Restore-IfMetric($snap, [string]$name, $appliedMetric) {
    if (-not $snap) { return }
    $idx = [int]$snap.Index
    $origAuto = ($snap.Automatic -eq 'Enabled')

    # 1) 活动存储：恢复自动 / 恢复原数值
    try {
        if ($origAuto) {
            Set-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -AutomaticMetric Enabled -ErrorAction Stop
            Write-Ok ("{0} 活动存储已恢复自动度量" -f $name)
        }
        elseif ($null -ne $snap.Interface) {
            Set-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -InterfaceMetric ([int]$snap.Interface) -ErrorAction Stop
            Write-Ok ("{0} 活动存储已恢复原度量 {1}" -f $name, $snap.Interface)
        }
    }
    catch { Write-Fail ("{0} 活动存储恢复失败：{1}" -f $name, $_.Exception.Message) }

    # 2) 持久存储（注册表）
    $key = Get-InterfaceRegKey $idx
    if ($key) {
        $cur = (Get-ItemProperty -Path $key -Name 'InterfaceMetric' -ErrorAction SilentlyContinue).InterfaceMetric
        if ($null -eq $cur) {
            Write-Dim ("{0} 注册表无手工度量，无需处理" -f $name)
        }
        elseif (-not $origAuto) {
            Set-ItemProperty -Path $key -Name 'InterfaceMetric' -Value ([int]$snap.Interface) -Type DWord `
                -ErrorAction SilentlyContinue
            Write-Ok ("{0} 注册表手工度量恢复为 {1}" -f $name, $snap.Interface)
        }
        elseif ($null -ne $appliedMetric -and ($cur -in $appliedMetric)) {
            Remove-ItemProperty -Path $key -Name 'InterfaceMetric' -ErrorAction SilentlyContinue
            Write-Ok ("{0} 已清除本次写入注册表的手工度量 {1}" -f $name, $cur)
        }
        else {
            Write-Note ("{0} 注册表存在手工度量 {1}（非本次写入，保留不动）" -f $name, $cur)
        }
    }

    # 3) 现状
    $now = Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue
    if ($now) {
        Write-Dim ("{0} 度量现状：{1}（AutomaticMetric={2}）" -f $name, $now.InterfaceMetric, $now.AutomaticMetric)
    }
}

# ---------------------- 静态路由 ----------------------
function Add-IntranetRoute([string]$prefix, [int]$ifIndex, [string]$nextHop, [int]$metric) {
    $exist = @(Get-NetRoute -InterfaceIndex $ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.DestinationPrefix -eq $prefix -and $_.NextHop -eq $nextHop })
    if ($exist.Count -gt 0) { return 'exists' }
    New-NetRoute -DestinationPrefix $prefix -InterfaceIndex $ifIndex -NextHop $nextHop `
        -RouteMetric $metric -PolicyStore ActiveStore -ErrorAction Stop | Out-Null
    return 'added'
}

# 永不触碰的网段（默认路由 / 广播 / 组播），防止误删系统路由
$ProtectedPrefixes = @('0.0.0.0/0', '255.255.255.255/32', '224.0.0.0/4')

function Remove-IntranetRoute([string]$prefix, [int]$ifIndex, [string]$nextHop) {
    if ($ProtectedPrefixes -contains $prefix) { return $false }
    $rt = @(Get-NetRoute -InterfaceIndex $ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.DestinationPrefix -eq $prefix -and $_.Protocol -eq 'NetMgmt' -and $_.NextHop -eq $nextHop })
    if ($rt.Count -eq 0) { return $false }
    $rt | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    return $true
}

# ---------------------- 状态文件 ----------------------
function Read-State {
    if (-not (Test-Path $StatePath)) { return $null }
    try { return (Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Save-State($obj) {
    $dir = Split-Path $StatePath
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $obj | ConvertTo-Json -Depth 6 | Set-Content -Path $StatePath -Encoding UTF8
}

# ---------------------- 出口探测 ----------------------
function Get-ExitPath([string]$target) {
    $ip = $target
    if ($target -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
        try {
            $ip = ([System.Net.Dns]::GetHostAddresses($target) |
                Where-Object { $_.AddressFamily.ToString() -eq 'InterNetwork' } |
                Select-Object -First 1).IPAddressToString
        }
        catch { $ip = $null }
    }
    if (-not $ip) {
        return [pscustomobject]@{ 目标 = $target; 解析IP = '-'; 出口网卡 = '-'; 下一跳 = '-'; 结果 = 'DNS 解析失败' }
    }

    $route = $null
    try {
        $route = Find-NetRoute -RemoteIPAddress $ip -ErrorAction Stop |
            Where-Object { $_.NextHop } | Select-Object -First 1
    }
    catch { }

    $null = & ping.exe -n 2 -w 1200 $ip 2>$null
    $ok = ($LASTEXITCODE -eq 0)

    [pscustomobject]@{
        目标     = $target
        解析IP   = $ip
        出口网卡 = if ($route) { $route.InterfaceAlias } else { '?' }
        下一跳   = if ($route) { $route.NextHop } else { '?' }
        结果     = if ($ok) { '可通' } else { '不通' }
    }
}

# ---------------------- 查看状态 ----------------------
function Show-Status {
    Write-Head '当前网络路由状态'
    $ad = Get-Adapters

    $rows = @()
    foreach ($item in @(
            [pscustomobject]@{ 角色 = 'WiFi(内网)'; Adapter = $ad.Wifi },
            [pscustomobject]@{ 角色 = 'USB(外网)'; Adapter = $ad.Usb }
        )) {
        $a = $item.Adapter
        if (-not $a) {
            $rows += [pscustomobject]@{ 角色 = $item.角色; 网卡 = '未找到已连接的网卡'; IP = '-'; 网关 = '-'; 度量 = '-' }
            continue
        }
        $i = Get-IpInfo $a.ifIndex
        $rows += [pscustomobject]@{
            角色 = $item.角色; 网卡 = $a.Name
            IP   = if ($i.IPAddress) { "$($i.IPAddress)/$($i.PrefixLength)" } else { '-' }
            网关 = if ($i.Gateway) { $i.Gateway } else { '-' }
            度量 = $i.Metric
        }
    }
    Write-Table ($rows | Format-Table -AutoSize)

    Write-Dim '默认路由（越靠前越优先）：'
    Write-Table (Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
        Sort-Object { $_.RouteMetric + $_.InterfaceMetric } |
        Select-Object @{ n = '网卡'; e = { $_.InterfaceAlias } }, NextHop,
        @{ n = '路由度量'; e = { $_.RouteMetric } }, @{ n = '接口度量'; e = { $_.InterfaceMetric } } |
        Format-Table -AutoSize)

    if ($ad.Wifi) {
        Write-Dim 'WiFi 上的手工静态路由：'
        $sr = @(Get-NetRoute -InterfaceIndex $ad.Wifi.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.Protocol -eq 'NetMgmt' -and $ProtectedPrefixes -notcontains $_.DestinationPrefix })
        if ($sr.Count -gt 0) {
            Write-Table ($sr | Select-Object DestinationPrefix, NextHop, RouteMetric | Format-Table -AutoSize)
        }
        else { Write-Dim '  （无）' }
    }

    if (Test-Path $StatePath) {
        $st = Read-State
        Write-Dim "开关状态：已开启（$($st.time) 设置，状态文件 $StatePath）"
    }
    else {
        Write-Dim '开关状态：未开启（没有状态文件）'
    }

    Write-Head '连通性 / 出口测试'
    $probes = @()
    $probes += @($Config.IntranetProbes)
    if ($ad.Wifi) {
        $i = Get-IpInfo $ad.Wifi.ifIndex
        if ($i.Gateway) { $probes += $i.Gateway }
    }
    $probes += @($Config.InternetProbes)
    $probes = @($probes | Where-Object { $_ } | Select-Object -Unique)

    $rows = foreach ($p in $probes) { Get-ExitPath $p }
    Write-Table ($rows | Format-Table -AutoSize)
}

# ---------------------- 开启 ----------------------
function Invoke-On {
    Write-Head '开启：内网走 WiFi / 外网走 USB'
    if (-not (Test-Admin)) { Invoke-Elevate; return }

    $ad = Get-Adapters
    if (-not $ad.Wifi) { Write-Fail '没找到已连接的 WiFi 网卡，请先连上内网 WiFi'; return }
    if (-not $ad.Usb) { Write-Fail '没找到已连接的 USB / 共享网卡，请先连上 USB 外网'; return }

    $wifiInfo = Get-IpInfo $ad.Wifi.ifIndex
    $usbInfo = Get-IpInfo $ad.Usb.ifIndex
    Write-Dim ("WiFi：{0}   IP {1}/{2}   网关 {3}  度量 {4}" -f $ad.Wifi.Name, $wifiInfo.IPAddress,
        $wifiInfo.PrefixLength, $wifiInfo.Gateway, $wifiInfo.Metric)
    Write-Dim ("USB ：{0}   IP {1}/{2}   网关 {3}  度量 {4}" -f $ad.Usb.Name, $usbInfo.IPAddress,
        $usbInfo.PrefixLength, $usbInfo.Gateway, $usbInfo.Metric)

    if (-not $wifiInfo.Gateway) { Write-Fail 'WiFi 没有默认网关，不能作为内网出口'; return }
    if (-not $usbInfo.Gateway) { Write-Note 'USB 没有默认网关，外网可能不通，请确认 USB 共享已打开' }

    # 1) 度量：让默认路由稳定走 USB
    $oldState = Read-State
    if ($oldState -and $oldState.snapshot) {
        $snap = $oldState.snapshot
        Write-Note '检测到已开启过，沿用上次记录的原始度量'
    }
    else {
        $snap = [pscustomobject]@{
            wifi = (Get-IfMetricSnapshot $ad.Wifi.ifIndex)
            usb  = (Get-IfMetricSnapshot $ad.Usb.ifIndex)
        }
    }

    Set-NetIPInterface -InterfaceIndex $ad.Usb.ifIndex -AddressFamily IPv4 `
        -InterfaceMetric $Config.UsbInterfaceMetric -ErrorAction Stop
    Write-Ok ("USB 网卡度量设为 {0}（外网默认出口）" -f $Config.UsbInterfaceMetric)

    Set-NetIPInterface -InterfaceIndex $ad.Wifi.ifIndex -AddressFamily IPv4 `
        -InterfaceMetric $Config.WifiInterfaceMetric -ErrorAction Stop
    Write-Ok ("WiFi 网卡度量设为 {0}（不再抢默认路由）" -f $Config.WifiInterfaceMetric)

    # 2) 内网静态路由
    $prefixes = @()
    foreach ($p in (@($Config.IntranetPrefixes) + @($Prefix))) { if ($p) { $prefixes += $p } }

    Add-Log 'INFO' ("待处理内网网段：{0}" -f $(if ($prefixes.Count -gt 0) { $prefixes -join ', ' } else { '(空)' }))

    $addedRoutes = @()
    if ($prefixes.Count -eq 0) {
        Write-Note ("未配置内网网段，内网按 WiFi 直连网段 {0} 访问（直连本来就通，无需路由）" -f $wifiInfo.OnLinkPrefix)
        Write-Note '若还要访问 WiFi 网关后面的其它网段，请在脚本配置区 IntranetPrefixes 填写，或用 -Prefix 传入'
    }
    foreach ($p in $prefixes) {
        $net = Resolve-Prefix $p
        if (-not $net) { Write-Fail ("网段格式不正确，已跳过：{0}" -f $p); continue }
        if ($net -eq $wifiInfo.OnLinkPrefix) {
            Write-Note ("{0} 就是 WiFi 直连网段，跳过" -f $net)
            continue
        }
        try {
            $r = Add-IntranetRoute $net $ad.Wifi.ifIndex $wifiInfo.Gateway $Config.IntranetRouteMetric
            if ($r -eq 'exists') { Write-Note ("内网路由 {0} 已存在，跳过" -f $net) }
            else { Write-Ok ("内网路由 {0} → WiFi 网关 {1}" -f $net, $wifiInfo.Gateway) }
            $addedRoutes += [pscustomobject]@{ prefix = $net; ifIndex = $ad.Wifi.ifIndex; nextHop = $wifiInfo.Gateway }
        }
        catch { Write-Fail ("内网路由 {0} 添加失败：{1}" -f $net, $_.Exception.Message) }
    }

    # 3) 记录状态，供关闭时还原
    Save-State ([pscustomobject]@{
            version  = '1.0'
            time     = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
            wifiName = $ad.Wifi.Name
            usbName  = $ad.Usb.Name
            applied  = [pscustomobject]@{ wifi = $Config.WifiInterfaceMetric; usb = $Config.UsbInterfaceMetric }
            snapshot = $snap
            routes   = $addedRoutes
        })
    Write-Ok '已记录本次改动，关闭时可完整还原'

    Show-Status
}

# ---------------------- 关闭 ----------------------
function Invoke-Off {
    Write-Head '关闭：删除内网路由 / 恢复自动度量'
    if (-not (Test-Admin)) { Invoke-Elevate; return }

    $st = Read-State
    if (-not $st) {
        Write-Note '没有找到开启记录：把网卡度量恢复为系统自动，并清理本工具可能留下的手工度量'
        $ad = Get-Adapters
        foreach ($a in @($ad.Wifi, $ad.Usb)) {
            if (-not $a) { continue }
            $snap = [pscustomobject]@{ Index = $a.ifIndex; Automatic = 'Enabled'; Interface = $null }
            Restore-IfMetric $snap $a.Name @($Config.WifiInterfaceMetric, $Config.UsbInterfaceMetric)
        }
        Show-Status
        return
    }

    foreach ($r in @($st.routes)) {
        if (-not $r) { continue }
        if (Remove-IntranetRoute $r.prefix ([int]$r.ifIndex) $r.nextHop) {
            Write-Ok ("已删除内网路由 {0}" -f $r.prefix)
        }
        else {
            Write-Note ("内网路由 {0} 已不存在（可能随断网消失）" -f $r.prefix)
        }
    }

    if ($st.snapshot) {
        $appliedUsb = if ($st.applied -and $st.applied.usb) { [int]$st.applied.usb } else { $Config.UsbInterfaceMetric }
        $appliedWifi = if ($st.applied -and $st.applied.wifi) { [int]$st.applied.wifi } else { $Config.WifiInterfaceMetric }
        Restore-IfMetric $st.snapshot.usb ([string]$st.usbName) $appliedUsb
        Restore-IfMetric $st.snapshot.wifi ([string]$st.wifiName) $appliedWifi
        Write-Ok '网卡度量已按原始记录恢复'
    }

    if (Test-Path $StatePath) { Remove-Item $StatePath -Force }
    Write-Ok '状态文件已清除'

    Show-Status
}

# ---------------------- 菜单 ----------------------
function Show-Menu {
    if (-not (Test-Admin)) { Invoke-Elevate; return }

    while ($true) {
        Write-Host ''
        Write-Host '========= 网络路由开关（WiFi 内网 / USB 外网） =========' -ForegroundColor Cyan
        Write-Host '  1  开启：内网走 WiFi，外网走 USB'
        Write-Host '  2  关闭：删除内网路由，度量恢复自动'
        Write-Host '  3  查看当前状态'
        Write-Host '  0  退出'
        $choice = Read-Host '请选择'
        switch ($choice) {
            '1' { Invoke-On }
            '2' { Invoke-Off }
            '3' { Show-Status }
            '0' { return }
            default { Write-Note '无效输入，请重新选择' }
        }
    }
}

# 每次执行重写日志，只保留最近一次
try {
    $logDir = Split-Path $LogPath
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Set-Content -Path $LogPath -Value ("==== {0}  Action={1}  Admin={2}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'),
        $Action, (Test-Admin)) -Encoding UTF8
}
catch { }

try {
    switch ($Action) {
        'on' { Invoke-On }
        'off' { Invoke-Off }
        'status' { Show-Status }
        default { Show-Menu }
    }
}
catch {
    Write-Fail ("执行出错：{0}" -f $_.Exception.Message)
    Add-Log 'EXCEPTION' $_.Exception.ToString()
}

Add-Log 'END' ("Action={0} 结束" -f $Action)
if ($Pause) { Write-Host ''; Read-Host '按回车关闭窗口' | Out-Null }

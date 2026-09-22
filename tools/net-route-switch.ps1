<# -*- coding: utf-8 -*-
<#
 * ============================================================
 *  网络路由开关  net-route-switch.ps1
 * ============================================================
 *  适用场景：双网卡（WiFi / 网线 / USB 等）按角色分工：
 *    · 一个网卡出口走内网（172/10/192 网段等）
 *    · 另一个网卡出口走外网
 *            把两条出口的分工一键固定下来并可随时关闭。
 *
 *  两种模式（菜单里独立选择，互不影响）：
 *    模式一：WiFi = 内网 · USB(手机共享 / NDIS 网卡) = 外网   ← 自动识别（v1.0 原行为）
 *    模式二：网线(以太网) = 内网 · WiFi = 外网               ← 网线允许暂时没插，插上后再开一次补全
 *
 *  开启(on)：
 *    · 外网网卡接口度量压低（= 外网默认出口）
 *    · 内网网卡接口度量抬高（不抢默认路由）
 *    · 配置里的内网网段加静态路由，指向内网网卡网关
 *  关闭(off)：
 *    · 删除本脚本加的静态路由，网卡度量恢复为系统自动
 *
 *  用法：
 *    net-route-switch.bat                              # 双击，进交互菜单（会自动提权）
 *    .\net-route-switch.ps1 -Action on                 # 开启·模式一（WiFi 内网 / USB 外网）
 *    .\net-route-switch.ps1 -Action on -Mode 2         # 开启·模式二（网线 内网 / WiFi 外网）
 *    .\net-route-switch.ps1 -Action on -IntranetIf "以太网"
 *    .\net-route-switch.ps1 -Action on -IntranetIf 8 -InternetIf "WLAN"
 *    .\net-route-switch.ps1 -Action off                # 关闭
 *    .\net-route-switch.ps1 -Action status             # 查看状态（按已开启的模式展示）
 *    .\net-route-switch.ps1 -Action on -Prefix 10.0.0.0/8,172.16.0.0/12,10.1.2
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
 *  v1.2  2026-09-21  抽离「角色」概念，新增 WiFi 外网 + 网线/USB 内网模式：
 *                    ① 配置区新增 IntranetAdapter/InternetAdapter/EthernetMatch；
 *                    ② 新增 CLI 参数 -IntranetIf / -InternetIf（按网卡名或 ifIndex）；
 *                    ③ 网卡按「角色」识别而非按物理类型：自动模式兼容旧 USB 场景；
 *                    ④ 内网网卡允许暂时未连通（Status=Down），仅设外网度量 + 记录预设，
 *                       网线插好后再 on 一次会自动补内网路由；
 *                    ⑤ 状态文件格式调整（intranet/internet 替代 wifi/usb），兼容 v1.0/v1.1。
 *  v1.3  2026-09-22  模式拆分（修「模式互相打架」）：
 *                    ① 新增 -Mode 1|2，菜单 1/2 分别对应两个模式，各自独立开启；
 *                    ② 配置区 IntranetAdapter/InternetAdapter 取消，改为 ModeDefs 按模式定义，
 *                       模式一恢复 v1.0 自动识别原行为（WiFi=内网、USB 类=外网）；
 *                    ③ 内网角色匹配到「未连通」网卡时等 2 秒重查一次，规避链路刚 Up 的状态抖动；
 *                    ④ 状态文件记录 mode，status/off 按当时开启的模式展示与还原。
 #>

[CmdletBinding()]
param(
    [ValidateSet('menu', 'on', 'off', 'status')]
    [string]$Action = 'menu',

    # 模式：1 = WiFi 内网 / USB 外网；2 = 网线 内网 / WiFi 外网；0 = 未指定（on 时按 1 处理，
    # status 时优先按状态文件里记录的模式展示）
    [ValidateSet(0, 1, 2)]
    [int]$Mode = 0,

    # 临时追加的内网网段或单机地址，逗号分隔
    [string[]]$Prefix = @(),

    # 强制指定「内网出口」对应的网卡（按名称模糊匹配或 ifIndex 数字）
    [string]$IntranetIf = '',

    # 强制指定「外网出口」对应的网卡（按名称模糊匹配或 ifIndex 数字）
    [string]$InternetIf = '',

    # 提权后的窗口结束时保持不关（内部使用）
    [switch]$Pause
)

$ErrorActionPreference = 'Stop'

# ==================== 配置区（按需修改） ====================
$Config = [ordered]@{
    # 网卡识别关键词（匹配 网卡名 + 描述，忽略大小写）

    # === 模式定义（菜单里独立选择，互不影响）===
    #   intranet / internet：该模式下两张角色的匹配词；留空 = 按该模式的自动规则：
    #     模式一：内网 WifiMatch→EthernetMatch；外网 UsbMatch→EthernetMatch→有网关的卡
    #     模式二：内网 EthernetMatch（允许未插线）；外网 WifiMatch
    ModeDefs            = @{
        1 = @{ label = 'WiFi=内网 + USB=外网'; intranet = @(); internet = @() }
        2 = @{ label = '网线=内网 + WiFi=外网'; intranet = @('以太网', 'Ethernet', 'Realtek', 'GbE', 'PCIe.*Family'); internet = @('WLAN', 'Wi-?Fi', 'Wireless', '802\.11') }
    }

    # === 「物理类型」自动识别（模式留空时按以下顺序尝试）===
    #   注意 EthernetMatch 里不能放 'LAN' 这类短词——'WLAN' 也包含 'LAN'，会把 WiFi 误判成网线
    WifiMatch           = @('Wi-?Fi', 'Wireless', 'WLAN', '802\.11', '无线')
    UsbMatch            = @('NDIS', 'RNDIS', 'USB', 'Tethering', 'Sharing')
    EthernetMatch       = @('Ethernet', 'Realtek', 'GbE', '有线', '以太网', 'PCIe.*Family')

    # 内网网段：这些地址走内网网卡网关（留空 = 只靠内网网卡直连网段）
    # 实测：bar.dayesteel.com.cn → 172.15.115.121，内网 DNS 172.15.88.1 / 172.15.88.2
    # 单个 IP 写法按 /32 处理；想更精确可把 172.0.0.0/8 收窄为 172.15.0.0/16
    IntranetPrefixes    = @('172.0.0.0/8')

    # 状态检查时要探活的内网目标
    IntranetProbes      = @('bar.dayesteel.com.cn', '172.15.88.1')

    # 外网探活目标
    InternetProbes      = @('223.5.5.5', 'www.baidu.com')

    # 接口度量：数值越小优先级越高
    #   这两个名字保留 v1.0/v1.1 的写法：UsbInterfaceMetric 用在外网网卡（不论它是 USB/WiFi/网线）
    #                                       WifiInterfaceMetric 用在内网网卡
    UsbInterfaceMetric  = 10     # 外网 = 默认出口
    WifiInterfaceMetric = 60     # 内网 = 不参与默认路由竞争

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
        '-Action', $Action, '-Mode', $Mode, '-Pause')
    if ($Prefix.Count -gt 0) { $argList += @('-Prefix', ($Prefix -join ',')) }
    if ($IntranetIf) { $argList += @('-IntranetIf', $IntranetIf) }
    if ($InternetIf) { $argList += @('-InternetIf', $InternetIf) }
    Write-Note '需要管理员权限，正在弹出 UAC 提权窗口…'
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs | Out-Null
}

# ---------------------- 网卡 / IP ----------------------
# 按「模式 + 角色」识别两张网卡：内网出口 / 外网出口
#  - 给定 -IntranetIf / -InternetIf：按名字或 ifIndex 强制定死（允许 Status=Down / 虚拟网卡），优先级最高
#  - 否则按当前模式的 ModeDefs 匹配词找；留空再按该模式的自动规则
#  - 内网角色允许匹配到「未连通」的网卡（模式二网线没插的场景），并重查一次规避状态抖动
function Get-Adapters {
    [CmdletBinding()]
    param(
        [int]$Mode = 1,
        [string]$IntranetIf = '',
        [string]$InternetIf = ''
    )

    # 1) 收集候选
    #   显式指定时也排除 Sangfor/VNIC/Loopback 等明显无关的虚拟适配器，
    #   防止「-IntranetIf 以太网」误中「以太网 3」这类同名 VNIC（VPN 软件常见）。
    $excludeRegex = 'Sangfor|VNIC|Loopback'
    $explicit = [bool]$IntranetIf -or [bool]$InternetIf
    if ($explicit) {
        # 指定网卡时全量取（允许虚拟适配器）但排除明显不相关的
        $candidates = @(Get-NetAdapter -ErrorAction SilentlyContinue |
            Where-Object { $_.InterfaceDescription -notmatch $excludeRegex })
    }
    else {
        # 自动模式只认物理网卡，排除明显无关的虚拟适配器
        try { $all = Get-NetAdapter -Physical -ErrorAction Stop }
        catch { $all = Get-NetAdapter }
        $candidates = @($all | Where-Object {
                $_.InterfaceDescription -notmatch $excludeRegex
            })
    }

    # 在候选里按名字或 ifIndex 找一张卡
    function Find-Adapter($spec) {
        if (-not $spec) { return $null }
        if ($spec -match '^\d+$') {
            return @($candidates | Where-Object { [string]$_.ifIndex -eq $spec } | Select-Object -First 1)
        }
        return @($candidates | Where-Object {
                ($_.Name -like "*$spec*") -or ($_.InterfaceDescription -like "*$spec*")
            } | Select-Object -First 1)
    }

    # 按匹配词列表找卡；$AllowDown = 找不到 Up 的时允许未连通的（内网角色专用）
    #   匹配到「未连通」的卡时等 2 秒重查一次——链路刚插上时 Get-NetAdapter 的 Status 可能还是旧值
    function Find-ByList($patterns, [bool]$AllowDown) {
        if (-not $patterns -or @($patterns).Count -eq 0) { return $null }
        $m = @($up | Where-Object {
                Test-Pattern "$($_.Name) $($_.InterfaceDescription)" $patterns
            } | Select-Object -First 1)
        if ($m) { return $m }
        if (-not $AllowDown) { return $null }
        $m = @($candidates | Where-Object {
                Test-Pattern "$($_.Name) $($_.InterfaceDescription)" $patterns
            } | Select-Object -First 1)
        if ($m -and $m.Status -ne 'Up') {
            Start-Sleep -Seconds 2
            $fresh = Get-NetAdapter -InterfaceIndex $m.ifIndex -ErrorAction SilentlyContinue
            if ($fresh -and $fresh.Status -eq 'Up') { return $fresh }
        }
        return $m
    }

    $up = @($candidates | Where-Object { $_.Status -eq 'Up' })
    if ($Mode -lt 1) { $Mode = 1 }   # 未指定时按模式一
    $modeDef = $Config.ModeDefs[$Mode]
    if (-not $modeDef) { $modeDef = $Config.ModeDefs[1] }

    # 2) 内网卡
    $intra = $null
    if ($IntranetIf) {
        $intra = Find-Adapter $IntranetIf
    }
    else {
        $intra = Find-ByList $modeDef.intranet $true
        if (-not $intra) {
            if ($Mode -eq 2) {
                $intra = Find-ByList $Config.EthernetMatch $true
            }
            else {
                $intra = Find-ByList $Config.WifiMatch $false
                if (-not $intra) { $intra = Find-ByList $Config.EthernetMatch $false }
            }
        }
    }

    # 3) 外网卡
    $inter = $null
    if ($InternetIf) {
        $inter = Find-Adapter $InternetIf
    }
    else {
        $inter = Find-ByList $modeDef.internet $false
        if (-not $inter) {
            if ($Mode -eq 2) {
                $inter = Find-ByList $Config.WifiMatch $false
            }
            else {
                $inter = Find-ByList $Config.UsbMatch $false
                if (-not $inter) { $inter = Find-ByList $Config.EthernetMatch $false }
            }
        }
        if (-not $inter) {
            $inter = @($up | Where-Object {
                    (Get-NetIPConfiguration -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue).IPv4DefaultGateway
                } | Select-Object -First 1)
        }
    }

    return [pscustomobject]@{
        Mode     = $Mode
        Label    = $modeDef.label
        Intranet = $intra
        Internet = $inter
    }
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
    [uint32]([uint32]$b[0] -shl 24) -bor ([uint32]$b[1] -shl 16) -bor ([uint32]$b[2] -shl 8) -bor [uint32]$b[3]
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
    try {
        $st = Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch { return $null }

    # v1.0/v1.1 → v1.2 字段名迁移（wifi/usb → intranet/internet）
    if ($st -and -not $st.intranetName -and $st.wifiName) {
        $st = [pscustomobject]@{
            version      = '1.0-legacy'
            time         = $st.time
            intranetName = $st.wifiName
            internetName = $st.usbName
            applied      = $st.applied
            snapshot     = $st.snapshot
            routes       = $st.routes
        }
    }
    if ($st -and $st.snapshot -and -not $st.snapshot.intranet -and $st.snapshot.wifi) {
        $st.snapshot = [pscustomobject]@{
            intranet = $st.snapshot.wifi
            internet = $st.snapshot.usb
        }
    }
    # v1.2 及以前的状态文件没有 mode 字段，按模式一处理
    if ($st -and -not $st.mode) {
        $st | Add-Member -NotePropertyName mode -NotePropertyValue 1 -Force
    }
    return $st
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
function Show-Status([int]$ForcedMode = 0) {
    # $ForcedMode 非零 → 强制按该模式展示（off 后调用用）
    # 其次：本次 -Mode 显式传入的；再其次：状态文件里记录的模式；最后默认模式一
    $st = if (Test-Path $StatePath) { Read-State } else { $null }
    $showMode = if ($ForcedMode) { $ForcedMode }
    elseif ($Mode -ge 1) { $Mode }
    elseif ($st -and $st.mode) { [int]$st.mode }
    else { 1 }
    $showLabel = if ($Config.ModeDefs[$showMode]) { $Config.ModeDefs[$showMode].label } else { "模式$showMode" }

    Write-Head "当前网络路由状态（按$showLabel 视角）"
    $ad = Get-Adapters -Mode $showMode -IntranetIf $IntranetIf -InternetIf $InternetIf

    $rows = @()
    foreach ($item in @(
            [pscustomobject]@{ 角色 = '内网'; Adapter = $ad.Intranet },
            [pscustomobject]@{ 角色 = '外网'; Adapter = $ad.Internet }
        )) {
        $a = $item.Adapter
        if (-not $a) {
            $rows += [pscustomobject]@{ 角色 = $item.角色; 网卡 = '未找到已连接的网卡'; IP = '-'; 网关 = '-'; 度量 = '-'; 状态 = '-' }
            continue
        }
        $i = Get-IpInfo $a.ifIndex
        $rows += [pscustomobject]@{
            角色 = $item.角色; 网卡 = $a.Name
            IP   = if ($i.IPAddress) { "$($i.IPAddress)/$($i.PrefixLength)" } else { '-' }
            网关 = if ($i.Gateway) { $i.Gateway } else { '-' }
            度量 = $i.Metric
            状态 = $a.Status
        }
    }
    Write-Table ($rows | Format-Table -AutoSize)

    Write-Dim '默认路由（越靠前越优先）：'
    Write-Table (Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
        Sort-Object { $_.RouteMetric + $_.InterfaceMetric } |
        Select-Object @{ n = '网卡'; e = { $_.InterfaceAlias } }, NextHop,
        @{ n = '路由度量'; e = { $_.RouteMetric } }, @{ n = '接口度量'; e = { $_.InterfaceMetric } } |
        Format-Table -AutoSize)

    if ($ad.Intranet) {
        Write-Dim '内网网卡上的手工静态路由：'
        $sr = @(Get-NetRoute -InterfaceIndex $ad.Intranet.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.Protocol -eq 'NetMgmt' -and $ProtectedPrefixes -notcontains $_.DestinationPrefix })
        if ($sr.Count -gt 0) {
            Write-Table ($sr | Select-Object DestinationPrefix, NextHop, RouteMetric | Format-Table -AutoSize)
        }
        else { Write-Dim '  （无）' }
    }

    if ($st) {
        $stLabel = if ($Config.ModeDefs[[int]$st.mode]) { $Config.ModeDefs[[int]$st.mode].label } else { "模式$($st.mode)" }
        Write-Dim "开关状态：已开启（模式$($st.mode)：$stLabel，$($st.time) 设置，状态文件 $StatePath）"
    }
    else {
        Write-Dim '开关状态：未开启（没有状态文件）'
    }

    Write-Head '连通性 / 出口测试'
    $probes = @()
    $probes += @($Config.IntranetProbes)
    if ($ad.Intranet) {
        $i = Get-IpInfo $ad.Intranet.ifIndex
        if ($i.Gateway) { $probes += $i.Gateway }
    }
    $probes += @($Config.InternetProbes)
    $probes = @($probes | Where-Object { $_ } | Select-Object -Unique)

    $rows = foreach ($p in $probes) { Get-ExitPath $p }
    Write-Table ($rows | Format-Table -AutoSize)
}

# ---------------------- 开启 ----------------------
function Invoke-On {
    if ($Mode -lt 1) { $Mode = 1 }   # 未指定时按模式一
    $modeDef = $Config.ModeDefs[$Mode]
    if (-not $modeDef) { $modeDef = $Config.ModeDefs[1] }
    $modeTxt = if ($IntranetIf -or $InternetIf) {
        "模式$Mode（$($modeDef.label)），指定网卡（内网=$IntranetIf 外网=$InternetIf）"
    }
    else {
        "模式$Mode（$($modeDef.label)），自动识别"
    }
    Write-Head "开启（$modeTxt）"
    if (-not (Test-Admin)) { Invoke-Elevate; return }

    $ad = Get-Adapters -Mode $Mode -IntranetIf $IntranetIf -InternetIf $InternetIf

    if ($IntranetIf -and -not $ad.Intranet) {
        Write-Fail "-IntranetIf '$IntranetIf' 在本机找不到，请确认网卡名或 ifIndex"; return
    }
    if ($InternetIf -and -not $ad.Internet) {
        Write-Fail "-InternetIf '$InternetIf' 在本机找不到，请确认网卡名或 ifIndex"; return
    }
    if (-not $ad.Intranet) {
        Write-Fail '没找到内网网卡，请接上 WiFi / 网线，或用 -IntranetIf 指定'; return
    }
    if (-not $ad.Internet) {
        Write-Fail '没找到外网网卡，请接 USB 共享 / 移动热点，或用 -InternetIf 指定'; return
    }
    if ($ad.Intranet.ifIndex -eq $ad.Internet.ifIndex) {
        Write-Fail ("识别到的内网卡与外网卡是同一张：{0}" -f $ad.Intranet.Name)
        Write-Note '请用 -IntranetIf / -InternetIf 明确指定两张不同的网卡（或在配置 IntranetAdapter/InternetAdapter 写明）'
        return
    }

    $intraUp = $ad.Intranet.Status -eq 'Up'
    $interUp = $ad.Internet.Status -eq 'Up'
    if (-not $intraUp -and -not $interUp) {
        Write-Fail '内网与外网网卡都未连通，没有可做的事'; return
    }
    if (-not $intraUp) {
        Write-Note ("内网网卡「{0}」当前未连通（Status={1}），本次只设外网度量；插上网线后再开一次会自动补内网路由" -f $ad.Intranet.Name, $ad.Intranet.Status)
    }
    if (-not $interUp) {
        Write-Note ("外网网卡「{0}」当前未连通（Status={1}），外网可能不通" -f $ad.Internet.Name, $ad.Internet.Status)
    }

    $intraInfo = Get-IpInfo $ad.Intranet.ifIndex
    $interInfo = Get-IpInfo $ad.Internet.ifIndex
    Write-Dim ("内网：{0}   IP {1}/{2}   网关 {3}  度量 {4}   Status {5}" -f $ad.Intranet.Name,
        $intraInfo.IPAddress, $intraInfo.PrefixLength, $intraInfo.Gateway, $intraInfo.Metric, $ad.Intranet.Status)
    Write-Dim ("外网：{0}   IP {1}/{2}   网关 {3}  度量 {4}   Status {5}" -f $ad.Internet.Name,
        $interInfo.IPAddress, $interInfo.PrefixLength, $interInfo.Gateway, $interInfo.Metric, $ad.Internet.Status)

    if ($intraUp -and -not $intraInfo.Gateway) {
        Write-Fail '内网网卡没有默认网关，不能作为内网出口'; return
    }
    if ($interUp -and -not $interInfo.Gateway) {
        Write-Note '外网网卡没有默认网关，外网可能不通，请确认外网共享已打开'
    }

    # 1) 度量：让默认路由稳定走外网卡
    $oldState = Read-State
    if ($oldState -and $oldState.snapshot) {
        $snap = $oldState.snapshot
        Write-Note '检测到已开启过，沿用上次记录的原始度量'
    }
    else {
        $snap = [pscustomobject]@{
            intranet = (Get-IfMetricSnapshot $ad.Intranet.ifIndex)
            internet = (Get-IfMetricSnapshot $ad.Internet.ifIndex)
        }
    }

    Set-NetIPInterface -InterfaceIndex $ad.Internet.ifIndex -AddressFamily IPv4 `
        -InterfaceMetric $Config.UsbInterfaceMetric -ErrorAction Stop
    Write-Ok ("外网卡「{0}」度量设为 {1}（外网默认出口）" -f $ad.Internet.Name, $Config.UsbInterfaceMetric)

    if ($intraUp) {
        Set-NetIPInterface -InterfaceIndex $ad.Intranet.ifIndex -AddressFamily IPv4 `
            -InterfaceMetric $Config.WifiInterfaceMetric -ErrorAction Stop
        Write-Ok ("内网卡「{0}」度量设为 {1}（不参与默认路由竞争）" -f $ad.Intranet.Name, $Config.WifiInterfaceMetric)
    }
    else {
        Write-Note '内网网卡未连通，跳过设置度量'
    }

    # 2) 内网静态路由（仅当网关已知时）
    $prefixes = @()
    foreach ($p in (@($Config.IntranetPrefixes) + @($Prefix))) { if ($p) { $prefixes += $p } }
    Add-Log 'INFO' ("待处理内网网段：{0}" -f $(if ($prefixes.Count -gt 0) { $prefixes -join ', ' } else { '(空)' }))

    $addedRoutes = @()
    if ($prefixes.Count -eq 0) {
        if ($intraInfo.OnLinkPrefix) {
            Write-Note ("未配置内网网段，内网按直连网段 {0} 访问（直连本来就通，无需路由）" -f $intraInfo.OnLinkPrefix)
        }
        else {
            Write-Note '未配置内网网段，内网网卡当前也没拿到 IP，无法自动判断'
        }
        Write-Note '若还要访问内网网关后面的其它网段，请在配置区 IntranetPrefixes 填写，或用 -Prefix 传入'
    }
    if (-not $intraUp -or -not $intraInfo.Gateway) {
        Write-Note '内网网关未知（网卡未连通？），暂不加内网静态路由；内网网卡连通后再开一次会自动补全'
    }
    else {
        foreach ($p in $prefixes) {
            $net = Resolve-Prefix $p
            if (-not $net) { Write-Fail ("网段格式不正确，已跳过：{0}" -f $p); continue }
            if ($net -eq $intraInfo.OnLinkPrefix) {
                Write-Note ("{0} 就是内网卡直连网段，跳过" -f $net); continue
            }
            try {
                $r = Add-IntranetRoute $net $ad.Intranet.ifIndex $intraInfo.Gateway $Config.IntranetRouteMetric
                if ($r -eq 'exists') { Write-Note ("内网路由 {0} 已存在，跳过" -f $net) }
                else { Write-Ok ("内网路由 {0} → 内网网关 {1}" -f $net, $intraInfo.Gateway) }
                $addedRoutes += [pscustomobject]@{ prefix = $net; ifIndex = $ad.Intranet.ifIndex; nextHop = $intraInfo.Gateway }
            }
            catch { Write-Fail ("内网路由 {0} 添加失败：{1}" -f $net, $_.Exception.Message) }
        }
    }

    # 3) 记录状态，供关闭时还原
    Save-State ([pscustomobject]@{
            version      = '1.3'
            mode         = $Mode
            time         = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
            intranetName = $ad.Intranet.Name
            internetName = $ad.Internet.Name
            applied      = [pscustomobject]@{ internet = $Config.UsbInterfaceMetric; intranet = $Config.WifiInterfaceMetric }
            snapshot     = $snap
            routes       = $addedRoutes
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
        $ad = Get-Adapters -Mode $Mode -IntranetIf $IntranetIf -InternetIf $InternetIf
        foreach ($a in @($ad.Intranet, $ad.Internet)) {
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
        $appliedInternet = if ($st.applied -and $st.applied.internet) { [int]$st.applied.internet } else { $Config.UsbInterfaceMetric }
        $appliedIntranet = if ($st.applied -and $st.applied.intranet) { [int]$st.applied.intranet } else { $Config.WifiInterfaceMetric }
        Restore-IfMetric $st.snapshot.internet ([string]$st.internetName) $appliedInternet
        Restore-IfMetric $st.snapshot.intranet ([string]$st.intranetName) $appliedIntranet
        Write-Ok '网卡度量已按原始记录恢复'
    }

    if (Test-Path $StatePath) { Remove-Item $StatePath -Force }
    Write-Ok '状态文件已清除'

    # 按刚才还原的模式展示（状态文件已删，需显式传入）
    $offMode = if ($st.mode) { [int]$st.mode } else { $Mode }
    Show-Status $offMode
}

# ---------------------- 菜单 ----------------------
function Show-Menu {
    if (-not (Test-Admin)) { Invoke-Elevate; return }

    while ($true) {
        Write-Host ''
        Write-Host '========= 网络路由开关（双出口分工） =========' -ForegroundColor Cyan
        Write-Host '  1  开启·模式一：内网走 WiFi，外网走 USB 共享'
        Write-Host '  2  开启·模式二：内网走网线，外网走 WiFi'
        Write-Host '  3  关闭：删除内网路由，度量恢复自动'
        Write-Host '  4  查看当前状态'
        Write-Host '  0  退出'
        $choice = Read-Host '请选择'
        switch ($choice) {
            '1' { $script:Mode = 1; Invoke-On }
            '2' { $script:Mode = 2; Invoke-On }
            '3' { Invoke-Off }
            '4' { Show-Status }
            '0' { return }
            default { Write-Note '无效输入，请重新选择' }
        }
    }
}

# 每次执行重写日志，只保留最近一次
try {
    $logDir = Split-Path $LogPath
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Set-Content -Path $LogPath -Value ("==== {0}  Action={1}  Mode={2}  Admin={3}  Intra={4}  Inter={5}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'),
        $Action, $Mode, (Test-Admin), $IntranetIf, $InternetIf) -Encoding UTF8
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
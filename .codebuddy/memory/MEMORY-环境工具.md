# 记忆分卷 · 本机网络环境 / 工具脚本（自 MEMORY.md 整段搬迁，原文未改）

> 本文件由 MEMORY.md 拆分而来，用于超限治理；后续增补环境/工具相关内容时直接写在这里。

## 本机网络环境 / 工具脚本（2026-09-11，同日按实测更新）
- 双出口：WiFi `WLAN`(Intel Wi-Fi 6E) = 内网 192.168.1.102/24（网关 192.168.1.1，DNS 172.15.88.1/88.2）；USB `以太网 2`(Remote NDIS 共享) = 外网 10.247.27.31/24（网关 10.247.27.133，度量 25）
- 内网为 172 开头（实测 172.15.x）：`bar.dayesteel.com.cn` → 172.15.115.121
- 路由开关工具 → `tools/net-route-switch.ps1`（双击 `tools/net-route-switch.bat` 进菜单：1 开模式一 / 2 开模式二 / 3 关 / 4 状态；改路由需 UAC；现 v1.3，2026-09-22）：on = 内网 172.0.0.0/8 走内网卡网关 + 外网固定走外网卡（接口度量 10/60 + 静态路由），off = 按记录精确还原；状态文件 `%LOCALAPPDATA%\net-route-switch\state.json`，运行日志同目录 `last-run.log`
- v1.3 模式拆分：`-Mode 1`（WiFi=内网 + USB=外网，v1.0 自动识别）与 `-Mode 2`（网线=内网 + WiFi=外网，网线允许未插、插上后 on 一次补全）是**两个独立入口**（菜单 1/2 各自对应），配置区 `ModeDefs` 按模式定义匹配词；`-IntranetIf/-InternetIf` 仍可强制指定网卡。教训：不要把某个模式写成全局默认值劫持唯一自动入口。注意 EthernetMatch 禁用 'LAN' 短词（会匹配 WLAN）。状态文件 v1.3 带 mode 字段，旧版自动迁移 mode=1
- v1.2 新增「角色」识别，**支持任意两张网卡按内网/外网分工**：配置区 `IntranetAdapter` / `InternetAdapter`（留空 = 自动）+ `EthernetMatch` 自动识别关键词；新参数 `-IntranetIf "<名或ifIndex>"` / `-InternetIf "..."` 强制定角色并允许目标网卡 Status=Down（处理"网线没插"场景，插上后 on 一次自动补路由）。默认行为兼容旧 USB 模式（WiFi=内网 / UsbMatch 类网卡=外网）；状态文件 schema 改了，Read-State 自动迁移 v1.0/v1.1
- 2026-09-21 实测机器网卡：以太网 = Realtek Gaming 2.5GbE（Disconnected 时 Get-NetIPAddress 仍保留 IP 172.15.156.180/24、网关 172.15.156.254），另有一条「以太网 3」= Sangfor SSL VPN VNIC（必须排除，否则 -IntranetIf "以太网" 会误中）；WLAN 是唯一 Up 网卡
- 工具当前**不支持**「蓝牙 + WiFi」双出口：`Get-Adapters` 仍排除 InterfaceDescription 含 `Bluetooth` 的网卡；v1.2 加 `-IntranetIf/-InternetIf` 参数后显式指定可以破，但自动模式仍不会选蓝牙（2026-09-15 评估，未实施自动支持）
- **`Set-NetIPInterface -InterfaceMetric` 会同时写进注册表持久存储**（`HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{GUID}\InterfaceMetric`）：只做 `-AutomaticMetric Enabled` 不够，USB/NDIS 网卡一重连旧度量又生效；脚本恢复时活动存储与注册表一起处理
- **.ps1 必须带 UTF-8 BOM**：`write_to_file` 写出的 ps1 无 BOM，PowerShell 5.1 按 ANSI 解码中文会撑破字符串引号、报大量假语法错；补 BOM 后再用 Parser 校验
- Windows shell 内联 PowerShell 传参：外层用单引号包裹、内层单引号写成 `''`，否则引号被吞；脚本路径用相对 ASCII 路径（如 `tools/xxx.ps1`）避开中文路径
- PowerShell 正则**嵌套捕获组会占用组号**（`(\d+(\.\d+){3})` 里内层组是 2 号），取 `$Matches[n]` 一律改用命名组

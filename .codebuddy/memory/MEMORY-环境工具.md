# 记忆分卷 · 本机网络环境 / 工具脚本（自 MEMORY.md 整段搬迁，原文未改）

> 本文件由 MEMORY.md 拆分而来，用于超限治理；后续增补环境/工具相关内容时直接写在这里。

## 本机网络环境 / 工具脚本（2026-09-11，同日按实测更新）
- 双出口：WiFi `WLAN`(Intel Wi-Fi 6E) = 内网 192.168.1.102/24（网关 192.168.1.1，DNS 172.15.88.1/88.2）；USB `以太网 2`(Remote NDIS 共享) = 外网 10.247.27.31/24（网关 10.247.27.133，度量 25）
- 内网为 172 开头（实测 172.15.x）：`bar.dayesteel.com.cn` → 172.15.115.121
- 路由开关工具 → `tools/net-route-switch.ps1`（双击 `tools/net-route-switch.bat` 进菜单：1 开 / 2 关 / 3 状态；改路由需 UAC）：on = 内网 172.0.0.0/8 走 WiFi 网关 + 外网固定走 USB（接口度量 10/60 + 静态路由），off = 按记录精确还原；状态文件 `%LOCALAPPDATA%\net-route-switch\state.json`，运行日志同目录 `last-run.log`
- 工具当前只认「WiFi = 内网 / USB 类网卡 = 外网」这一组合：`Get-Adapters` 硬性排除 InterfaceDescription 含 `Bluetooth` 的网卡，且候选取 `Get-NetAdapter -Physical`。改成「蓝牙 + WiFi」双出口需改配置区排除项/匹配词与网卡角色指定（2026-09-15 评估，未实施）
- **`Set-NetIPInterface -InterfaceMetric` 会同时写进注册表持久存储**（`HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{GUID}\InterfaceMetric`）：只做 `-AutomaticMetric Enabled` 不够，USB/NDIS 网卡一重连旧度量又生效；脚本恢复时活动存储与注册表一起处理
- **.ps1 必须带 UTF-8 BOM**：`write_to_file` 写出的 ps1 无 BOM，PowerShell 5.1 按 ANSI 解码中文会撑破字符串引号、报大量假语法错；补 BOM 后再用 Parser 校验
- Windows shell 内联 PowerShell 传参：外层用单引号包裹、内层单引号写成 `''`，否则引号被吞；脚本路径用相对 ASCII 路径（如 `tools/xxx.ps1`）避开中文路径
- PowerShell 正则**嵌套捕获组会占用组号**（`(\d+(\.\d+){3})` 里内层组是 2 号），取 `$Matches[n]` 一律改用命名组

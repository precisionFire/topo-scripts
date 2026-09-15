# 项目记忆

## 项目概述
冶钢棒材轧线跟踪系统，包含四条产线：大棒线、中棒线、小棒线、扁棒线，以及通用弹窗组件。

## 文件定位索引（先查这里，避免全库搜索）
- 扁棒线加热炉 → 大冶特钢/棒材厂/扁棒线/扁棒线加热炉.js
- 扁棒线轧机 → 大冶特钢/棒材厂/扁棒线/扁棒线轧机.js（设计文档：同目录 扁棒线轧机.md）
- 小棒线加热炉 → 大冶特钢/棒材厂/小棒线/小棒线加热炉.js
- 中棒线加热炉 → 大冶特钢/棒材厂/中棒线/中棒线加热炉.js
- 中棒线轧机 → 大冶特钢/棒材厂/中棒线/中棒线轧机.js
- 中棒剪切 → 大冶特钢/棒材厂/中棒线/中棒3#剪切台.js
- 大棒线轧机 → 大冶特钢/棒材厂/大棒线/大棒线轧机.js（文件头注释仍写着"中棒线轧机"，属中棒拷贝残留，未改）
- 大棒加热炉 → 大冶特钢/棒材厂/大棒线/大棒一号加热炉.js、大棒二号加热炉.js
- 弹窗组件（唯一维护源）→ AriView/libs/通用组件/弹窗组件/（9 个 js：ConflictDialog/DialogCore/DialogMain/DialogView/Dispatcher/OverlengthDialog/PopupManager/RecognitionDialog/WillInOutPopup）
  - 引用：storage/index.html 及 导入后出现的html文件/ 下 25 个场景 HTML → ../libs/通用组件/弹窗组件/xxx.js；HistoricalTrendPopup.js 属历史趋势弹窗，留在 libs 根
  - 2026-09-02 起用户确认 AriView 为最终发布物、以 AriView 为唯一维护源；原本地主版本目录 通用组件/ 已删除（详见当日日志）

## 弹窗组件分层规则（PopupManager 设计初衷，2026-08-27 确认）
- **PopupManager 是纯管理器**：只做「注册类型 → 转发原始数据 → 同类型单例 + 生命周期管理」。
- **禁止在 PopupManager 内加业务判断钩子**（如 preShow/shouldShow），去重、过滤、拦截等业务判断一律归各业务弹窗组件自行处理（曾在 v1.1 误加 preShow，已移除，见 2026-08-27 日志）。
- **业务弹窗组件约定**：
  - `render(rawData, closeFn)` 开头做去重判断，不通过返回 `null`（PopupManager 忽略、不建实例）；通过则先标记内存指纹再建 DOM。
  - 返回 `{ update, close }`：`update(newRawData)` 内同样去重——重复指纹忽略（保持现有弹窗不被关），新指纹刷新内容；`close` 时做收尾（如存 localStorage 缓存）。
- **外部调用统一**：`PopupManager.show('类型', rawData)`（类型如 'will-in-out' / 'conflict' / 'recognition' / 'overlength'），业务弹窗不暴露全局 show API。
- 钢坯长度超限报警 → OverlengthDialog.js（类型 'overlength'，2026-09-03 新增，仅中棒线加热炉使用）：指纹=炉号|钢坯号，确认后同钢坯不再弹，MAX_CACHE=20；rawData={furnaceCode,msgTime,items:[{inMatNo,pos,lengthMm}]}，明细按 pos(道次) 升序
- 缓存 key 带产线编码：`<类型>_cache_<产线编码>_<炉号>`，产线编码在弹窗组件内 `LINE_CODE` 常量（中棒=B1），多产线并存互不干扰。
- 表格点击弹窗 → 可视化相关/TableClickPopup.js

## 产线编码与缓存仓库 key 约定（2026-09-12 确认）
- 产线编码：**大棒 = H8**、**扁棒 = H9**、**中棒 = B1**（另有 大棒加热炉接口 wholeBacklogCode=H7,H8）
- 轧机脚本的 localStorage 四仓库 key 前缀 = 产线编码：`<编码>_SteelFactStore` / `_SteelStateStore` / `_RenderCacheStore` / `_HmdPassStore`
  - 扁棒线轧机.js = H9_，中棒线轧机.js = B1_，大棒线轧机.js = H8_（2026-09-12 由 B1_ 改）
  - 目的：多条产线在同一浏览器打开时缓存互不覆盖
- 「最近十卡」接口 `bptdatrollopact/list` 的 `FilterFields.ProductLine` 同样填产线编码（扁棒 H9、大棒 H8）
- 注意：产线脚本内另有 `Line` 参数（如中棒 `B101`），与产线编码不是同一个值；大棒线轧机.js 中该值出现在已注释代码里，尚未确认大棒取值

## 大棒线轧机.js 状态（2026-09-12）
- 由 中棒线轧机.js **首次复制**而来，两者**结构完全一致**（顶层声明逐一对应，行号 = 中棒 + 1），实质差异仅两处：
  1. 仓库 key 前缀与最近十卡 `ProductLine` 已改为大棒值（H8_ / H8）
  2. 初始化段多一行生效的 `dm.getDatas().each(node => trySetDoubleClickHandlerForNode(node));`（中棒同名调用只在文件末尾注释块内；该函数两文件均未定义，属外部全局函数）
- 文件头已重写（标题/@file = 大棒线轧机.js），新增【产线信息】【大棒线适配说明（后续开发必读）】【外部依赖】【版本记录】（v1.0 2026-09-12 首次复制生成）
- 遗留：已注释的「右键菜单逻辑」「左键弹窗逻辑」两段内仍写死中棒的 `"B101"`（Line 参数），待确认大棒取值后替换；常量沿用中棒，需按大棒现场图纸核对
- AriView/ → 图扑（TopoSoft/HT for Web）部署包。2026-09-02 起用户确认「AriView 是最后要发布的」，弹窗组件以 AriView/libs 为唯一维护源（原"本地主版本/图扑副本"约定对弹窗组件废止）；大冶特钢/ 产线脚本定位是否同样迁移待用户确认

## 本机网络环境 / 工具脚本（2026-09-11，同日按实测更新）
- 双出口：WiFi `WLAN`(Intel Wi-Fi 6E) = 内网 192.168.1.102/24（网关 192.168.1.1，DNS 172.15.88.1/88.2）；USB `以太网 2`(Remote NDIS 共享) = 外网 10.247.27.31/24（网关 10.247.27.133，度量 25）
- 内网为 172 开头（实测 172.15.x）：`bar.dayesteel.com.cn` → 172.15.115.121
- 路由开关工具 → `tools/net-route-switch.ps1`（双击 `tools/net-route-switch.bat` 进菜单：1 开 / 2 关 / 3 状态；改路由需 UAC）：on = 内网 172.0.0.0/8 走 WiFi 网关 + 外网固定走 USB（接口度量 10/60 + 静态路由），off = 按记录精确还原；状态文件 `%LOCALAPPDATA%\net-route-switch\state.json`，运行日志同目录 `last-run.log`
- 工具当前只认「WiFi = 内网 / USB 类网卡 = 外网」这一组合：`Get-Adapters` 硬性排除 InterfaceDescription 含 `Bluetooth` 的网卡，且候选取 `Get-NetAdapter -Physical`。改成「蓝牙 + WiFi」双出口需改配置区排除项/匹配词与网卡角色指定（2026-09-15 评估，未实施）
- **`Set-NetIPInterface -InterfaceMetric` 会同时写进注册表持久存储**（`HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{GUID}\InterfaceMetric`）：只做 `-AutomaticMetric Enabled` 不够，USB/NDIS 网卡一重连旧度量又生效；脚本恢复时活动存储与注册表一起处理
- **.ps1 必须带 UTF-8 BOM**：`write_to_file` 写出的 ps1 无 BOM，PowerShell 5.1 按 ANSI 解码中文会撑破字符串引号、报大量假语法错；补 BOM 后再用 Parser 校验
- Windows shell 内联 PowerShell 传参：外层用单引号包裹、内层单引号写成 `''`，否则引号被吞；脚本路径用相对 ASCII 路径（如 `tools/xxx.ps1`）避开中文路径
- PowerShell 正则**嵌套捕获组会占用组号**（`(\d+(\.\d+){3})` 里内层组是 2 号），取 `$Matches[n]` 一律改用命名组

## 扁棒线轧机.js 设计要点
- 两条轨道（track-1/roll-y1, track-2/roll-y2），每段 1800
- 逻辑坐标空间 0~3600，钢坯从右→左运动（headX/tailX 递减）
- 画布映射统一公式 `canvasX = logicX - trackStart`，两条轨道视觉方向一致
- 下线条件：`headX <= 0` 或 tailPosition 为 'BslHmd'
- 设计文档：`大冶特钢/棒材厂/扁棒线/扁棒线轧机.md`
- 重影防护（2026-09-15 修复）：数据监听器整体用 `window.__trackingListenerInstalled` 全局标记包裹，防脚本被页面/图纸重复加载导致监听器注册多份（做法对齐中棒线轧机.js）；另扁棒文件顶部有「启动时清理 dm 中残留 steel-* Shape」（中棒无此段），两层互补
- 主循环防重复启动（2026-09-15 修复，扁棒+中棒）：`startSteelSimulator()` 用 `window.__steelSimulatorTimer` 存句柄，「先 clearInterval 旧的，再起新的」，保证同页面只有一个 100ms 推演+渲染循环（重复加载会让两个循环互相覆盖 animationFrames 句柄 → cancel 失效 → 钢坯抖动/重影）。注意推演本身按真实 dt 算，速度不会翻倍，问题只在渲染/动画层
- DataCollector 防重复实例化（2026-09-15 修复，扁棒+中棒）：顶层改用 `if (window.__dataCollector) { window.__dataCollector.stop(); } const dataCollector = window.__dataCollector = new DataCollector(graphView);`（`start()` 内的 `this.isRunning` 守卫只管同一实例重复启动，管不了脚本重复加载产生的跨实例）
- ⚠️ 待确认隐患：大棒线轧机.js 主循环仍是裸 setInterval（约 2752 行），DataCollector 实例化处（约 3584 行）也未加 window 兜底

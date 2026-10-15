# topo-scripts — 图扑前端可视化代码仓库

本仓库是**关于前端可视化的代码仓库**，存放基于图扑（TopoGraph / HT for Web）平台开发的可视化监控脚本。
下半部分「项目交接文档」是新人/接手人必读，包含架构、约定、坑点与待办。

## 仓库定位

- **平台**：图扑 TopoGraph（HT for Web）
- **业务**：棒材轧线跟踪可视化 —— 钢坯运动模拟、加热炉出入炉、剪切台、弹窗交互
- **对应图扑平台项目**：冶钢棒材轧线跟踪

## 目录结构（单位 → 厂区 → 产线）

```
topo-scripts/
├── README.md
├── 大冶特钢/                    # 单位
│   └── 棒材厂/                  # 厂区
│       ├── 大棒线/              # 产线（产线编码 H8）
│       │   ├── 大棒线轧机.js
│       │   ├── 大棒一号加热炉.js
│       │   └── 大棒二号加热炉.js
│       ├── 中棒线/              # 产线（产线编码 B1，轧机为主版本）
│       │   ├── 中棒线轧机.js
│       │   ├── 中棒线加热炉.js
│       │   ├── 中棒3#剪切台.js
│       │   └── 1炉.mp3 / 2炉.mp3
│       ├── 小棒线/              # 产线
│       │   ├── 小棒线轧机.js
│       │   ├── 小棒线一号加热炉.js
│       │   └── 小棒线二号加热炉.js
│       └── 扁棒线/              # 产线（产线编码 H9）
│           ├── 扁棒线轧机.js
│           ├── 扁棒线轧机.md     # 扁棒线设计文档
│           └── 扁棒线加热炉.js
├── 青岛特钢/
│   └── 扁棒加热炉跟踪.js
├── 可视化相关/
│   ├── index.vue
│   ├── nginx.conf
│   └── TableClickPopup.js       # 表格点击弹窗
├── AriView/                     # 图扑部署包 = 最终发布物（libs/ 下含弹窗组件唯一维护源）
│   └── libs/通用组件/弹窗组件/   # 9 个 js + 2 个 mp3
└── tools/                       # 本机辅助脚本（网络路由开关、JSON 对账等，非交付物）
```

新增单位、厂区、产线时，在对应层级添加目录即可。

---

# 项目交接文档

> 面向接手人：先读这一节，再动手。文档事实以仓库记忆 `.codebuddy/memory/` 与代码文件头为准。
> 最后整理：2026-10-15

## 1. 系统是什么

冶钢棒材轧线跟踪系统：把现场 PLC/MES 数据（钢坯位置、热检 HMD、冷床、加热炉出入库）通过接口拉到前端，
用图扑 HT 画布还原钢坯在轧线上的**实时运动与位置**，并提供节点点击弹窗、报警弹窗等交互。

四条产线：**大棒线（H8）、中棒线（B1）、小棒线、扁棒线（H9）**。

## 2. 代码分三层，改哪层影响谁

| 层 | 位置 | 说明 |
|---|---|---|
| 产线脚本 | `大冶特钢/棒材厂/<产线>/*.js` | 每条产线独立一份，逻辑**不通用** |
| 弹窗组件 | `AriView/libs/通用组件/弹窗组件/` | 唯一维护源（原本地 `通用组件/` 已于 2026-09-02 删除） |
| 部署/发布 | `AriView/`（图扑部署包） | 2026-09-02 用户确认：**AriView 是最终发布物** |

**最关键的一条：改仓库 .js ≠ 改现场。**
页面只加载图扑画面 JSON（如 `displays/DaYeTeGang/大棒线轧机.json`），脚本本体存在 JSON 的 `a.onPostDeserialize`
字段里（`__ht__function(json, dm, view, datas){...}`，去掉包装头尾即等于本地 js 全文）。
因此本地改完必须**整段粘进图扑**才生效；图扑上改完必须**整段复制回本地**才不丢。

## 3. 产线对照表与各自状态

| 产线 | 编码 | 轧机脚本 | 加热炉脚本 | 备注 |
|---|---|---|---|---|
| 大棒 | H8 | 大棒线轧机.js（约 3711 行，头部 2026-10-15 精简为 45 行） | 大棒一号/二号加热炉.js | 由中棒线轧机复制而来，仍有中棒残留待现场核对 |
| 中棒 | B1 | 中棒线轧机.js（**源头主版本**） | 中棒线加热炉.js | 含 7 个【中棒独有】插件，见 §6 |
| 小棒 | — | 小棒线轧机.js | 小棒线一号/二号加热炉.js | 无中棒那 7 个插件 |
| 扁棒 | H9 | 扁棒线轧机.js（独立编写） | 扁棒线加热炉.js | 两轨结构，设计文档 `扁棒线轧机.md` |

**扁棒线要点**（涉及扁棒坐标前先读 `大冶特钢/棒材厂/扁棒线/扁棒线轧机.md`）：
只有一个加热炉一个轧线，编号 H9、加热炉参数 A1；两条轨道逻辑坐标 0~3600，钢坯右→左运动；
画布映射 `canvasX = logicX - trackStart`。

**大棒线要点**：轨道 2 段且**不等长** —— `TRACK_LENGTHS = [1800, 720]`，全长 2520；
下线阈值用 `LINE_TOTAL_LENGTH`；逻辑坐标 → 画布 = `logicX - TRACK_STARTS[i]`。

## 4. 同步流程与版本约定（铁律）

```
本地 → 图扑：改代码 → 更新文件头版本号 → git commit → 整段粘进图扑 → 在线测试
图扑 → 本地：图扑调试通过 → 整段复制回本地 → 更新文件头版本号 → git commit
```

两条铁律：
1. **图扑上的临时调试改动，当天必须复制回本地并提交**，否则关页面就丢了
2. **每次提交前先更新文件头版本注释**，版本号是两份代码"谁新谁旧"的唯一对账依据

文件头版本块写法：

```js
/**
 * 【版本记录】
 * v3.2  2026-08-24  变更说明
 * v3.1  2026-08-20  变更说明
 */
```

提交信息格式：`类型: 功能点`（如 `feat: 弹窗定位改为点击点标定法`）。

⚠️ 已知风险（2026-10-15）：本地 `大棒线轧机.js` 版本记录为 **v1.0~v1.10**；
设计档案里曾出现的 v2.0/v2.1 与 2026-10-14 日志的 v2.2/v2.3 **已随代码回滚作废**，当前代码中不存在。
若发现"档案说有、代码里没有"，以**代码为准**。

## 5. 接口与数据

- 主机两种写法：**公网网关** `https://bar.dayesteel.com.cn/...`（新，统一目标）与**内网直连** `http://172.15.88.243:900X/:808X`（旧，逐步淘汰）
- 网关门牌映射：大棒 `api124/BarHeatFurnaceg/TRACK_BIG`、中棒 `api125/.../TRACK_MIDDLE`、小棒 `api126/.../TRACK_SMALL`、扁棒 `api127/.../TRACK_FLAT`
- 业务接口前缀统一 `bar.dayesteel.com.cn/api/api/bdy/...`；内网 `:9003` = bdy 业务接口
- 加热炉画面 JSON 的**按钮节点 `a.onClick` 内另外写死 4 条完整 URL**（`/SLAB/IN`、`/SLAB/OUT`、`/WALKINGBEAM/FORWARD`、`/WALKINGBEAM/BACKWARD`），本地 js 中不存在，**改接口只能改 JSON**
- 对账工具（本机辅助，非交付物）：`tools/_jsonmap3.ps1`（映射+结构比对）、`tools/_jsondiff.ps1`（逐行差异）、`tools/_apilist.ps1`（接口清单）

## 6. 跨产线：默认不通用

**改任意产线脚本时，若用户没明确说"通用逻辑改动"，一律按该产线独立逻辑处理，不要顺手同步到其他产线。**
各产线有各自独有的工艺规则。已知实例：

- 中棒线轧机的 7 个插件 `applyLengthLockAt620` / `applyHeadBlockAt1000` / `applyTailSpeedAtStand16ExitHmd` /
  `applyTailJumpAt1750` / `applyTailJumpAt3100` / `applyTailJumpAt3350` / `applySteelPauseAt1100` 已标注 **【中棒独有】**，
  扁棒/大棒不要引入；大棒曾误复制这 7 个，已于 v1.1 删除，也不要加回
- 「短坯交替显示」（`inMatLen ≤ 8000` 左右交替）**仅中棒线加热炉.js** 有，勿跨线套用
- 大棒特殊下线规则：卡号以 **H8** 开头且头部到 1800 下线（H8 = 轧线一期，H7 = 轧线二期；**不要**把 H7/H8 当成加热炉编号，也不要和后端 `wholeBacklogCode` 混为一谈）

## 7. HT for Web（图扑）API 陷阱

- **没有 `graphView.tp()`**（调用会抛 TypeError）
- 点击点逻辑坐标：`graphView.getLogicalPoint(event)`；缩放：`graphView.getZoom()`（必要时兜底 `zoomFactor`）
- 节点坐标优先 `getAbsolutePosition()`（节点可能挂在父节点下）；旋转 `getRotation()` 是**弧度**
- 弹窗定位永远贴节点包围盒**外侧**，不做会压回节点的裁剪
- 防重复注册监听器：统一用 `window.__trackingListenerInstalled` 全局标记；多个数据源合并为一个 `addDataPropertyChangeListener`，按 `e.property` 分发
- 主循环防重复启动：`window.__steelSimulatorTimer` 句柄，先 `clearInterval` 旧的再起新的（中棒/扁棒已修，**大棒仍是裸 setInterval，未同步**）
- 文本显示：图纸节点可能绑 `displayText` 或 `displayContent`，不确定就两个都写；显示/隐藏以数据是否有值为准，别依赖 `isUnknown`

## 8. 弹窗组件（`AriView/libs/通用组件/弹窗组件/`）

9 个 js + 2 个 mp3，实为**三条互不相干的体系**，改一个别顺手改另一个：

- **链路 A（钢坯信息小弹窗）**：节点 onClick → `window.appBridge.runNodeClickPlugins()`（Dispatcher.js）
  → DialogMain.js → DialogCore.js 建 DOM + `calcPopupPosition` 定位。**四条产线加热炉共用**，改 DialogCore 等于改全部四条线。
- **链路 B（业务报警弹窗）**：业务脚本 → `PopupManager.show('类型', rawData)` → 4 个自注册弹窗：
  `will-in-out`（待入炉/待出炉）、`conflict`（入炉位置校准身份变更）、`recognition`（炉号识别不一致）、`overlength`（钢坯长度超限，仅中棒线加热炉用）。
- **DialogView.js（`DialogSystem`）**：通用「确认/取消 + 调接口」状态机弹窗，目录内无人引用，外部引用**待核实**。

硬约束：
- **PopupManager 是纯管理器**，禁止往里加业务判断钩子（preShow 已移除），去重/过滤一律归各业务弹窗的 `render`/`update`
- `render(rawData, closeFn)` 返回 `null` = 不显示；否则返回 `{ update, close }`
- 缓存 key：`<类型>_cache_<产线编码>_<炉号>`；`LINE_CODE` 目前三处均硬编码 `'B1'`，其他产线启用同类报警需扩展
- 三个报警弹窗「缓存写入时机不一致」：ConflictDialog 只有点**确认**才写，Recognition/Overlength 是 close 即写（含点遮罩关闭）
- 音频：ConflictDialog 用 `furnace1.mp3`/`furnace2.mp3`，路径有四级兜底；**搬文件必须连同 mp3 一起搬**
- 改完需连同图扑部署副本对账（本目录就是发布物本体）

## 9. 本机环境与工具

- 双出口网络：WiFi = 内网 172.15.x，USB/以太网 = 外网；切换用 `tools/net-route-switch.bat`（菜单 1/2/3/4，改路由需 UAC）
- Windows/PowerShell 高频坑：
  - commit 消息含中文易报「字符串缺少终止符」→ 用英文消息
  - 含中文路径的 shell 命令会 GBK 乱码 → 不要 cd 中文路径，改用 IDE 工具读写文件
  - `.ps1` 必须带 **UTF-8 BOM**，否则中文被 ANSI 解码撑破引号
- 规则与脚本位置：`.codebuddy/rules/`、`tools/`

## 10. Git 与仓库约定

远程：`https://github.com/precisionFire/topo-scripts.git`（分支 `main`，已设上游跟踪）

```powershell
git add -A
git commit -m "feat: 说明本次改动"
git push

git pull          # 图扑调试完同步回本地后，先拉远端
git status
git log --oneline
```

- 必须使用 `http.version HTTP/1.1`，否则经代理 TLS 握手失败（已写入仓库级 git 配置）
- 大文件推送相关 `http.postBuffer` / `http.lowSpeedLimit` 已调大；首次使用 git 需重开终端（PATH 刷新）
- **`.codebuddy/` 整体不入库**（2026-10-15，commit `46c44e6`）：记忆/日志/规则只在本机，换机器拿不到（历史 commit 中仍有此前版本可回溯）
- 教训可复用：`.gitignore` 对**已入库**文件不生效，加忽略后必须 `git rm -r --cached <path>`；判断依据 `git ls-files -- <path>`

## 11. 当前遗留待办 / 悬空项

代码层面（大棒线为主，2026-09-17 审计 + 2026-10-15 复核）：

1. `MILL_ZONES` 边界 3380/3550/5400 越出全长 2520（FINISH/ROLL5 不可达，1800~2520 全落 ROLL4），需按大棒工艺重定并同步 `SPEED_CONFIG`
2. 大棒图纸**点表严重不匹配**：图纸 tag 仅 22 个（中棒 120 / 扁棒 124），HMD 只有 1 个而脚本引用 21 个 → 若照现脚本发布，`All_POSITION_MAP`/`TRACK_POSITION_MAP` 全空，尾速写 0、HMD 校正与集合点控制空转
3. 大棒图纸节点名不匹配（脚本用 `liuliang`/`Team`/`Shift`/`tenCardNo`，图纸只有 `line`/`date`/`班组`）→ 图表与弹窗静默失效
4. 大棒 `startSteelSimulator` 裸 setInterval、DataCollector 无 window 兜底（中棒/扁棒已修，大棒未同步）
5. 大棒注释代码里残留中棒 `Line` 参数 `"B101"`，大棒取值待现场确认
6. 设计档案 §十四 列的 6 项「代码有、版本记录未覆盖」功能待补正式版本条目

弹窗组件层面（`.codebuddy/memory/MEMORY-弹窗组件.md` §十）：

7. `DialogView.js` 是否仍被外部引用，待核实
8. `WillInOutPopup` 单↔双面板切换时 `_updateDOM` 对齐行为（可能需改为重建）
9. `will-in-out` 的调用方未在目录内体现
10. 各业务弹窗 `LINE_CODE` 写死 `'B1'`，其他产线启用同类报警需扩展
11. `DialogCore`/`DialogMain` 里的调试 console 日志是否清理，需确认（当前是现场排查依据）

## 12. 记忆与档案在哪

记忆只在**本机** `.codebuddy/memory/`（不入库）：

| 文件 | 内容 |
|---|---|
| `MEMORY.md` | 总索引：文件定位索引、产线编码、接口、协作偏好、Git 约定 |
| `MEMORY-产线脚本.md` | 大/中/扁棒轧机复制历程、中棒独有插件、头部对齐、扁棒设计要点、大棒中棒残留审计 |
| `MEMORY-弹窗组件.md` | 弹窗目录 9 个 js 逐文件档案、两条链路、差异表、音频报警演进、硬约束 |
| `MEMORY-环境工具.md` | 双出口网络、路由开关工具、PowerShell 踩坑 |
| `大棒轧线设计.md` | 大棒线轧机.js 设计档案（含原 162 行头部注释原文与 v1.0~v1.10 版本记录） |
| `记录链权重策略.md` | 记录落点策略 `W=2D+S+P+T`（L0 代码注释 / L1 日志 / L2 设计 / L3 MEMORY） |
| `YYYY-MM-DD.md` | 每日工作日志（只增量追加，不覆写） |

纪律：回答项目问题**先查记忆索引再搜代码**；禁止全库广撒网搜索；`AriView/` 默认只读不搜索（弹窗组件例外，它是维护源）。

## 13. 新人上手清单

1. 读本文件上半部分 + §1~§4，弄清「本地 .js / 图扑 JSON」的两份代码关系
2. 认领产线后，先读该产线脚本的**文件头注释**和（若有）设计文档
3. 动手前先按 `.codebuddy/memory/MEMORY.md` 的「文件定位索引」定位目标文件，不要凭记忆改
4. 改动范围默认**只改当前产线当前文件**，跨产线通用化必须先确认
5. 改完：更新文件头版本注释 → `read_lints` 确认 0 错误 → git commit → 复制到图扑验证 → 图扑验证通过后复制回本地再 commit
6. 收尾按「记录链权重策略」声明记录落点（日志 / 设计档案 / MEMORY）

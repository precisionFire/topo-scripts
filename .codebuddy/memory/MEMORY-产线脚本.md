# 记忆分卷 · 产线脚本（自 MEMORY.md 整段搬迁，原文未改）

> 本文件由 MEMORY.md 拆分而来，用于超限治理；后续增补产线脚本相关内容时直接写在这里。

## 大棒线轧机.js 状态（2026-09-12）
- 由 中棒线轧机.js **首次复制**而来，两者**结构完全一致**（顶层声明逐一对应，行号 = 中棒 + 1），实质差异仅两处：
  1. 仓库 key 前缀与最近十卡 `ProductLine` 已改为大棒值（H8_ / H8）
  2. 初始化段多一行生效的 `dm.getDatas().each(node => trySetDoubleClickHandlerForNode(node));`（中棒同名调用只在文件末尾注释块内；该函数两文件均未定义，属外部全局函数）
- 文件头已重写（标题/@file = 大棒线轧机.js），新增【产线信息】【大棒线适配说明（后续开发必读）】【外部依赖】【版本记录】（v1.0 2026-09-12 首次复制生成）
- 遗留：已注释的「右键菜单逻辑」「左键弹窗逻辑」两段内仍写死中棒的 `"B101"`（Line 参数），待确认大棒取值后替换；常量沿用中棒，需按大棒现场图纸核对
- AriView/ → 图扑（TopoSoft/HT for Web）部署包。2026-09-02 起用户确认「AriView 是最后要发布的」，弹窗组件以 AriView/libs 为唯一维护源（原"本地主版本/图扑副本"约定对弹窗组件废止）；大冶特钢/ 产线脚本定位是否同样迁移待用户确认

## 大棒线轧机.js 插件清理（2026-09-15）
- 删除原因（用户明确，2026-09-15）：**这 7 个 apply* 函数是中棒线独有逻辑**，是大棒线轧机从中棒线复制时的残留，不属于大棒工艺 → 必须从大棒中删除（与扁棒的删除动机不同，扁棒是「通用清理所有独立函数」）
- 推论：中棒线轧机.js **应保留**这 7 个插件（小棒线无此 7 个函数），不要再建议清理中棒；大棒线同理也不应再建议加回
- v1.1 删除 7 个独立插件函数清单：
  `applyLengthLockAt620` / `applyHeadBlockAt1000` / `applyTailSpeedAtStand16ExitHmd` /
  `applyTailJumpAt1750` / `applyTailJumpAt3100` / `applyTailJumpAt3350` / `applySteelPauseAt1100`
- 连带删除 6 个专属 tracker（保留 `steelCollectionTracker` + `headBlockedState`）；主循环步骤号重排为 5 步（状态→速度→集合点→位置→离线）；文件 3705 → 2807 行，lint 0 错误
- `applyCollectionPointControl` 内 `steelPauseTracker[key].paused` 早退块一并删除（只服务被删插件）
- 中棒/大棒的「主循环裸 setInterval」「DataCollector 跨实例」隐患见本日日志条目

## 中棒线轧机.js 7 个插件标注【中棒独有】（2026-09-15）
- 用户要求「标明为中棒独有逻辑」后，在中棒线轧机.js 做了 3 处增量改动（无功能/代码修改，纯注释）：
  1. 顶部 JSDoc 末尾加【插件归属说明】段（@file 等注解后），写明 7 个 apply* 不可被其他产线复制
  2. 文件 1456 行「运动求解器」12 步流程注释：步骤 3/5~10 的 7 个 apply* 行尾加 `【中棒独有】`，并加一行总结（"扁棒/大棒线轧机不应引入"）
  3. 每个 apply* 函数 JSDoc 标题行下加一行 `* 【中棒独有】此函数是中棒线工艺专属逻辑，其他产线（扁棒/大棒）不要复制引入。`
- lint 0 错误
- 中棒线轧机.js 原无【版本记录】块（仅大棒线有），本次不新建，沿用最小增量原则
- 意义：从此 7 个 apply* 在中棒文件里有显式归属声明，将来任何人/AI 复制本文件到其它产线时能立刻识别；与大棒线 v1.1 的「删除动作」形成「中棒声明归属 / 大棒不引入」的双向约定

## 三大产线轧机头部 JSDoc 块结构对齐（2026-09-15）
- 用户原话：「扁棒，中棒的头部注释需要增加现在大棒头部注释的多出来的几块描述」
- 大棒线轧机.js 头部有 4 个块是其它两线原本没有的：【产线信息】【大棒线适配说明（后续开发必读）】【外部依赖】【版本记录】
- 最终对齐：4 块**全部复制**到扁棒/中棒，【X 线适配说明】按产线调整：
  - 【扁棒线适配说明】= 大棒版本 4 条结构，"大棒"替换为"扁棒"，"沿用中棒版本"改为"按扁棒现场图纸核对"
  - 【中棒线适配说明】= 大棒版本 4 条结构，"大棒"替换为"中棒"；中棒为源头/主版本，所以在块首注明"无'从中棒复制'产生的适配项；保留以下结构（与大棒线头部对齐，便于跨产线阅读）"，第 2 条"无源产线专有字面量需替换"
- 扁棒线轧机.js 头部补充内容：产线编码 H9，缓存 key 前缀 H9_，独立编写/两轨结构
- 中棒线轧机.js 头部补充内容：产线编码 B1，缓存 key 前缀 B1_，本文件为主版本/独立编写；版本记录同时记录「同日 7 个 apply* 函数加【中棒独有】标识」
- 两个文件均从 v1.0 开始（首个【版本记录】条目的"补充即新建"惯例）
- 头部整体顺序：运行机制 → 产线信息 → X 适配说明 → 外部依赖 → 版本记录 → @file/@requires →（中棒）【插件归属说明】/（扁棒）直接 JSDoc 收尾
- lint 0 错误

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

## 大棒线轧机.js 轨道数 3 → 2，且两段【不等长】（2026-09-17，v1.2 / v1.3）
- v1.2：现场图纸大棒轧线只有 roll-y1 / roll-y2 两段轨道，脚本同步为 2 段（`rolly1/rolly2`、`getYTrack` 仅 case 0/1、形状循环 `i < 2`）。
- v1.3（用户确认的现场事实）：**第 1 段 1800、第 2 段只有 720**，全线上限 2520。
  - 新增 `TRACK_LENGTHS = [1800, 720]` / `TRACK_COUNT` / `TRACK_STARTS`（累加起点 [0,1800]）/ `LINE_TOTAL_LENGTH`（2520），删除等长的 `segmentLength`；渲染裁剪与 track-* 坐标偏移全部改用它；下线阈值 5400 → `LINE_TOTAL_LENGTH`。
  - 约定：逻辑坐标 → 画布坐标 = `logicX - TRACK_STARTS[i]`（第 2 段减 1800）。
- ⚠️ 未解决：`MILL_ZONES` 边界 3380/3550/5400 越出 2520（FINISH/ROLL5 不可达，1800~2520 全落 ROLL4），整表是中棒常量，需按大棒工艺重定并同步 `SPEED_CONFIG`；H8_ localStorage 缓存可能残留旧坐标，建议现场清一次。详见 2026-09-17 日志。

## 大棒线轧机「中棒残留」审计结论（2026-09-17，只读）
- **发布链路**：页面只加载 `displays/DaYeTeGang/大棒线轧机.json`，脚本本体存 `json.a.onPostDeserialize` → 改仓库 .js 不等于改现场；**仓库里那份大棒图纸内嵌脚本仍是 3 段轨道时代**（`segmentLength`、`i < 3`、`roll-y3`/`rolly3`，无 `TRACK_LENGTHS`），故 v1.2/v1.3 两段不等长改动尚未生效。
- **点表与图纸严重不匹配**（最要命的一条）：图纸 tag 数 中棒 120 / 扁棒 124 / **大棒仅 22**；大棒图纸上 HMD 只有 `track-1-DescalerBeforeHmd`（另加疑似笔误 `track-1-1DescalerBeforeHmd`），millstate 仅 1~6，而脚本引用 21 个 HMD 名 → 只 1 个存在。
- 大棒 .js 工作区的 `PHYSICAL_ORDER` 已被换成 `track-1-aaa/bbb + H1HotDet~H8HotDet + ShearPre6_1mHotDet + ShearAfterRollerDetect` 一套（HEAD 仍是中棒那套；该套名字全仓库仅此一处，来源待确认）。若按此发布 → `All_POSITION_MAP`/`TRACK_POSITION_MAP` 全空 → 尾速被写 0（画面只伸长）、HMD 校正与 HmdPassStore 全跳过、集合点控制/离线条件 2 空转。
- 现场自检：打开大棒页面看启动日志 `TRACK_POSITION_MAP` / `All_POSITION_MAP`（约 254-255 行打印）或输入 `.size` 判断是否为空。
- 大棒图纸另有节点名不匹配：脚本用 `liuliang` / `Team` / `Shift` / `tenCardNo` / `再次确认`，图纸里只有 `line` / `date` / `班组` 等 → 相关图表与弹窗静默失效（右键菜单、左键弹窗两段整体注释未启用，含 `B101`）。
- 大棒线 `startSteelSimulator` 仍是裸 setInterval、DataCollector 无 window 兜底（中棒/扁棒已修，大棒未同步）。

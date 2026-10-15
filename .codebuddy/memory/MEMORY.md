# 项目记忆

## 项目概述
冶钢棒材轧线跟踪系统，包含四条产线：大棒线、中棒线、小棒线、扁棒线，以及通用弹窗组件。

## 记忆分卷索引（长段已整段搬迁到子文件，原文未删改）
- 产线脚本（大棒/中棒/扁棒轧机：复制历程、插件清理、【中棒独有】标注、三线头部对齐、轨道 3→2 不等长、扁棒设计要点、大棒「中棒残留」审计）→ 见 `.codebuddy/memory/MEMORY-产线脚本.md`
- 本机网络环境 / 工具脚本（双出口、路由开关、Windows/ps1 踩坑）→ 见 `.codebuddy/memory/MEMORY-环境工具.md`
- 大棒轧线设计（大棒线轧机.js 原头部注释 + 版本记录原文、产线信息、适配说明、变更历史）→ 见 `.codebuddy/memory/大棒轧线设计.md`

## 文件定位索引（先查这里，避免全库搜索）
- 扁棒线加热炉 → 大冶特钢/棒材厂/扁棒线/扁棒线加热炉.js
- 扁棒线轧机 → 大冶特钢/棒材厂/扁棒线/扁棒线轧机.js（设计文档：同目录 扁棒线轧机.md）
- 小棒线加热炉 → 大冶特钢/棒材厂/小棒线/小棒线加热炉.js
- 中棒线加热炉 → 大冶特钢/棒材厂/中棒线/中棒线加热炉.js
- 中棒线轧机 → 大冶特钢/棒材厂/中棒线/中棒线轧机.js
- 中棒剪切 → 大冶特钢/棒材厂/中棒线/中棒3#剪切台.js
- 大棒线轧机 → 大冶特钢/棒材厂/大棒线/大棒线轧机.js（约 3711 行；2026-10-15 头部已精简为 45 行，原头部注释与 v1.0~v1.10 版本记录整段移入 `.codebuddy/memory/大棒轧线设计.md`（§十三 摘要 / §十七 原文），该档案同日已按当前代码整体重生成）
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

## 接口地址形式与画面 JSON 内嵌结构（2026-09-15）
- 接口主机两种写法：**公网网关**`https://bar.dayesteel.com.cn/...`（新，各产线统一目标）与**内网直连**`http://172.15.88.243:900X / :808X`（旧，逐步淘汰）
- 网关门牌映射（产线 → apiNNN）：大棒 `api124/BarHeatFurnaceg/TRACK_BIG`、中棒 `api125/.../TRACK_MIDDLE`、小棒 `api126/.../TRACK_SMALL`、扁棒 `api127/.../TRACK_FLAT`；`bdy` 类业务接口统一 `bar.dayesteel.com.cn/api/api/bdy/...`
- 内网端口映射：`:9003` = bdy 业务接口、`:8081` = 扁棒加热炉(TRACK_FLAT)、`:8082` = 小棒加热炉(TRACK_SMALL)
- 画面 JSON 的脚本存放形态：`a.onPostDeserialize` 存 `__ht__function(json, dm, view, datas) { ... }`，去掉包装头尾即等于本地 js 全文（据此可做双向对账）
- 加热炉画面 JSON 除主脚本外，还有**按钮节点 `a.onClick` 内写死的 4 条完整 URL**（`/SLAB/IN` 手动入炉、`/SLAB/OUT` 手动出炉、`/WALKINGBEAM/FORWARD` 步进正、`/WALKINGBEAM/BACKWARD` 步进反）；这 4 条在本地 js 中不存在，改接口时只能改 JSON
- 对账工具（仅本地辅助，非交付物）：`tools/_jsonmap3.ps1`（比对映射+结构）、`tools/_jsondiff.ps1`（逐行差异）、`tools/_apilist.ps1`（接口清单）；均需注意含中文字面量的 .ps1 要带 UTF-8 BOM

## 产线分期命名约定（2026-10-13 用户确认）
- **H8 = 轧线一期**，**H7 = 轧线二期**（与产线编码/接口 `wholeBacklogCode` 不冲突，那是后端字段值）。
- 应用：大棒线轧机.js v1.10「卡号 H8 开头、头部到 1800 下线」即此约定（一期钢坯的下线规则）。
- 不要在代码注释里把 H7/H8 称为"加热炉"或混用 wholeBacklogCode 与分期概念，详见 2026-10-13 日志那次踩坑。
- ⚠️ 2026-10-15 核对与结论：本地 `大棒线轧机.js` 头部版本记录为 **v1.0~v1.10**（v1.10 = 本日「卡号 H7→H8、头部到 1800 下线」+ 文件头补「轧线分期命名」块）；
  上一版设计档案里的 **v2.0 / v2.1**（整线匀速、删 MILL_ZONES、校正不推算）与 2026-10-14 日志的 v2.2 / v2.3 **已随用户回滚作废，当前代码里没有**；
  当前代码仍是 `MILL_ZONES` + `SPEED_CONFIG` 分区变速、`applyPositionCorrection` 带 time 时走 `forwardSimulatePosition` 推算。设计档案已于当日按代码整体重生成，详见 2026-10-15 日志。

## 协作偏好（2026-09-17 用户明确）
- 用户用 `@文件` 指定目标文件时，**只在该文件内做检查/修改**，不要去读同名/相关但未被指定的其它文件（当时我跑去翻 AriView 的画面 JSON，被用户直接质问"Why are you reading other files"）。需要跨文件信息时先说明理由并征得同意。
- **记忆文件不得"为压缩体量而删改"**（2026-09-17 用户明确）：MEMORY.md/日志超限时，禁止合并、删除或改写已有条目；减体量只能走「整段原文搬迁到子文件 / 下沉到日志」的方式，且必须先经用户确认。



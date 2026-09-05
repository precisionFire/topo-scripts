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
- AriView/ → 图扑（TopoSoft/HT for Web）部署包。2026-09-02 起用户确认「AriView 是最后要发布的」，弹窗组件以 AriView/libs 为唯一维护源（原"本地主版本/图扑副本"约定对弹窗组件废止）；大冶特钢/ 产线脚本定位是否同样迁移待用户确认

## 扁棒线轧机.js 设计要点
- 两条轨道（track-1/roll-y1, track-2/roll-y2），每段 1800
- 逻辑坐标空间 0~3600，钢坯从右→左运动（headX/tailX 递减）
- 画布映射统一公式 `canvasX = logicX - trackStart`，两条轨道视觉方向一致
- 下线条件：`headX <= 0` 或 tailPosition 为 'BslHmd'
- 设计文档：`大冶特钢/棒材厂/扁棒线/扁棒线轧机.md`

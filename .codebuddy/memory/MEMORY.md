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
- 弹窗组件 → 通用组件/弹窗组件/（ConflictDialog/DialogCore/DialogMain/DialogView/Dispatcher/PopupManager/WillInOutPopup/RecognitionDialog）

## 弹窗组件分层规则（PopupManager 设计初衷，2026-08-27 确认）
- **PopupManager 是纯管理器**：只做「注册类型 → 转发原始数据 → 同类型单例 + 生命周期管理」。
- **禁止在 PopupManager 内加业务判断钩子**（如 preShow/shouldShow），去重、过滤、拦截等业务判断一律归各业务弹窗组件自行处理（曾在 v1.1 误加 preShow，已移除，见 2026-08-27 日志）。
- **业务弹窗组件约定**：
  - `render(rawData, closeFn)` 开头做去重判断，不通过返回 `null`（PopupManager 忽略、不建实例）；通过则先标记内存指纹再建 DOM。
  - 返回 `{ update, close }`：`update(newRawData)` 内同样去重——重复指纹忽略（保持现有弹窗不被关），新指纹刷新内容；`close` 时做收尾（如存 localStorage 缓存）。
- **外部调用统一**：`PopupManager.show('类型', rawData)`（类型如 'will-in-out' / 'conflict' / 'recognition'），业务弹窗不暴露全局 show API。
- 缓存 key 带产线编码：`<类型>_cache_<产线编码>_<炉号>`，产线编码在弹窗组件内 `LINE_CODE` 常量（中棒=B1），多产线并存互不干扰。
- 表格点击弹窗 → 可视化相关/TableClickPopup.js
- AriView/ → 图扑（TopoSoft/HT for Web）项目部署包，只读不改、默认不参与搜索

## 扁棒线轧机.js 设计要点
- 两条轨道（track-1/roll-y1, track-2/roll-y2），每段 1800
- 逻辑坐标空间 0~3600，钢坯从右→左运动（headX/tailX 递减）
- 画布映射统一公式 `canvasX = logicX - trackStart`，两条轨道视觉方向一致
- 下线条件：`headX <= 0` 或 tailPosition 为 'BslHmd'
- 设计文档：`大冶特钢/棒材厂/扁棒线/扁棒线轧机.md`

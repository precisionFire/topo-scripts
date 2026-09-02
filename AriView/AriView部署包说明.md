# AriView 部署包说明文档

> 本文档基于对 AriView 部署包源码的梳理（2026-08-28），描述其目录架构、功能逻辑与运行机制。
> 定位：AriView 是图扑（TopoSoft / HT for Web）项目的**部署验证包**，即设计器发布/导出后的可运行副本。

---

## 1. 部署包概述

- **技术底座**：图扑 HT for Web（`ht.js` 核心 + `ht-vector.js` 等插件库），辅以 jQuery、Bootstrap、MQTT（`mqttws31.min.js`）、ECharts。
- **形态**：纯静态 Web 包，场景以 JSON（HT 序列化格式）存储，业务逻辑内嵌于各场景页 `<script>` 或独立 JS 文件中。
- **运行方式**：通过本地文件系统 / Web 服务器直接访问 `storage/index.html` 或 `storage/导入后出现的html文件/*.html`。
- **核心业务**：大冶特钢棒材厂四条产线（扁棒 / 中棒 / 小棒 / 大棒）的加热炉、轧机、冷床、剪切台钢坯实时跟踪展示，含钢坯信息弹窗、入出待办弹窗、冲突提示、历史数据查看等。

### 与本地仓库的关系（同步铁律）

- **本地仓库为主版本**（`大冶特钢/`、`通用组件/`、`可视化相关/`），AriView 为**验证副本**。
- AriView 原则上**只读不改**；若临时调试改动，**当天必须复制回本地并提交**，否则关页面即丢失。
- 弹窗组件：本地 `通用组件/弹窗组件/` 与部署包 `libs/` 下的同名文件一一对应，改动通用逻辑只改本地，再同步到 AriView。

---

## 2. 目录架构总览

```
AriView/
├── CSS/                        # 全局样式
│   └── dialog_.css             # 弹窗样式
├── Images/                     # 静态图片素材
├── Scripts/                    # 通用业务脚本（非场景专属）
│   ├── DispatchIndex.js        # 调度主页（导航 + 全屏 + MQTT 时钟）
│   ├── BillBoardIndex.js       # 综合看板主页（导航 + 全屏 + MQTT 时钟）
│   ├── bootstrap.bundle.min.js # Bootstrap 运行时（双击历史弹窗模态框依赖）
│   └── jquery.md5.js           # MD5 工具（登录）
│   （注：Dialog.js / dialog_.js 已于 2026-08-29 清理，历史弹窗逻辑内联进场景页）
├── Pages/                      # 页面目录（模板/备用）
├── custom/                     # 自定义配置与扩展
│   ├── configs/                # 图扑设计器/运行时配置
│   │   ├── htconfig.js         # HT 全局配置（convertURL 时间戳、toolTipDelay）
│   │   ├── config-points.js    # 测点选择器（编辑器插件）
│   │   ├── config-dataBindings.js  # 数据绑定配置（编辑器插件）
│   │   ├── config-valueTypes.js    # 值类型配置（编辑器插件）
│   │   ├── config-customProperties.js # 自定义属性配置（编辑器插件）
│   │   └── 2d/ 3d/             # 2D/3D 编辑器扩展
│   ├── libs/echarts.js         # ECharts 图表库
│   ├── images/                 # 图标素材（favicon 等）
│   ├── previews/               # 展示页模板
│   └── HistoricalDataDialog/   # 历史趋势弹窗：newDataDialog.html + libs/（bootstrap/flatpickr 依赖）
├── libs/                       # 核心库 + 弹窗组件（本地「通用组件/弹窗组件/」的部署副本）
│   ├── core/ht.js              # HT for Web 核心引擎（DataModel / GraphView 等）
│   ├── plugin/                 # HT 插件：ht-vector / ht-edgetype / ht-obj / ht-ui / ht-form /
│   │                           #   ht-textureLoader / ht-contextmenu / ht-fbx / ht-drawing / ht-cssanimation
│   ├── jquery.min.js           # jQuery
│   ├── bootstrap.min.css / bootstrap-icons.css  # Bootstrap 样式
│   ├── mqttws31.min.js         # MQTT 客户端（实时数据通道）
│   ├── sbind.js                # 数据绑定引擎：图元绑定配置 → MQTT 订阅 → 实时更新图元
│   ├── Dispatcher.js           # 点击插件池 + window.appBridge.runNodeClickPlugins
│   ├── DialogCore.js           # 钢坯信息解析 + 弹窗渲染 + 智能定位算法（ES module）
│   ├── DialogMain.js           # 钢坯弹窗插件入口（ES module，注册点击插件，点击点标定法坐标转换）
│   ├── DialogView.js           # 通用确认弹窗系统（状态机 + 单例）
│   ├── PopupManager.js         # 弹窗统一调度器（注册 → 转发 → 同类型单例 + 生命周期管理）
│   ├── WillInOutPopup.js       # 待入炉 / 待出炉弹窗（业务弹窗）
│   └── ConflictDialog.js       # 炉内钢坯位置冲突弹窗（业务弹窗）
├── storage/                    # 场景存储（核心业务数据）
│   ├── displays/               # 2D 场景 JSON + 缩略图
│   │   └── DaYeTeGang/         # 大冶特钢各产线场景（见 §5 场景清单）
│   ├── components/             # 组件库（json/png）
│   ├── previews/               # 默认展示页（display.html + display.json）
│   ├── storage/                # 场景库（json/png/html/svg/gz）
│   ├── symbols/                # 图元库（json/png/gz）
│   ├── assets/                 # 素材（svg/png）
│   ├── index.html              # 通用场景展示页（Preview Display，URL ?tag= 动态加载场景）
│   ├── display.html            # 简化展示页（固定加载 previews/display.json）
│   └── 导入后出现的html文件/    # 从设计器导入 JSON 时自动生成的独立场景页（内嵌完整业务脚本）
└── 111/                        # 废弃的临时场景副本（git 中已删除，勿再引用）
```

---

## 3. 模块功能详解

### 3.1 入口与页面层

| 文件 | 作用 |
|---|---|
| `storage/index.html` | **通用场景展示页**。`body onload → setTimeout(init, 300)`，通过 `?tag=displays/xxx.json` 加载任意场景；加载后执行 `BindDataToPage`（数据绑定）、设置标题/背景、注册双击历史数据。含完整请求工具链。 |
| `storage/display.html` | 简化展示页，固定加载 `previews/display.json`，不含弹窗组件与业务脚本。 |
| `storage/导入后出现的html文件/*.html` | **各产线实际运行页**。硬编码加载 `displays/DaYeTeGang/xxx.json`，内嵌本产线业务脚本（数据轮询、钢坯跟踪动画、炉内显示、点击弹窗调用 `window.appBridge.runNodeClickPlugins(...)` 等）。 |
| `Scripts/DispatchIndex.js` | 调度主页：导航按钮跳转各场景页，支持全屏切换、MQTT 实时时钟。 |
| `Scripts/BillBoardIndex.js` | 综合看板主页：与调度主页结构类似，导航至看板场景。 |

### 3.2 核心库（libs/）

- **`core/ht.js`**：HT for Web 核心引擎，提供 `ht.DataModel`、`ht.graph.GraphView`、节点/图元/序列化（deserialize/serialize）等基础能力。
- **`plugin/*`**：矢量（vector）、边线类型、3D 模型（obj/fbx）、UI、表单、纹理加载、右键菜单、绘图等扩展插件。
- **`sbind.js`**：**数据绑定引擎**。解析图元上的绑定配置（`_dataBindings`），建立"点位 → MQTT 主题"订阅关系，实时更新图元属性（如温度、状态、钢坯位置）。场景页中的 `BindDataToPage(dm)` 即由它提供。
- **`mqttws31.min.js`**：WebSocket MQTT 客户端，实时数据通道（钢坯跟踪数据源）。

### 3.3 弹窗组件链（libs/，对应本地「通用组件/弹窗组件/」）

```
业务场景点击节点
   └─> window.appBridge.runNodeClickPlugins(e, gv, node)      [Dispatcher.js 插件池]
        └─> DialogMain.js 注册的"钢坯弹窗"插件
             ├─ collectNodeGeometry()  点击点标定法：逻辑坐标 → 视口坐标（无 graphView.tp() 兜底）
             ├─ parseSteelInfo()       解析节点 info 字符串（"key:value,key:value" → 对象）
             ├─ showSteelPopup()       渲染钢坯信息弹窗（卡号/道次/钢坯号/钢种/厚度/长度）
             └─ calcPopupPosition()    智能定位：弹窗贴节点包围盒外侧、避开旋转盒体
```

| 文件 | 职责 |
|---|---|
| `Dispatcher.js` | 维护 `window.__nodeClickPlugins` 插件池；提供 `registerNodeClickPlugin(fn)` 注册、`runNodeClickPlugins(e, gv, node)` 依次执行；暴露 `window.appBridge`。**业务脚本统一经 appBridge 触发弹窗**。 |
| `DialogMain.js` | 钢坯弹窗插件（ES module）。`collectNodeGeometry` 实现"点击点标定法"坐标转换：由 `graphView.getLogicalPoint(event)` 反推 `vp = zoom*lp + offset`，兼容 `getAbsolutePosition`（父节点挂载）与 `getZoom`（无 tp() 环境）。 |
| `DialogCore.js` | 弹窗核心工具：`parseSteelInfo`（info 字符串解析）、`showSteelPopup`（钢坯信息弹窗 DOM 构建）、`calcPopupPosition`（弹窗定位算法：候选方向 + 节点旋转包围盒 AABB 不相交判定）。 |
| `DialogView.js` | 通用确认弹窗系统：状态机（hidden/visible）、单例管理、按钮回调，供业务弹窗复用。 |
| `PopupManager.js` | **弹窗统一调度器**：注册类型 → 转发原始数据 → 同类型单例 + 生命周期管理。业务弹窗按 `render(rawData, closeFn)` 约定返回 `{ update, close }`；`PopupManager.show('类型', rawData)` 为外部唯一入口。 |
| `WillInOutPopup.js` | 待入炉/待出炉弹窗：展示即将入炉/出炉的钢坯队列，支持去重（内存指纹）、缓存（localStorage，key 带产线编码）。 |
| `ConflictDialog.js` | 炉内位置冲突弹窗：钢坯位置冲突时提示并给出处理选择。 |

> **约定**：业务判断（去重、拦截）一律在业务弹窗组件内处理，**禁止在 PopupManager 内加业务钩子**；改通用弹窗逻辑只改 `libs/`（本地对应 `通用组件/弹窗组件/`），无需改产线场景页。

### 3.4 请求工具与接口防抖（storage/index.html 内）

- **`request(url, data, method, contentType, showMessage)`**：fetch 封装。
  - 自动附带 `Authorization: Bearer <Admin-Token>`（token 从 `localStorage.getItem('Admin-Token')` 读取）。
  - 支持 GET（参数拼 URL）/ POST / PUT，POST 区分 `json`、`form`、`form-data` 三种内容类型。
  - **500ms 防抖合并**（`__debounceCfg`）：同一 `method|url|contentType|参数` 在窗口期内只发最后一次，可 `__debounceCfg.enabled=false` 临时关闭。
  - **401 统一处理**（`handleUnauthorized`）：清除 token + Toast 提示 + 可自定义 `window.__onUnauthorized` 回调；并发 401 只处理一次。
- **`requestGet(url, params)`**：GET 便捷封装，同样走防抖。
- **`openHistoricalDialog`**（页面内联）：历史数据弹窗入口，bootstrap modal + iframe 加载 `HistoricalDataDialog/newDataDialog.html`。详见 §3.5。
- **`trySetDoubleClickHandlerForNode`**（页面内联）：为带单一 `_dataBindings` 的图元注册双击事件 → 打开历史数据弹窗。详见 §3.5。
- **`startFlowAnimation`**：流动管道动画（`ht.Default.startAnim` 循环）。
- **`changPage(url)`**：清空当前模型并 `deserialize` 切换场景。

### 3.5 双击历史弹窗（历史趋势曲线）

#### 3.5.1 调用链路

```
双击画面点位（仅含单一数据绑定的图元）
   └─ trySetDoubleClickHandlerForNode() 注册的 node.s('onDoubleClick')   [各场景页内联]
        └─ openHistoricalDialog(tag, name, tagid)                         [各场景页内联]
             ├─ 解析 tag：对象/JSON 字符串/纯字符串均可，统一取其点位 ID
             ├─ 拼 URL：window.location.origin + '/static/AriView/custom/
             │          HistoricalDataDialog/newDataDialog.html?tag=..&name=..&tagid=..'（双重 encodeURI）
             └─ openModalWithIframe(url, name)                            [Bootstrap iframe 模态框]
                  ├─ 已存在 #myModal → 复用：仅更新 iframe src + 标题后重新 show()
                  └─ 不存在 → 动态创建 modal-xl 模态框（iframe 全高）后 show()
                       └─ iframe 加载 newDataDialog.html
                            ├─ GetQueryString 解析 tag / name / tagid
                            ├─ echarts 初始化折线图（dark 主题）
                            ├─ 历史数据：父画面 requestGet（带 Bearer Token，401 统一处理）
                            │    GET https://bar.dayesteel.com.cn/api/api/iot/datahis/gethisdata
                            │    参数 { dt(斜杠格式), timeLenght, tagCode } → bindData 渲染曲线
                            └─ 实时数据：Paho MQTT 订阅（bar.dayesteel.com.cn:443，useSSL）
                                  → onMessageArrived 实时补点，关页自动退订
```

#### 3.5.2 关键环节说明

- **双击事件注册**：`trySetDoubleClickHandlerForNode` 遍历图元的 `_dataBindings`，仅当**恰好 1 个有效绑定**（含 `cfg.id`）时注册 `onDoubleClick`；多个绑定只告警不注册（防误触）。双击回调传 `openHistoricalDialog(bindingConfig, node._toolTip)`：`tag` 为绑定配置对象（取其 `.id`），`name` 即 tooltip（注册时被设为 `bindingConfig.id`），`tagid` 未传。
- **tag 参数容错**：`isValidJSON(tag)` 通过则先 `JSON.parse` 再取首键值；对象直接取首键值；纯字符串直接使用——保证绑定 ID 形态多变仍能解析出点位编码。
- **模态框全局复用**：`openModalWithIframe` 首次创建 `#myModal` 后**复用同一个模态框**，后续双击只换 iframe 的 `src` 与标题，不会叠加多个弹窗。
- **数据双通道**：
  - 历史：`getHistoricalData` 优先调用父画面已集成的 `requestGet`（自动带 `Authorization: Bearer <Admin-Token>`，401 由父画面 `handleUnauthorized` 统一处理，异步 Promise），请求 `https://bar.dayesteel.com.cn/api/api/iot/datahis/gethisdata`；`tagCode` 即点位 ID，`dt` 自动转为斜杠格式 `yyyy/MM/dd HH:mm`（与后端示例一致），响应 `datas.Data` 键值对 → 折线图。父画面无 `requestGet` 时退回原生 `$.get`（无 Token）。
  - 实时：`getRealtimeData` 连接 Paho MQTT（`bar.dayesteel.com.cn:443`，`useSSL: true`）订阅该点位，实时补点；关闭页面自动退订。
- **操作面板**：查询（`searchData` 先退订再按所选时段查历史）、刷新（结束时间=当前，按时段反推开始时间）、暂停/继续（MQTT 订阅开关）、上一周期/下一周期（`lastData`/`nextData`）、时间段选择（10/30/60/360/720/1440 分钟或自定义）。

#### 3.5.3 涉及文件

| 文件 | 职责 |
|---|---|
| `storage/index.html` | 主展示页，内联 `trySetDoubleClickHandlerForNode` / `openHistoricalDialog` / `openModalWithIframe` 实现 |
| `storage/导入后出现的html文件/*.html` | 各产线场景页，同样内联上述函数（双击入口） |
| `custom/HistoricalDataDialog/newDataDialog.html` | 弹窗主体：URL 参数解析、echarts 曲线、历史接口 + MQTT 实时数据 |
| `custom/HistoricalDataDialog/libs/` | 弹窗页依赖资源（bootstrap、flatpickr 等） |
| 依赖库 | jquery（`$.get`）、bootstrap（模态框）、echarts（图表）、mqttws31（Paho MQTT 实时流） |

> **清理记录（2026-08-29）**：旧独立脚本 `Scripts/Dialog.js`（含 alert 调试、指向旧弹窗页）与 `Scripts/dialog_.js`（window.Modal 类）已删除，弹窗逻辑全部内联进场景页；`custom/HistoricalDataDialog/` 下旧/测试弹窗页（DataDialog.html / DataDialog2.html / 1203newDataDialog.html / (1203)DataDialog.html / test.html）与无引用旧依赖（DataDialog.js / d3.v5.min.js / ElementUI.js / MQTTHelper.js）均已清理。
> **副本目录删除（2026-08-29）**：`custom/previews/HistoricalDataDialog/`、`CSS/custom/HistoricalDataDialog/`、`CSS/custom/previews/HistoricalDataDialog/` 三个旧弹窗副本目录（含 `DataDialog(原文件).html`、`newDataDialog_.html` 及 css/Images/libs 副本）均无活动引用，已整目录删除；删除前已将其 `libs/` 下的 `bootstrap/`、`bootstrap-icons/`、`flatpickr/` 补齐至主版本 `custom/HistoricalDataDialog/libs/`（主版本此前缺失这三类资源，弹窗页 `newDataDialog.html` 实际引用）。

### 3.6 配置（custom/configs/）

- **`htconfig.js`**：HT 全局配置，`convertURL` 为资源 URL 增加时间戳与 `sid` 参数（防缓存），设置 `toolTipDelay` 等。
- **`config-points.js` / `config-dataBindings.js` / `config-valueTypes.js` / `config-customProperties.js`**：主要为图扑**设计器（编辑器）**插件，提供测点选择、数据绑定编辑、值类型、自定义属性等编辑器能力，运行时一般不直接依赖。

---

## 4. 页面运行流程

```
用户访问
  ├─ 主页（DispatchIndex / BillBoardIndex）──导航──┐
  ├─ storage/index.html?tag=displays/xxx.json      │
  └─ storage/导入后出现的html文件/xxx.html ◄────────┘
       │
       ├─ 加载 HT 核心库 + 插件 + jQuery/MQTT/sbind + 弹窗组件
       ├─ onload → init()
       │     ├─ deserialize(场景JSON)           # 重建 DataModel/GraphView
       │     ├─ BindDataToPage(dm)              # sbind：绑定配置 → MQTT 订阅
       │     ├─ 设置标题 / 加载背景（2D displays 或 3D scenes）
       │     ├─ 注册图元双击 → 历史数据弹窗（见 §3.5）
       │     └─ 启动本页业务逻辑（轮询 request 数据 / 钢坯跟踪动画）
       │
       └─ 实时数据到达（MQTT / 轮询）
             └─ 更新图元属性（温度/钢坯位置/状态）
                 └─ 用户点击节点 → appBridge.runNodeClickPlugins → 弹窗
```

---

## 5. 场景清单（storage/displays/DaYeTeGang/）

| 产线 | 场景文件 | 说明 |
|---|---|---|
| 扁棒线 | 扁棒线加热炉.json | 加热炉钢坯跟踪 |
| 扁棒线 | 扁棒线轧机.json | 轧线两条轨道跟踪（坐标空间 0~3600） |
| 扁棒线 | 扁棒线冷床区.json | 冷床区域 |
| 扁棒线 | 扁棒线轧机副本.json | 轧机场景副本（备用） |
| 扁棒线 | 扁棒3号台跟踪.json | 3 号台跟踪 |
| 中棒线 | 中棒线加热炉.json / 中棒线加热炉 2.json / 中棒线加热炉切换.json | 加热炉（含切换场景） |
| 中棒线 | 中棒线轧机.json / 中棒线轧机 2.json / 中棒线轧机切换.json | 轧机（含切换场景） |
| 中棒线 | 中棒3号台跟踪.json / 中棒3号台跟踪切换.json | 3 号台跟踪 |
| 小棒线 | 小棒线加热炉.json / 小棒线一号加热炉.json / 小棒线二号加热炉.json | 加热炉（多炉） |
| 小棒线 | 小棒线轧机.json | 轧机 |
| 大棒线 | 大棒线一号加热炉.json / 大棒线二号加热炉.json | 一号/二号加热炉 |
| 大棒线 | 大棒线轧机.json | 轧机 |

> 与本地仓库 `大冶特钢/棒材厂/` 下的 `*.js` 业务脚本一一对应，场景 JSON 与业务脚本共同构成产线跟踪功能。

---

## 6. 常见注意事项

1. **无 `graphView.tp()`**：坐标转换一律用「点击点标定法」（`getLogicalPoint` + `getZoom` 反推），见 `DialogMain.js/collectNodeGeometry`；节点坐标用 `getAbsolutePosition()`（兼容父节点挂载）。
2. **弹窗定位**：`calcPopupPosition` 保证弹窗贴节点包围盒外侧，不做会压回节点的裁剪。
3. **接口防抖**：同 key 请求 500ms 合并只发最后一次；业务类 POST 如需单次立即发送，须绕过防抖（临时 `__debounceCfg.enabled=false`）。
4. **弹窗类型 key 带产线编码**（如 `<类型>_cache_<产线编码>_<炉号>`），多产线并存互不干扰。
5. **AriView 只读不改**；如需修改，先在本地主版本（`大冶特钢/`、`通用组件/`）改好并提交，再同步到 AriView 验证。
6. **`111/` 目录为废弃副本**（git 中已删除），不要引用其中的文件。

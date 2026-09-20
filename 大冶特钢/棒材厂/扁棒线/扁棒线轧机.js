/**
 * ============================================================
 *  扁棒线轧机 - 钢坯运动模拟与可视化
 * ============================================================
 *
 * 【功能概述】
 *   本脚本实现轧线钢坯的实时运动模拟，核心职责：
 *   1. 接收后端推送的钢坯热检（HMD）经过数据，推算钢坯头/尾位置
 *   2. 通过分区分速模型模拟钢坯在轧线上的连续运动
 *   3. 将运动状态渲染为三轨道的钢坯多段线（polyline）图形
 *   4. 管理钢坯生命周期：进入 → 运动 → 下线
 *
 * 【架构分层】
 *   ┌─────────────────────────────────────────────┐
 *   │  数据源层：dataModel 属性监听 (a:rolltable)    │
 *   ├─────────────────────────────────────────────┤
 *   │  事实仓库：SteelFactStore (后端原始数据快照)     │
 *   ├─────────────────────────────────────────────┤
 *   │  状态仓库：SteelStateStore (推演运动状态)       │
 *   │     ├── 状态判定 → 速度求解 → 位置求解          │
 *   │     └── 热检位置校正 (applyPositionCorrection)  │
 *   ├─────────────────────────────────────────────┤
 *   │  历史仓库：HmdPassStore (热检经过历史记录)       │
 *   ├─────────────────────────────────────────────┤
 *   │  渲染层：buildRenderData → renderMultipleSteels│
 *   │     ├── createSteelLineShapes (创建图形)       │
 *   │     ├── updateSteelLines     (更新显示)       │
 *   │     └── animateSteelLine     (平滑动画)       │
 *   └─────────────────────────────────────────────┘
 *
 * 【关键概念】
 *   - inMatNo      : 钢坯唯一标识号
 *   - headX/tailX : 钢坯头/尾在轧线上的X坐标（连续值）
 *   - state       : 钢坯当前所处阶段（ENTRY/ROUGH/MIDDLE/...）
 *   - headSpeed/tailSpeed : 头/尾当前移动速度
 *   - 轨道分段     : 3条轨道，每段1800，钢坯跨轨时拆分显示
 *
 * 【运行机制】
 *   - 定时器每100ms执行一次主循环（startSteelSimulator）
 *   - 每次循环：运动推演 → 数据同步 → 渲染更新
 *   - 后端数据到达时触发校正，修正推演累积误差
 *
 * 【产线信息】
 *   - 产线：扁棒线（产线编码 H9）
 *   - 缓存仓库 key 前缀：H9_（localStorage，详见「数据仓库层」）
 *   - 本文件独立编写（两轨结构，与中棒/大棒三轨结构不同）
 *
 * 【扁棒线适配说明（后续开发必读）】
 *   1. 轨道/分区/热检坐标、速度、集合点等常量按扁棒现场图纸核对
 *      （getYTrack / MILL_ZONES / SPEED_CONFIG / PHYSICAL_ORDER /
 *        applyProcessConstraints 内的热检位置等）。
 *   2. 仍留有源产线（中棒）专有字面量，待确认扁棒真实取值后替换：
 *        - 「右键菜单逻辑」段：const line = data.getAttr("Line") || "B101";
 *        - 「左键弹窗逻辑」段：const Line = "B101";（该段当前整体被注释）
 *   3. 初始化段中 trySetDoubleClickHandlerForNode 为外部全局函数，本文件未定义；
 *      中棒版本里该调用位于文件末尾的注释块内；如启用双击弹窗需确认是否提前到初始化段生效。
 *   4. 「右键菜单逻辑」「左键弹窗逻辑」两段代码当前整体注释未启用。
 *
 * 【外部依赖】
 *   - graphView : HT for Web 图形视图实例（全局注入）
 *   - dm        : graphView.dm() 数据模型
 *   - request / requestGet : 全局 HTTP 请求函数
 *
 * 【版本记录】
 *   v1.0  2026-09-15  头部注释补充【产线信息】【外部依赖】【版本记录】3 块
 *                     （参考大棒线轧机.js 头部结构对齐）
 *
 * @file       扁棒线轧机.js
 * @requires   graphView (HT GraphView 全局对象)
 * @requires   dataModel (HT DataModel 全局对象)
 * ============================================================
 */

// ===== 初始化：获取 GraphView 和数据模型 =====
var view = graphView.getView();
var dm = graphView.dm();
//滚动条不可见（轧线图形采用自动布局，不需要滚动条）
graphView.setScrollBarVisible(false);

// 启动时清理 dm 中残留的钢坯Shape（防止热重载/页面切回时旧Shape残留导致重复显示）
dm.getDatas().toArray().forEach(function (data) {
    var tag = data.getTag();
    if (tag && typeof tag === 'string' && tag.startsWith('steel-')) {
        dm.remove(data);
    }
});

/**
 * ===== 轨道Y坐标基准点 =====
 * 扁棒线只有2条轨道，Y 坐标从图纸预置的 roll-y1/roll-y2 节点动态获取。
 *   roll-y1: track0, Y = 250
 *   roll-y2: track1, Y = 606
 */
var rolly1 = dm.getDataByTag('roll-y1');
var rolly2 = dm.getDataByTag('roll-y2');

function getYTrack(index) {
    var node;
    switch (index) {
        case 0: node = rolly1; break;
        case 1: node = rolly2; break;
        default: return 0;
    }
    return (node && node.getPosition()) ? node.getPosition().y : 0;
}

/**
 * ===== 位置映射表（按辊道物理摆放顺序） =====
 *
 * 设计思路：
 *   1. PHYSICAL_ORDER 定义辊道上所有设备节点的真实物理顺序
 *   2. 从图纸 dm 中读取各节点的 X 坐标
 *   3. 按物理顺序构建两个 Map：
 *      - All_POSITION_MAP:   热检 + 轧机状态（key=完整tag）
 *      - TRACK_POSITION_MAP: 仅热检（key=名称部分，不含track前缀）
 *   4. 使用 Map 而非普通对象，严格保证遍历顺序与物理顺序一致
 *
 * track-* 节点的X坐标计算：
 *   finalX = baseX + (trackNum - 1) * 1800
 *   其中 trackNum 是轨道编号（1/2/3），1800 是单轨段长度
 */

// ===== 辊道物理摆放顺序（完整序列） =====
var PHYSICAL_ORDER = [
    // ---- 轨道1（逻辑 X: 1797 → 74）----
    'track-1-DescalerBeforeHmd',
    'track-1-Stand1EntryHmd',
    'millstate1',
    'millstate2',
    'millstate3',
    'millstate4',
    'millstate5',
    'millstate6',
    'millstate7',
    'millstate8',
    'track-1-Stand8ExitHmd',
    'track-1-RollTable1EntryHmd',
    'track-1-RollTable2EntryHmd',
    'track-1-No1ShearBeforeHmd',
    'millstate9',
    'millstate10',
    'millstate11',
    'millstate12',
    'millstate13',
    'millstate14',
    'millstate15',
    'millstate16',
    'track-1-Stand16ExitHmd',
    'track-1-No2ShearBeforeHmd',
    // ---- 轨道2（逻辑 X: 3580 → 2249）----
    'millstate17',
    'millstate18',
    'millstate19',
    'millstate20',
    'millstate21',
    'millstate22',
    'millstate23',
    'track-2-Mill3CutHotHmd',
    'track-2-No3ShearBeforeHmd',
    'track-2-BslHmd'
];

// 先收集所有相关节点坐标（不限顺序）
var rawPositions = {};
dm.each(item => {
    const tag = item.getTag();
    if (!tag) return;

    // track-* 热检节点：X = 图纸基准 + 轨道偏移
    if (tag.startsWith('track-')) {
        const match = tag.match(/track-(\d+)-(.+)/);
        if (!match) return;
        const trackNum = parseInt(match[1], 10);  // 轨道编号 1/2/3
        const baseX = item.getX();                  // 图纸上节点的X
        const offset = (trackNum - 1) * 1800;       // 轨道偏移量
        rawPositions[tag] = Math.floor(baseX + offset);
    }

    // millstate 节点：轧机状态指示，X 直接取图纸坐标（无轨道偏移）
    if (tag.startsWith('millstate')) {
        rawPositions[tag] = Math.floor(item.getX());
    }
});

// 获取热检横坐标映射表（按物理顺序排序，仅热检→整数坐标）
var TRACK_POSITION_MAP = new Map();
// 新增全位置映射表（按物理顺序排序，热检+轧机状态）
var All_POSITION_MAP = new Map();

// 按物理顺序逐个插入，Map 严格保持插入顺序
// 通过 PHYSICAL_ORDER 中 track-* 节点的出现顺序，推断当前所处的轨道号
var currentTrackNum = 1;
PHYSICAL_ORDER.forEach(tag => {
    // 遇到 track-* 节点时更新当前轨道号
    var trackMatch = tag.match(/track-(\d+)-/);
    if (trackMatch) {
        currentTrackNum = parseInt(trackMatch[1], 10);
    }

    var x = rawPositions[tag];
    if (x === undefined) return;  // 图纸上不存在的节点跳过

    // millstate 节点在轨道2+需要加上轨道偏移
    // 图纸上 millstate 的 X 坐标是相对各轨道的基准值，需转换为全局逻辑坐标
    if (tag.startsWith('millstate') && currentTrackNum > 1) {
        x = x + (currentTrackNum - 1) * 1800;
    }

    All_POSITION_MAP.set(tag, x);

    // track-* 热检提取名称部分放入 TRACK_POSITION_MAP
    // 例如 "track-1-DescalerBeforeHmd" → key="DescalerBeforeHmd"
    var match = tag.match(/track-\d+-(.+)/);
    if (match) {
        TRACK_POSITION_MAP.set(match[1], x);
    }
});

console.log('TRACK_POSITION_MAP:', TRACK_POSITION_MAP);
console.log('All_POSITION_MAP:', All_POSITION_MAP);

// 打印所有计入检查点的集合点（用于验证 isActiveCollectionPoint 逻辑）
(function printActiveCheckpoints() {
    var activeList = [];
    All_POSITION_MAP.forEach(function (x, tag) {
        if (isActiveCollectionPoint(tag)) {
            var node = getCollectionNode(tag);
            var extra = '';
            if (tag.indexOf('millstate') === 0 && node) {
                extra = ' running=' + node.a('runningState') + ' rolling=' + node.a('rolledState');
            }
            activeList.push(tag + '(x=' + x + extra + ')');
        }
    });
    console.log('[活跃检查点] 共 ' + activeList.length + ' 个:', activeList);
})();

/**
 * ===== 后端位置别名解析 =====
 *
 * 后端推送的 headPosition / tailPosition 除传统热检名称（如 DescalerBeforeHmd）外，
 * 还包含轧机咬钢信号名称（如 Stand1MaterialEngaged）。
 * 这些信号对应图纸上的 millstate 节点，坐标存在 All_POSITION_MAP 中而非 TRACK_POSITION_MAP。
 *
 * 本解析层统一处理两类位置名称的 X 坐标查询，
 * 上层代码统一调用 resolvePositionX() 即可，无需关心名称类别。
 */

/** 后端位置别名 → 图纸节点 tag（millstate*） */
var BACKEND_POSITION_ALIASES = {
    'Stand1MaterialEngaged':  'millstate1',
    'Stand2MaterialEngaged':  'millstate2',
    'Stand3MaterialEngaged':  'millstate3',
    'Stand4MaterialEngaged':  'millstate4',
    'Stand5MaterialEngaged':  'millstate5',
    'Stand6MaterialEngaged':  'millstate6',
    'Stand7MaterialEngaged':  'millstate7',
    'Stand8MaterialEngaged':  'millstate8',
    'Stand9MaterialEngaged':  'millstate9',
    'Stand10MaterialEngaged': 'millstate10',
    'Stand11MaterialEngaged': 'millstate11',
    'Stand12MaterialEngaged': 'millstate12',
    'Stand13MaterialEngaged': 'millstate13',
    'Stand14MaterialEngaged': 'millstate14',
    'Stand15MaterialEngaged': 'millstate15',
    'Stand16MaterialEngaged': 'millstate16',
    'Stand17MaterialEngaged': 'millstate17',
    'Stand18MaterialEngaged': 'millstate18',
    'Stand19MaterialEngaged': 'millstate19',
    'Stand20MaterialEngaged': 'millstate20',
    'Stand21MaterialEngaged': 'millstate21',
    'Stand22MaterialEngaged': 'millstate22',
    'Stand23MaterialEngaged': 'millstate23'
};

/**
 * 解析后端位置名称 → X 坐标（统一入口）
 *
 * 查询顺序：
 *   1. TRACK_POSITION_MAP  → 传统热检名称（如 DescalerBeforeHmd）
 *   2. BACKEND_POSITION_ALIASES → All_POSITION_MAP → 轧机咬钢信号（如 Stand1MaterialEngaged）
 *
 * @param {string} positionName - 后端推送的位置名称
 * @returns {number|undefined} 对应的 X 坐标，找不到则返回 undefined
 */
function resolvePositionX(positionName) {
    if (!positionName) return undefined;

    // 1. 传统热检名称
    var x = TRACK_POSITION_MAP.get(positionName);
    if (x !== undefined) return x;

    // 2. 别名解析：Stand{N}MaterialEngaged → millstate{N}
    var alias = BACKEND_POSITION_ALIASES[positionName];
    if (alias) {
        return All_POSITION_MAP.get(alias);
    }

    return undefined;
}

/**
 * ===== 轨道配置与渲染状态 =====
 * - segmentLength : 单条轨道的X坐标跨度（1800单位）
 * - allSteelLines : inMatNo → [track0_shape, track1_shape]  每条钢坯对应2个轨道Shape
 * - lastPositions : inMatNo → {leftX, rightX, len}  上次渲染位置，用于判是否需要动画
 * - animationFrames : inMatNo → animationFrameID  当前运行中的动画句柄
 * - steelLineShapesCollection : 所有钢坯Shape的扁平数组，供右键菜单等批量操作使用
 */
var segmentLength = 1800;
var allSteelLines = {};
var lastPositions = {};
var animationFrames = {};
var steelLineShapesCollection = [];

// 已下线的钢坯黑名单（防止僵尸钢坯被 syncFactToState / updateFactStore 重新加入）
// 值存储 Date.now() 时间戳，用于 LRU 淘汰（最多保留10条）
// 声明提前在此处，因为启动重建时 cleanupFinishedSteels → isSteelFinished 会写入
var finishedInMatNos = {};

// ---- 以下为核心 tracker 声明，cleanupSteelTrackers 在启动重建/removeSteelFromState 中引用 ----
var steelCollectionTracker = {};
var headBlockedState = {};

// COLLECTION_POINT_LENGTHS 已删除，改用 applyProcessConstraints 工艺约束规则

// 离线检查点列表（声明提前，isSteelFinished → cleanupFinishedSteels 在启动重建时引用）
// 尾位置经过这些热检后视同离线
var OFFLINE_HMD_LIST = [
    'BslHmd'
];

/**
 * ===== 渲染层：钢坯 Shape 创建与显示 =====
 *
 * 每条钢坯由 2 个 polyline Shape 组成（对应2条轨道），
 * 当钢坯跨越轨道边界时，每个轨道的 Shape 只显示属于该轨道的片段。
 * 钢坯纹理通过 shape.repeat.image 平铺实现。
 */

// ===== 工具函数：创建钢条 shape =====
// 为一条钢坯创建2个轨道 Shape，初始为空（暂无坐标点）
function createSteelLineShapes(steel) {
    const lineShapes = [];

    for (let i = 0; i < 2; i++) {
        let line = new ht.Shape();
        // Tag 命名规则：steel-{钢坯号}-track-{轨道序号}
        line.setTag(
            `steel-${steel.inMatNo}-track-${i}`
        );
        line.setStyle(
            'label',
            steel.label
        );

        line.setStyle(
            'shape.border.color',
            steel.borderColor
        );
        line.setStyle('label.position', "3");   // 标签位置：上方
        line.setStyle('label.font', "16px arial, sans-serif");
        line.setStyle('label.color', "rgb(255,255,255)");
        line.setStyle('shape.border.width', 6);  // 钢坯线宽
        line.setStyle('shape.type', 'polyline'); // 多段线类型
        // 阴影效果（暂时关闭）
        // line.setStyle('shadow2', true);
        // line.setStyle('shadow2.color', "rgb(255,72,0)");
        // line.setStyle('shadow2.blur', 10);
        // line.setStyle('shadow2.offset.x', 0);
        // line.setStyle('shadow2.offset.y', 0);
        line.setStyle('2d.movable', false);       // 禁止拖拽
        line.setStyle('shape.repeat.image', 'symbols/青岛特钢/扁钢钢坯.json'); // 设置图像并平铺
        line.setLayer('0');
        line.setPoints([]);                       // 初始无坐标点
        dm.add(line);
        lineShapes.push(line);
    }

    return lineShapes;
}

/**
 * ===== 坐标处理函数（计算层 → 渲染层） =====
 *
 * 计算层的 headX/tailX 遵循运动方向语义（从右至左：headX > tailX），
 * 渲染层需要统一的 [leftX, rightX] 区间（leftX < rightX）。
 * 本函数是计算层与渲染层之间的独立坐标转换边界。
 *
 * @param {number} headX - 计算层钢头X坐标
 * @param {number} tailX - 计算层钢尾X坐标
 * @returns {{ leftX: number, rightX: number }} 归一化渲染坐标
 */
function processRenderCoords(headX, tailX) {
    return {
        leftX:  Math.min(headX, tailX),
        rightX: Math.max(headX, tailX)
    };
}

/**
 * ===== 逻辑坐标 → 画布坐标映射 =====
 *
 * 统一公式 canvasX = logicX - trackStart，两条轨道视觉方向一致（右→左）：
 *   轨道1 (trackIndex=0): 画布 [0, 1800] 对应逻辑 [0, 1800]
 *   轨道2 (trackIndex=1): 画布 [0, 1800] 对应逻辑 [1800, 3600]
 *
 * @param {number} visibleStart - 钢坯在当前轨道的可见区间起点（逻辑X）
 * @param {number} visibleEnd   - 钢坯在当前轨道的可见区间终点（逻辑X）
 * @param {number} trackIndex   - 轨道序号 (0 或 1)
 * @returns {{ x1: number, x2: number }} 画布X坐标（x1 < x2）
 */
function logicToCanvasX(visibleStart, visibleEnd, trackIndex) {
    // 统一公式: canvasX = logicX - trackStart
    // track 0: canvasX = logicX - 0      → 画布 [0, 1800] 对应逻辑 [0, 1800]
    // track 1: canvasX = logicX - 1800   → 画布 [0, 1800] 对应逻辑 [1800, 3600]
    // 两条轨道视觉方向一致（右→左），钢坯运动方向与逻辑坐标一致
    var trackStart = trackIndex * segmentLength;
    return {
        x1: visibleStart - trackStart,
        x2: visibleEnd - trackStart
    };
}

/**
 * 更新钢坯在2条轨道上的显示
 *
 * 核心算法（跨轨裁剪）：
 *   钢坯在全局坐标系中是一个连续的区间 [leftX, rightX]，
 *   每条轨道的可见范围是 [trackStart, trackEnd]，
 *   取两者交集 [visibleStart, visibleEnd]，
 *   然后通过 logicToCanvasX 转换为画布坐标再设置 polyline 的点位。
 *
 * @param {string} rollnum - 钢坯号 (inMatNo)
 * @param {number} leftX   - 钢坯左端全局X坐标
 * @param {number} rightX  - 钢坯右端全局X坐标
 */
function updateSteelLines(rollnum, leftX, rightX) {
    const lineShapes = allSteelLines[rollnum];
    if (!lineShapes) return;

    for (let i = 0; i < 2; i++) {
        const trackStart = i * segmentLength;        // 当前轨道起始X
        const trackEnd = trackStart + segmentLength; // 当前轨道结束X
        const y = getYTrack(i);

        // 取钢坯区间与轨道区间的交集
        const visibleStart = Math.max(leftX, trackStart);
        const visibleEnd = Math.min(rightX, trackEnd);

        if (visibleStart < visibleEnd) {
            var canvas = logicToCanvasX(visibleStart, visibleEnd, i);
            lineShapes[i].setPoints([
                { x: canvas.x1, y: y },
                { x: canvas.x2, y: y }
            ]);
        } else {
            // 不在当前轨道范围内，清空该轨道Shape
            lineShapes[i].setPoints([]);
        }
    }
}

/**
 * 钢坯位移动画：从旧位置平滑过渡到新位置
 *
 * 使用 requestAnimationFrame 实现 1 秒的线性插值动画，
 * 避免钢坯在屏幕上瞬间跳跃，提供流畅的视觉体验。
 * 如果同一钢坯已有正在运行的动画，会先取消旧动画防止冲突。
 *
 * @param {number} fromHeadX - 动画起始头位置
 * @param {number} fromTailX - 动画起始尾位置
 * @param {number} fromLen   - 动画起始长度（保留参数，预留扩展）
 * @param {number} toHeadX   - 动画目标头位置
 * @param {number} toTailX   - 动画目标尾位置
 * @param {number} toLen     - 动画目标长度（保留参数，预留扩展）
 */
function animateSteelLine(rollnum, fromLeftX, fromRightX, fromLen, toLeftX, toRightX, toLen) {
    const duration = 1000;  // 动画时长 1 秒
    const startTime = performance.now();

    // 取消同钢坯的旧动画，防止两个动画叠加造成抖动
    if (animationFrames[rollnum]) {
        cancelAnimationFrame(animationFrames[rollnum]);
    }

    function animateFrame(currentTime) {
        const elapsed = currentTime - startTime;
        const t = Math.min(elapsed / duration, 1);  // 归一化时间 [0, 1]

        // 线性插值计算当前位置
        const currentLeftX = fromLeftX + (toLeftX - fromLeftX) * t;
        const currentRightX = fromRightX + (toRightX - fromRightX) * t;

        updateSteelLines(rollnum, currentLeftX, currentRightX);

        if (t < 1) {
            animationFrames[rollnum] = requestAnimationFrame(animateFrame);
        } else {
            delete animationFrames[rollnum];  // 动画完成，清理句柄
        }
    }

    animationFrames[rollnum] = requestAnimationFrame(animateFrame);
}

/**
 * 绘制/更新单根钢坯
 *
 * 逻辑分支：
 *   1. 首次出现 → 创建 Shape + 直接设置位置（不带动画）
 *   2. 已存在但尾位置回退（钢坯被裁切/校正） → 直接跳变位置，不播放动画
 *   3. 已存在且正常前进 → 播放1秒平滑位移动画
 *
 * @param {object} steel - 渲染模型 { inMatNo, headX, tailX, length, label, borderColor, ... }
 */
function drawSteel(
    steel
) {

    const rollnum =
        steel.inMatNo;

    // 分支1：新钢坯，创建 Shape 并直接渲染初始位置
    if (
        !allSteelLines[
            rollnum
        ]
    ) {

        allSteelLines[
            rollnum
        ] =
            createSteelLineShapes(
                steel
            );

        updateSteelLines(
            rollnum,
            steel.leftX,
            steel.rightX
        );

        lastPositions[
            rollnum
        ] = {

            leftX:
                steel.leftX,

            rightX:
                steel.rightX,

            len:
                steel.length
        };

        return;
    }

    // 更新钢坯样式（标签、颜色可能变化）
    updateSteelStyle(
        steel
    );

    const last =
        lastPositions[
            rollnum
        ];

    // 分支2：尾位置回退（钢坯被裁切），直接跳变
    if (
        steel.leftX <
        last.leftX
    ) {

        updateSteelLines(
            rollnum,
            steel.leftX,
            steel.rightX
        );

    } else {

        // 分支3：正常前进，平滑动画
        animateSteelLine(
            rollnum,

            last.leftX,
            last.rightX,
            last.len,

            steel.leftX,
            steel.rightX,
            steel.length
        );
    }

    // 记录本次位置，供下次比较
    lastPositions[
        rollnum
    ] = {

        leftX:
            steel.leftX,

        rightX:
            steel.rightX,

        len:
            steel.length
    };
}

//更新钢坯样式（标签文字和边框颜色）
function updateSteelStyle(
    steel
) {

    const shapes =
        allSteelLines[
            steel.inMatNo
        ];

    if (!shapes) {

        return;
    }

    shapes.forEach(
        shape => {

            shape.setStyle(
                'label',
                steel.label
            );

            shape.setStyle(
                'shape.border.color',
                steel.borderColor
            );
        }
    );
}

// ✅ 更新全局 shape 集合（将 allSteelLines 的嵌套数组展平为一维数组）
function updateSteelLineShapesCollection() {
    steelLineShapesCollection = [];

    Object.values(allSteelLines).forEach(shapeList => {
        steelLineShapesCollection.push(...shapeList);
    });
}

/**
 * ===== 主函数：渲染多个钢条数据 =====
 *
 * 每帧调用，对比当前活跃钢坯与已创建的 Shape，
 * 执行三大操作：新增渲染、更新显示、清理离线。
 */
function renderMultipleSteels(
    steelList
) {

    const newRollnums =
        new Set();

    // ===== 渲染当前活跃钢坯 =====
    steelList.forEach(
        steel => {

            newRollnums.add(
                steel.inMatNo
            );

            drawSteel(
                steel
            );
        }
    );

    // ===== 清理离线钢坯 =====
    // 遍历已创建 Shape 但不在当前活跃列表中的钢坯，执行三步清理
    Object.keys(
        allSteelLines
    ).forEach(rollnum => {

        if (
            newRollnums.has(
                rollnum
            )
        ) {
            return;  // 仍在活跃列表中，跳过
        }

        // 1. 取消正在运行的动画
        if (
            animationFrames[
                rollnum
            ]
        ) {

            cancelAnimationFrame(
                animationFrames[
                    rollnum
                ]
            );

            delete animationFrames[
                rollnum
            ];
        }


        // 2. 从数据模型中删除 Shape（释放图形资源），异常不中断后续清理
        allSteelLines[
            rollnum
        ].forEach(
            shape => {
                try {
                    dm.remove(shape);
                } catch (e) {
                    console.warn('[清理] 删除Shape失败', rollnum, e);
                }
            }
        );

        // 3. 清除缓存（无论dm.remove是否成功，保证缓存一定清理）
        delete allSteelLines[
            rollnum
        ];

        delete lastPositions[
            rollnum
        ];
    });

    // ===== 更新Shape集合（供右键菜单等批量操作使用） =====
    updateSteelLineShapesCollection();
}



/**
 * ===== 数据仓库层 =====
 *
 * 三层仓库架构：事实 → 状态 → 历史
 *
 *   SteelFactStore  (事实仓库)：存储后端推送的原始数据快照
 *        ↓ 同步
 *   SteelStateStore (状态仓库)：存储经推演后的钢坯运动状态
 *        ↓ 记录
 *   HmdPassStore    (历史仓库)：记录每根钢坯经过各热检的完整历史
 *
 * 所有仓库均持久化到 localStorage，页面刷新后恢复。
 */

// SteelFactStore（事实仓库）
// 存储后端推送的原始数据，是状态推演的唯一可信数据源
const SteelFactStore = {
    initialized: false,  // 是否已完成首次基线建立
    data: {},            // inMatNo → { inMatNo, cardNo, furnaceCode, headPosition, headTime, ... }

    load() {
        const cache = localStorage.getItem('H9_SteelFactStore');

        if (!cache) return;

        try {
            const obj = JSON.parse(cache);

            this.initialized = obj.initialized || false;
            this.data = obj.data || {};

            console.log('[SteelFactStore] 恢复成功');
        } catch (err) {
            console.error('[SteelFactStore] 恢复失败', err);
        }
    },

    save() {
        localStorage.setItem(
            'H9_SteelFactStore',
            JSON.stringify({
                initialized: this.initialized,
                data: this.data
            })
        );
    }
};

// SteelStateStore（运动状态仓库）
// 存储每根钢坯推演后的实时运动状态，是渲染的直接数据源
const SteelStateStore = {
    data: {},  // inMatNo → { inMatNo, headX, tailX, headSpeed, tailSpeed, state, ... }

    load() {
        const cache = localStorage.getItem('H9_SteelStateStore');

        if (!cache) return;

        try {
            this.data = JSON.parse(cache);

            console.log('[SteelStateStore] 恢复成功');
        } catch (err) {
            console.error('[SteelStateStore] 恢复失败', err);
        }
    },

    save() {
        localStorage.setItem(
            'H9_SteelStateStore',
            JSON.stringify(this.data)
        );
    }
};

// RenderCacheStore（渲染位置缓存）
// 存储每帧求解器计算完毕后送给渲染层的最终 headX/tailX
// 用途：页面刷新时立即恢复画面，钢坯从上次渲染位置继续显示
// 与 SteelStateStore 的区别：只存位置，不存速度/状态等中间计算数据
const RenderCacheStore = {
    data: {},  // inMatNo → { headX, tailX, updateTime }

    load() {
        const cache = localStorage.getItem('H9_RenderCacheStore');
        if (!cache) return;
        try {
            this.data = JSON.parse(cache);
            console.log('[RenderCacheStore] 恢复成功，钢坯数:', Object.keys(this.data).length);
        } catch (err) {
            console.error('[RenderCacheStore] 恢复失败', err);
        }
    },

    save() {
        localStorage.setItem('H9_RenderCacheStore', JSON.stringify(this.data));
    },

    /**
     * 每帧求解器完成后调用，快照当前所有钢坯的最终渲染位置
     */
    snapshot() {
        var now = Date.now();
        Object.values(SteelStateStore.data).forEach(function (steel) {
            RenderCacheStore.data[steel.inMatNo] = {
                headX: steel.headX,
                tailX: steel.tailX,
                updateTime: now
            };
        });
        // 清理已下线的钢坯
        Object.keys(RenderCacheStore.data).forEach(function (inMatNo) {
            if (!SteelStateStore.data[inMatNo]) {
                delete RenderCacheStore.data[inMatNo];
            }
        });
        RenderCacheStore.save();
    }
};

// ===== HmdPassStore（热检历史仓库）=====
// 记录每根钢坯每次头/尾经过各热检的完整历史
// 核心用途：
//   1. 位置校验：检测数据错传（如位置回退、跳过必经检查点）
//   2. 辅助下线判断：尾位置经过离线检查点后不再渲染和位移计算
//   3. 数据审计：提供完整的钢坯运动轨迹追溯
const HmdPassStore = {
    // inMatNo → { cardNo, furnaceCode, passes: [{type:'head'|'tail', position, time, x}] }
    data: {},

    load() {
        const cache = localStorage.getItem('H9_HmdPassStore');
        if (!cache) return;
        try {
            this.data = JSON.parse(cache);
            console.log('[HmdPassStore] 恢复成功, 记录数:', Object.keys(this.data).length);
        } catch (err) {
            console.error('[HmdPassStore] 恢复失败', err);
        }
    },

    save() {
        this.trim();
        localStorage.setItem('H9_HmdPassStore', JSON.stringify(this.data));
    },

    /**
     * 容量控制：最多保留50条钢坯记录，超出时按 passes 最后一条时间淘汰最早的
     */
    trim() {
        var keys = Object.keys(this.data);
        if (keys.length <= 50) return;

        // 按最后经过时间排序（没有 passes 的排最前面优先淘汰）
        keys.sort(function (a, b) {
            var passesA = (this.data[a] && this.data[a].passes) || [];
            var passesB = (this.data[b] && this.data[b].passes) || [];
            var timeA = passesA.length > 0 ? passesA[passesA.length - 1].time : '';
            var timeB = passesB.length > 0 ? passesB[passesB.length - 1].time : '';
            if (!timeA && !timeB) return 0;
            if (!timeA) return -1;
            if (!timeB) return 1;
            return timeA.localeCompare(timeB);
        }.bind(this));

        var deleteCount = keys.length - 50;
        for (var i = 0; i < deleteCount; i++) {
            delete this.data[keys[i]];
        }
    },

    /**
     * 记录一次热检经过事件
     *
     * 调用时机：钢坯头/尾通过某个热检时触发
     * 去重策略：同一钢坯同一类型(head/tail)同一热检只记录一次
     * 异常检测：发现同类型位置回退时输出警告（可能是后端数据错传）
     *
     * @param {string} inMatNo   - 钢坯号
     * @param {string} cardNo   - 卡号
     * @param {string} furnaceCode - 炉号
     * @param {string} type     - 'head' | 'tail'
     * @param {string} position - 热检名称（如 'DescalerBeforeHmd'）
     * @param {string} time     - 经过时间 "YYYY-MM-DD HH:mm:ss.SSS"
     */
    recordPass(inMatNo, cardNo, furnaceCode, type, position, time) {
        if (!position || !time) return;

        if (!this.data[inMatNo]) {
            this.data[inMatNo] = {
                cardNo: cardNo || '',
                furnaceCode: furnaceCode || '',
                passes: []
            };
        }

        const passes = this.data[inMatNo].passes;

        // 去重：同一类型、同一热检已记录过，时间是不可变的历史事实，直接跳过
        const lastPass = passes[passes.length - 1];
        if (lastPass && lastPass.type === type && lastPass.position === position) {
            return;
        }

        passes.push({
            type: type,
            position: position,
            time: time,
            x: resolvePositionX(position) || 0  // 将热检名称转为X坐标记录
        });

        // 数据校验：检测同类型位置回退（如头的第二个HMD比第一个更靠左）
        if (passes.length >= 2) {
            const prev = passes[passes.length - 2];
            if (prev.type === type && prev.x > passes[passes.length - 1].x) {
                console.warn(
                    '[HmdPassStore 异常] 位置回退!',
                    '钢坯:', inMatNo,
                    '类型:', type,
                    '从', prev.position, '(x=' + prev.x + ')',
                    '到', position, '(x=' + passes[passes.length - 1].x + ')'
                );
            }
        }

        this.save();
    },

    /**
     * 判断钢坯尾部是否已经过指定热检
     */
    hasTailPassed(inMatNo, hmdName) {
        const record = this.data[inMatNo];
        if (!record) return false;
        return record.passes.some(p => p.type === 'tail' && p.position === hmdName);
    }
};

/**
 * ===== 服务器时间基准 =====
 *
 * clockOffset: 客户端时钟与服务器时钟的偏差（毫秒），每次收到后端推送时用 msgTime 校准
 * getServerNow(): 返回校准后的服务器当前时间，所有位置计算统一使用
 */
var clockOffset = 0;
var _startupRebuildDone = false;  // 启动后是否已用校准后的clockOffset重建过
function getServerNow() {
    return Date.now() - clockOffset;
}

/**
 * ===== 分区定义（必须在启动代码之前，因为 addSteelToState → forwardSimulatePosition 会引用）=====
 * name  : 分区名称（对应钢坯 state 字段）
 * start : 分区起始X坐标（包含）
 * end   : 分区结束X坐标（不包含）
 */
var MILL_ZONES = [
    { name: 'ROLL1',    start: 0,    end: 120  },
    { name: 'ROUGH',    start: 120,  end: 490  },
    { name: 'ROLL2',    start: 490,  end: 1100 },
    { name: 'MIDDLE',   start: 1100, end: 1500 },
    { name: 'ROLL3',    start: 1500, end: 1800 },
    { name: 'PREFINISH',start: 1800, end: 2000 },
    { name: 'ROLL4',    start: 2000, end: 2160 },
    { name: 'FINISH',   start: 2160, end: 2310 },
    { name: 'ROLL5',    start: 2310, end: 3600 }
];

// 分区速度初始化配置（实际运行时会被后端推送的速度数据覆盖）
var SPEED_CONFIG = {
    ROLL1:     { headSpeed: 5, tailSpeed: 5 },
    ROUGH:     { headSpeed: 5, tailSpeed: 5 },
    ROLL2:     { headSpeed: 5, tailSpeed: 5 },
    MIDDLE:    { headSpeed: 5, tailSpeed: 5 },
    ROLL3:     { headSpeed: 5, tailSpeed: 5 },
    PREFINISH: { headSpeed: 5, tailSpeed: 5 },
    ROLL4:     { headSpeed: 5, tailSpeed: 5 },
    FINISH:    { headSpeed: 5, tailSpeed: 5 },
    ROLL5:     { headSpeed: 5, tailSpeed: 5 }
};

/**
 * ===== 启动初始化 =====
 * 1. 从 localStorage 恢复仓库（FactStore + StateStore + RenderCacheStore + HmdPassStore）
 * 2. 如果有新鲜的渲染位置缓存（updateTime 与当前时间差 < 5秒），用缓存位置恢复 StateStore
 * 3. 启动主模拟循环
 *
 * 启动策略：
 *   - RenderCacheStore 新鲜（<5秒）→ 用缓存的最终渲染位置恢复 StateStore，画面立即显示
 *   - RenderCacheStore 过期（≥5秒）或无缓存 → 清空 StateStore，等待后端数据全量重算
 *   - 全量重算仅在第一次后端推送时执行（clockOffset 已校准）
 */
SteelFactStore.load();
SteelStateStore.load();
RenderCacheStore.load();
HmdPassStore.load();

// 检查 RenderCacheStore 缓存新鲜度：取所有钢坯中最新的 updateTime 与当前时间比较
var _cacheMaxUpdateTime = 0;
Object.values(RenderCacheStore.data).forEach(function (entry) {
    if (entry.updateTime > _cacheMaxUpdateTime) {
        _cacheMaxUpdateTime = entry.updateTime;
    }
});

var _cacheFresh = _cacheMaxUpdateTime > 0 && (Date.now() - _cacheMaxUpdateTime) < 5000;

if (Object.keys(RenderCacheStore.data).length > 0 && _cacheFresh) {
    // 缓存新鲜：用 RenderCacheStore 的最终渲染位置恢复 StateStore
    var now = Date.now();
    Object.keys(RenderCacheStore.data).forEach(function (inMatNo) {
        var cached = RenderCacheStore.data[inMatNo];
        // 如果 StateStore 已有该钢坯，只更新位置；否则创建最小条目
        if (SteelStateStore.data[inMatNo]) {
            SteelStateStore.data[inMatNo].headX = cached.headX;
            SteelStateStore.data[inMatNo].tailX = cached.tailX;
            SteelStateStore.data[inMatNo].updateTime = now;
            SteelStateStore.data[inMatNo].headSpeed = 0;
            SteelStateStore.data[inMatNo].tailSpeed = 0;
        } else if (SteelFactStore.data[inMatNo]) {
            // StateStore 没有但 FactStore 有：从缓存位置创建条目
            var fact = SteelFactStore.data[inMatNo];
            SteelStateStore.data[inMatNo] = {
                inMatNo: inMatNo,
                cardNo: fact.cardNo || '',
                furnaceCode: fact.furnaceCode || '',
                color: 'red',
                state: 'ENTRY',
                headX: cached.headX,
                tailX: cached.tailX,
                headSpeed: 0,
                tailSpeed: 0,
                createTime: now,
                updateTime: now,
                _lastHeadHmdTime: '',   // 留空，让 applyPositionCorrection 首次触发校正
                _lastTailHmdTime: ''    // 留空，让 applyPositionCorrection 首次触发校正
            };
        }
    });
    console.log('[启动] 从RenderCacheStore恢复', Object.keys(RenderCacheStore.data).length, '根钢坯位置（缓存新鲜）');
} else if (Object.keys(RenderCacheStore.data).length > 0) {
    // 缓存过期：清空 StateStore 和 RenderCacheStore，等待全量重算
    console.log('[启动] RenderCacheStore缓存已过期（', ((Date.now() - _cacheMaxUpdateTime) / 1000).toFixed(1), '秒前），清空等待全量重算');
    SteelStateStore.data = {};
    RenderCacheStore.data = {};
}

startSteelSimulator();

// 页面从后台切回前台时，用工艺约束重算所有钢坯位置（不走forwardSimulate推算）
document.addEventListener('visibilitychange', function () {
    if (!document.hidden && SteelFactStore.initialized) {
        Object.keys(SteelStateStore.data).forEach(function (inMatNo) {
            var fact = SteelFactStore.data[inMatNo];
            var steel = SteelStateStore.data[inMatNo];
            if (fact && steel) {
                // 用工艺约束重算头尾位置
                var constraints = applyProcessConstraints(fact);
                if (constraints.headX !== null) {
                    steel.headX = constraints.headX;
                }
                if (constraints.tailX !== null) {
                    steel.tailX = constraints.tailX;
                }
                // 更新 HMD 时间戳，避免后续 applyPositionCorrection 重复校正
                if (fact.headTime) steel._lastHeadHmdTime = fact.headTime;
                if (fact.tailTime) steel._lastTailHmdTime = fact.tailTime;
            }
        });

        cleanupFinishedSteels();
        console.log('[可见性恢复] 工艺约束重算钢坯位置 + 下线清理完成');
    }
});

/**
 * ===== 钢坯生命周期管理 =====
 *
 * 钢坯从进入轧线到下线经历：addSteelToState → 运动推演 → removeSteelFromState
 * 中间可能被后端热检数据校正位置（applyPositionCorrection）
 */

//钢坯长度计算：头尾X坐标之差，最小为0
function getSteelLength(steel) {

    return Math.max(
        0,
        steel.headX - steel.tailX
    );

}

/**
 * 事件：轧线新增钢坯
 *
 * 当后端首次推送某钢坯数据时调用。
 * 核心逻辑：根据后端推送的头/尾热检位置+时间，正向推算钢坯当前在轧线上应该到达的位置。
 * 这样即使数据有延迟，钢坯也能以合理的初始位置加入模拟。
 */
/**
 * ===== 工艺约束：根据后端发送的热检位置确定钢坯初始头尾位置 =====
 *
 * 根据后端推送的 headPosition / tailPosition 热检名称，
 * 结合工艺经验确定钢坯初始位置，比纯数学推算更可靠。
 *
 * 规则表：
 *   1. 头在DescalerBeforeHmd → 尾=0
 *   2. 头在PinchRollBeforeHmd → 尾=DescalerBeforeHmd位置
 *   3. 头在Stand2/4EntryHmd → 尾=250
 *   4. 头在Stand6EntryHmd → 尾=后端实际/250
 *   5. 头在RollTable6AEntryHmd → 尾同点则头=778尾=628，否则后端实际/300
 *   6. 头在RollTable6BEntryHmd → 尾同点则头=985尾=835，尾在6A则头=900尾=750
 *   7. 头在No1ShearBeforeHmd → 尾=903
 *   8. 头在中轧/预精轧各站 → 尾=No1ShearBeforeHmd位置/后端实际
 *   9. 头在Stand16ExitHmd → 尾=1100/后端实际
 *  10. 头在No3ShearEntryHmd/Stand17EntryHmd → 尾=2100/后端实际
 *  11. 头在No4WaterTankEntryHmd → 尾=2100/后端实际
 */
function applyProcessConstraints(item) {
    var headPos = item.headPosition || '';
    var tailPos = item.tailPosition || '';

    // 获取后端发送的尾位置X（如果有）
    var backendTailX = null;
    if (tailPos && item.tailTime) {
        var tailHmdX = resolvePositionX(tailPos);
        if (tailHmdX !== undefined) {
            backendTailX = forwardSimulatePosition(tailHmdX, item.tailTime, 'tail');
        }
    }

    // No1ShearBeforeHmd 的 X 位置（规则8/9/10引用）
    var no1ShearX = TRACK_POSITION_MAP.get('No1ShearBeforeHmd');
    // DescalerBeforeHmd 的 X 位置（规则2引用）
    var descalerX = TRACK_POSITION_MAP.get('DescalerBeforeHmd');

    var result = { headX: null, tailX: null };

    // 规则1：头在DescalerBeforeHmd → 尾=0
    if (headPos === 'DescalerBeforeHmd') {
        result.tailX = 0;
    }
    // 规则2：头在PinchRollBeforeHmd → 尾=DescalerBeforeHmd位置
    else if (headPos === 'PinchRollBeforeHmd') {
        result.tailX = descalerX !== undefined ? descalerX : 0;
    }
    // 规则3：头在Stand2/4EntryHmd → 尾=250
    else if (headPos === 'Stand2EntryHmd' || headPos === 'Stand4EntryHmd') {
        result.tailX = 250;
    }
    // 规则4：头在Stand6EntryHmd → 尾=后端实际/250
    else if (headPos === 'Stand6EntryHmd') {
        result.tailX = backendTailX !== null ? backendTailX : 250;
    }
    // 规则5：头在RollTable6AEntryHmd
    else if (headPos === 'RollTable6AEntryHmd') {
        if (tailPos === 'RollTable6AEntryHmd') {
            // 头尾都在6A → 固定位置
            result.headX = 778;
            result.tailX = 628;
        } else {
            result.tailX = backendTailX !== null ? backendTailX : 300;
        }
    }
    // 规则6：头在RollTable6BEntryHmd
    else if (headPos === 'RollTable6BEntryHmd') {
        if (tailPos === 'RollTable6BEntryHmd') {
            // 头尾都在6B → 固定位置
            result.headX = 985;
            result.tailX = 835;
        } else if (tailPos === 'RollTable6AEntryHmd') {
            // 头在6B、尾在6A → 固定位置
            result.headX = 900;
            result.tailX = 750;
        } else {
            result.tailX = backendTailX !== null ? backendTailX : 0;
        }
    }
    // 规则7：头在No1ShearBeforeHmd → 尾=903
    else if (headPos === 'No1ShearBeforeHmd') {
        result.tailX = 903;
    }
    // 规则8：头在中轧/预精轧各站 → 尾=No1ShearBeforeHmd位置/后端实际
    else if (headPos === 'Stand7EntryHmd' || headPos === 'Stand9EntryHmd' ||
             headPos === 'Stand12EntryHmd' || headPos === 'No2ShearEntryHmd' ||
             headPos === 'Stand13EntryHmd' || headPos === 'Stand15EntryHmd') {
        result.tailX = backendTailX !== null ? backendTailX : (no1ShearX !== undefined ? no1ShearX : 760);
    }
    // 规则9：头在Stand16ExitHmd → 尾=1100/后端实际
    else if (headPos === 'Stand16ExitHmd') {
        result.tailX = backendTailX !== null ? backendTailX : 1100;
    }
    // 规则10：头在No3ShearEntryHmd/Stand17EntryHmd → 尾=2100/后端实际
    else if (headPos === 'No3ShearEntryHmd' || headPos === 'Stand17EntryHmd') {
        result.tailX = backendTailX !== null ? backendTailX : 2100;
    }
    // 规则11：头在No4WaterTankEntryHmd → 尾=2100/后端实际
    else if (headPos === 'No4WaterTankEntryHmd') {
        result.tailX = backendTailX !== null ? backendTailX : 2100;
    }

    return result;
}

function addSteelToState(item) {
    normalizeBackendItem(item);  // 安全兜底：确保后端 slabNo 已映射为 inMatNo

    // 唯一性守卫1：已在 StateStore 中 → 不重复创建
    if (SteelStateStore.data[item.inMatNo]) {
        return;
    }

    // 唯一性守卫2：已标记为下线（finishedInMatNos 黑名单）→ 僵尸钢坯不得复活
    if (finishedInMatNos[item.inMatNo]) {
        console.warn('[addSteelToState] 拒绝已下线钢坯重新加入:', item.inMatNo);
        return;
    }

    // 从头/尾经过的热检位置+时间，通过分区速度正向推算当前位置
    var calcHeadX = 0;
    var calcTailX = 0;
    var lastHeadHmdTime = '';
    var lastTailHmdTime = '';

    if (item.headPosition && item.headTime) {
        var hmdX = resolvePositionX(item.headPosition);
        if (hmdX !== undefined) {
            calcHeadX = forwardSimulatePosition(hmdX, item.headTime, 'head');
            lastHeadHmdTime = item.headTime;
            // 记录初次热检经过
            HmdPassStore.recordPass(
                item.inMatNo, item.cardNo, item.furnaceCode,
                'head', item.headPosition, item.headTime
            );
        }
    }

    if (item.tailPosition && item.tailTime) {
        var hmdX = resolvePositionX(item.tailPosition);
        if (hmdX !== undefined) {
            calcTailX = forwardSimulatePosition(hmdX, item.tailTime, 'tail');
            lastTailHmdTime = item.tailTime;
            // 记录初次热检经过
            HmdPassStore.recordPass(
                item.inMatNo, item.cardNo, item.furnaceCode,
                'tail', item.tailPosition, item.tailTime
            );
        }
    }

    // 工艺约束：根据后端发送的热检位置确定初始头尾位置
    var constraints = applyProcessConstraints(item);
    if (constraints.headX !== null) {
        calcHeadX = constraints.headX;
    }
    if (constraints.tailX !== null) {
        calcTailX = constraints.tailX;
    }

    SteelStateStore.data[item.inMatNo] = {

        inMatNo: item.inMatNo,

        cardNo: item.cardNo,

        furnaceCode:
            item.furnaceCode || '',

        color:
            item.color || 'red',

        state: 'ENTRY',

        headX: calcHeadX,
        tailX: calcTailX,

        headSpeed: 0,
        tailSpeed: 0,

        createTime: getServerNow(),
        updateTime: getServerNow(),

        _lastHeadHmdTime: lastHeadHmdTime,
        _lastTailHmdTime: lastTailHmdTime
    };

    console.log(
        '[钢坯进入轧线]',
        item.inMatNo,
        '推算位置 headX=' + calcHeadX.toFixed(1),
        'tailX=' + calcTailX.toFixed(1)
    );
}

/**
 * 事件：轧线下线钢坯
 * 从 StateStore 中移除钢坯，并持久化。会先检测无效条目并清理。
 */
function removeSteelFromState(inMatNo) {

    const steel = SteelStateStore.data[inMatNo];

    // 空字符串、null、undefined 等无效值，直接清理
    if (!steel || typeof steel !== 'object') {
        delete SteelStateStore.data[inMatNo];
        cleanupSteelTrackers(inMatNo);
        return;
    }

    console.log(
        '[钢坯离开轧线]',
        inMatNo
    );

    delete SteelStateStore.data[inMatNo];

    // 统一清理该钢坯在所有 tracker 中的追踪数据
    cleanupSteelTrackers(inMatNo);

    SteelStateStore.save();
}

/**
 * 统一清理钢坯在核心 tracker 中的追踪数据
 *
 * 当前仅包含集合点控制相关的两个核心 tracker：
 *   steelCollectionTracker - 集合点控制状态（applyCollectionPointControl）
 *   headBlockedState       - 头部阻塞状态（canHeadAdvance）
 *
 * 在 removeSteelFromState 中调用，确保钢坯下线时一次性清理所有 tracker。
 * 新增核心 tracker 只需在此函数中添加一行 delete 即可。
 */
function cleanupSteelTrackers(inMatNo) {
    delete steelCollectionTracker[inMatNo];
    delete headBlockedState[inMatNo];
}

/**
 * steelCollectionTracker 的 LRU 容量控制（最多10条）
 * 在 applyCollectionPointControl 中调用，与清理逻辑解耦
 */
function trimCollectionTracker() {
    var keys = Object.keys(steelCollectionTracker);
    if (keys.length <= 10) return;

    keys.sort(function (a, b) {
        var tA = steelCollectionTracker[a] && steelCollectionTracker[a]._updateTime || 0;
        var tB = steelCollectionTracker[b] && steelCollectionTracker[b]._updateTime || 0;
        return tA - tB;
    });

    var deleteCount = keys.length - 10;
    for (var i = 0; i < deleteCount; i++) {
        delete steelCollectionTracker[keys[i]];
    }
}

/**
 * 建立事实基线（仅在首次接收到后端数据时执行）
 * 将后端推送的全部钢坯数据初始化为 FactStore，标记 initialized=true
 */
/**
 * 归一化后端推送数据：将后端字段 slabNo 统一映射为内部使用的 inMatNo
 * 后端接口仍返回 slabNo，内部代码统一使用 inMatNo
 */
function normalizeBackendItem(item) {
    if (item.slabNo !== undefined && item.inMatNo === undefined) {
        item.inMatNo = item.slabNo;
    }
    return item;
}

function buildFactBaseline(rawData) {

    rawData.forEach(item => {
        normalizeBackendItem(item);

        // 防御：rawData 本身出现重复的 inMatNo（后端异常），后者覆盖前者并警告
        if (SteelFactStore.data[item.inMatNo]) {
            console.warn('[buildFactBaseline] rawData内发现重复钢坯号:', item.inMatNo, '→覆盖');
        }

        SteelFactStore.data[item.inMatNo] = {
            ...item,
            updateTime: getServerNow()
        };

    });

    SteelFactStore.initialized = true;

    SteelFactStore.save();

    console.log(
        '[FactStore] 基线建立完成'
    );
}

/**
 * 更新事实仓库
 *
 * 每次后端推送数据时执行，完成三步操作：
 *   1. 对比新旧数据，新增钢坯 → 加入 StateStore
 *   2. 对比新旧数据，离线钢坯 → 从 StateStore 移除
 *   3. 替换 FactStore 为最新数据快照
 *
 * 注意：已标记为下线的钢坯（finishedInMatNos）不会被重新加入，
 * 防止钢坯经过离线检查点后又被服务端重新推送导致"僵尸钢坯"。
 */
function updateFactStore(rawData) {

    const oldFactData =
        SteelFactStore.data;

    const newFactData = {};

    rawData.forEach(item => {
        normalizeBackendItem(item);  // 映射后端 slabNo → inMatNo

        const inMatNo = item.inMatNo;

        newFactData[inMatNo] = {

            ...item,

            updateTime: getServerNow()
        };

        // 新钢坯进入（已下线钢坯跳过，防止僵尸死循环）
        if (!oldFactData[inMatNo] && !finishedInMatNos[inMatNo]) {

            addSteelToState(item);

        }
    });

    // 离线钢坯（服务端不再推送）
    Object.keys(oldFactData).forEach(
        inMatNo => {

            if (!newFactData[inMatNo]) {

                removeSteelFromState(
                    inMatNo
                );

                // 清理下线标记，下次若重新出现可正常接入
                delete finishedInMatNos[inMatNo];

            }

        }
    );

    SteelFactStore.data =
        newFactData;

    SteelFactStore.save();
}

/**
 * 同步 FactStore → StateStore
 *
 * 后端数据到达时事件驱动触发，确保 StateStore 与 FactStore 的钢坯集合一致：
 *   - FactStore 有但 StateStore 没有 → 新增到 StateStore
 *   - StateStore 有但 FactStore 没有 → 从 StateStore 移除
 *
 * 还会清理 StateStore 中的无效条目（非钢坯对象），防止脏数据污染。
 */
function syncFactToState() {

    const factMap =
        SteelFactStore.data;

    const stateMap =
        SteelStateStore.data;

    // 清理状态仓库中的无效条目（非钢坯对象）
    Object.keys(stateMap).forEach(function(key) {
        var val = stateMap[key];
        if (!val || typeof val !== 'object' || !val.inMatNo) {
            console.warn('[StateStore] 清理无效条目:', key);
            delete stateMap[key];
        }
    });

    // ===== 新钢坯 =====
    Object.values(factMap).forEach(fact => {

        const inMatNo =
            fact.inMatNo;

        if (!stateMap[inMatNo]) {

            // 已下线钢坯不重新加入，防止僵尸钢坯死循环
            if (finishedInMatNos[inMatNo]) {
                return;
            }

            addSteelToState(fact);

            console.log(
                '[新增钢坯]',
                inMatNo
            );
        }

    });

    // ===== 离线钢坯（先收集，再批量移除，避免遍历中多次 save）=====
    var removeList = [];
    Object.keys(stateMap).forEach(
        inMatNo => {

            if (!factMap[inMatNo]) {

                removeList.push(inMatNo);

            }

        }
    );

    removeList.forEach(function (inMatNo) {
        removeSteelFromState(inMatNo);
        console.log(
            '[离线钢坯]',
            inMatNo
        );
    });

    if (removeList.length > 0) {
        SteelStateStore.save();
    }
}

/**
 * ===== 运动求解器 =====
 *
 * 核心思路：将轧线划分为多个分区，每个分区有独立的头/尾速度，
 * 钢坯根据当前 state 所属分区计算速度，然后按时间步长 dt 更新位置。
 *
 * 当前求解流程（插件已移除，仅保留4步核心逻辑）：
 *    1  updateSteelPhase()    → 根据位置判定钢坯阶段
 *    2  updateSteelSpeed()    → 根据阶段查表获取头/尾速度
 *    3  updateSteelPosition() → 速度×dt累加到位置
 *    4  isSteelFinished()     → 离线判断
 */

/**
 * 轧制分区列表（只有这四个分区中钢坯才算"正在轧制"）
 * 轧制判定的充分条件：钢坯的尾<分区结束 且 头>分区开始（钢坯至少部分覆盖该分区）
 */
const ROLLING_ZONE_NAMES = [
    'ROUGH',
    'MIDDLE',
    'PREFINISH',
    'FINISH'
];

/**
 * 获取钢坯当前所在的轧制分区
 * 只在 ROLLING_ZONE_NAMES 列出的分区中查找，
 * 条件：钢坯尾位置 < 分区结束 && 钢坯头位置 > 分区开始
 * 即钢坯的任一部分覆盖该分区就算"在该轧制分区内"
 */
function getCurrentRollingZone(steel) {

    return MILL_ZONES.find(zone => {

        if (
            !ROLLING_ZONE_NAMES.includes(
                zone.name
            )
        ) {
            return false;
        }

        return (
            steel.tailX < zone.end &&
            steel.headX > zone.start
        );

    }) || null;
}

//根据单个X坐标判定所属分区（用于钢坯头不在轧制区时判定roll阶段）
function getCurrentZone(position) {

    return MILL_ZONES.find(zone => {

        return (
            position >= zone.start &&
            position < zone.end
        );

    }) || null;

}

//获取单个X坐标所属分区名称
function getCurrentZoneName(position) {

    const zone =
        getCurrentZone(position);

    return zone
        ? zone.name
        : 'UNKNOWN';

}

/**
 * 状态判定：根据钢坯位置确定当前阶段
 *
 * 判定优先级：
 *   1. 钢坯长度 < 150 → ENTRY（刚出炉，还没完全形成）
 *   2. 钢坯覆盖轧制分区 → 使用该轧制分区名作为 state
 *   3. 以上都不满足 → 根据头的X坐标判定所在分区
 */
function updateSteelPhase(steel) {

    const length =
        getSteelLength(steel);

    // 长度过短视为出钢阶段（尾位置可能尚未被后端推送）
    if (length < 150) {

        steel.state = 'ENTRY';

        return;
    }

    // 优先判定是否在轧制区（ROUGH/MIDDLE/PREFINISH/FINISH）
    const rollingZone =
        getCurrentRollingZone(
            steel
        );

    if (rollingZone) {

        steel.state =
            rollingZone.name;

        return;
    }

    // 不在轧制区则根据头位置判定（ROLL1/ROLL2/ROLL3/ROLL4/ROLL5）
    steel.state =
        getCurrentZoneName(
            steel.headX
        );
}

/**
 * 速度求解：根据钢坯 state 查表获取头/尾速度
 *
 * ENTRY 阶段的特殊处理：
 *   头以 5 速度前进（模拟钢坯出炉推出），
 *   尾速度为 0（尾位置由后端数据驱动，前端不主动推进）。
 *   当后端推送尾位置后，长度 > 150，state 自然切换到后续阶段。
 */
function updateSteelSpeed(steel) {

    // 出钢阶段：只有头在移动，尾等待后端数据
    if (steel.state === 'ENTRY') {

        steel.headSpeed = 5;

        steel.tailSpeed = 0;

        return;
    }

    const speedConfig =
        SPEED_CONFIG[
            steel.state
        ];

    // 无配置的分区（如超出终点的区域），速度为0
    if (!speedConfig) {

        steel.headSpeed = 0;

        steel.tailSpeed = 0;

        return;
    }

    steel.headSpeed =
        speedConfig.headSpeed;

    steel.tailSpeed =
        speedConfig.tailSpeed;
}

// ===== 集合点信号控制逻辑（独立模块，不影响渲染层和现有计算层） =====
// 基于 All_POSITION_MAP 中各集合点的有钢信号（a('rolledState')或a('有钢信号')）
// 控制钢坯头/尾的前进与放行，信号=1 有钢→头可进/尾不可释放，信号=0→相反

// 集合点-钢坯长度映射表已删除，改用 applyProcessConstraints 工艺约束规则

// 钢坯集合点追踪：记录每根钢坯头尾经过集合点的状态（声明已提前至文件前部）

/**
 * 获取指定集合点 tag 对应的图纸节点
 */
function getCollectionNode(tag) {
    return dm.getDataByTag(tag);
}

/**
 * 归一化信号值 → 布尔
 * 后端可能推送: 1/0 数字、"True"/"False" 字符串、true/false 布尔
 * @returns {boolean}
 */
function isSignalTruthy(val) {
    if (val === undefined || val === null) return false;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    // 字符串: "True"/"true"/"1" → true, 其余 → false
    var s = String(val).trim();
    return s === 'True' || s === 'true' || s === '1';
}

/**
 * 获取集合点信号值
 * 优先读取 a('rolledState')，其次读取 a('有钢信号')，默认返回 0
 * @returns {number} 1=有钢, 0=无钢
 */
function getCollectionSignal(tag) {
    var node = getCollectionNode(tag);
    if (!node) return 0;

    var signal = node.a('rolledState');
    if (signal !== undefined && signal !== null) {
        return isSignalTruthy(signal) ? 1 : 0;
    }

    signal = node.a('有钢信号');
    if (signal !== undefined && signal !== null) {
        return isSignalTruthy(signal) ? 1 : 0;
    }

    return 0;
}

/**
 * 判断集合点是否活跃（可作为头尾释放决策依据）
 * millstate系列需要轧机正在运行(runningState=1)才参与判断，
 * track-* 热检始终参与判断
 * @returns {boolean}
 */
function isActiveCollectionPoint(tag) {
    // track-* 热检始终活跃
    if (tag.indexOf('millstate') !== 0) return true;

    // millstate需要检查运行状态和轧制状态
    var node = getCollectionNode(tag);
    if (!node) return false;

    var running = node.a('runningState');
    var rolling = node.a('rolledState');

    // 归一化：后端可能推送 "True"/"False" 字符串 或 1/0 数字
    var runningOff = !isSignalTruthy(running);
    if (runningOff) {
        return false;
    }
    return true;
}

/**
 * 获取头位置下一个即将经过的集合点
 * 钢坯从右至左运动（headX递减），下一个集合点是 X < headX 中 X 最大（最靠近）者
 */
function getNextCollectionPoint(headX) {
    var result = null;
    var maxX = -Infinity;
    All_POSITION_MAP.forEach(function (x, tag) {
        if (x < headX && isActiveCollectionPoint(tag) && x > maxX) {
            result = { tag: tag, x: x };
            maxX = x;
        }
    });
    return result;
}

/**
 * 获取头位置上一次经过的最后一个集合点
 * 钢坯从右至左运动，已走过的点在头右侧（X > headX），取其中 X 最小（最靠近）者
 */
function getLastPassedPoint(headX) {
    var result = null;
    var minX = Infinity;
    All_POSITION_MAP.forEach(function (x, tag) {
        if (x > headX && isActiveCollectionPoint(tag) && x < minX) {
            result = { tag: tag, x: x };
            minX = x;
        }
    });
    return result;
}

/**
 * 获取尾位置下一个需要经过的集合点
 * 钢坯从右至左运动（tailX递减），下一个集合点是 X < tailX 中 X 最大（最靠近）者
 */
function getTailNextPoint(tailX) {
    var result = null;
    var maxX = -Infinity;
    All_POSITION_MAP.forEach(function (x, tag) {
        if (x < tailX && isActiveCollectionPoint(tag) && x > maxX) {
            result = { tag: tag, x: x };
            maxX = x;
        }
    });
    return result;
}

// 记录头受阻的上一帧状态，避免每帧重复打印（声明已提前至文件前部）

/**
 * 判定头位置能否前进
 * 条件：下一个即将经过的集合点信号=1（有钢）
 * 信号闪烁由后端处理，前端不做闪烁判定
 * 如果没有下一个集合点（已超出所有集合点范围），默认允许前进
 * @returns {boolean}
 */
function canHeadAdvance(steel) {
    var next = getNextCollectionPoint(steel.headX);

    // 已超出最后一个集合点，无限制
    if (!next) {
        return true;
    }

    // 下一个集合点存在但需要检查（信号闪烁由后端处理，前端不做闪烁判定）
    var signal = getCollectionSignal(next.tag);

    if (signal !== 1) {
        // 仅在受阻状态变化时才打印日志（新受阻 或 受阻点发生变化）
        var prevBlocked = headBlockedState[steel.inMatNo];
        var isNewBlock = !prevBlocked || prevBlocked.tag !== next.tag;

        if (isNewBlock) {
            var extraInfo = '';
            if (next.tag.indexOf('millstate') === 0) {
                var blockNode = getCollectionNode(next.tag);
                if (blockNode) {
                    extraInfo = ' | running=' + blockNode.a('runningState') + ' rolling=' + blockNode.a('rolledState');
                }
            }
            console.log(
                '[集合控制·头受阻]', steel.inMatNo,
                '| 头位置=' + steel.headX.toFixed(1),
                '| 受阻于', next.tag + '(x=' + next.x + ')',
                '| 原因: 信号=' + signal + '→无钢' + extraInfo
            );

            // 打印当前时刻所有活跃检查点（含轧机running/rolling状态）
            var activeNow = [];
            All_POSITION_MAP.forEach(function (px, ptag) {
                if (isActiveCollectionPoint(ptag)) {
                    var pnode = getCollectionNode(ptag);
                    var pextra = '';
                    if (ptag.indexOf('millstate') === 0 && pnode) {
                        pextra = ' r=' + pnode.a('runningState') + ' s=' + pnode.a('rolledState');
                    }
                    activeNow.push(ptag + '(x=' + px + pextra + ')');
                }
            });
            console.log('[当前活跃检查点] 共 ' + activeNow.length + ' 个:', activeNow);
        }

        headBlockedState[steel.inMatNo] = { tag: next.tag };

        // 受阻解除时清理（RTL: headX递减，headX < next.x 表示头已越过该集合点）
        if (prevBlocked && steel.headX < next.x) {
            delete headBlockedState[steel.inMatNo];
        }

        return false;
    }

    // 头可前进，清除受阻记录
    if (headBlockedState[steel.inMatNo]) {
        console.log(
            '[集合控制·头放行]', steel.inMatNo,
            '| 头位置=' + steel.headX.toFixed(1),
            '| 下一集合点', next.tag, '信号=' + signal + '→有钢，允许前进'
        );
        delete headBlockedState[steel.inMatNo];
    }

    return true;
}

/**
 * 判定尾位置能否释放
 *
 * 与头位置对称：尾也检查下一个即将经过的集合点，信号=0 才能前进，
 * 信号=1(有钢)则阻塞（钢坯还在轧制中，尾不能释放）。
 * 按集合点物理顺序逐个释放。
 *
 * @returns {object|null} 如果可释放，返回目标集合点；否则返回 null
 */
function getTailReleasePoint(steel) {
    var next = getTailNextPoint(steel.tailX);

    // 没有下一个集合点（已超出终点）→ 允许释放
    if (!next) return null;

    // 下一个集合点在头之前 → 头还没过，尾不能先过
    if (next.x > steel.headX) return null;

    // 未运行的轧机不参与判断
    if (!isActiveCollectionPoint(next.tag)) return null;

    // 信号=0(无钢) → 可释放；信号=1(有钢) → 阻塞
    var signal = getCollectionSignal(next.tag);

    if (signal === 0) {
        return next;
    }

    return null;
}

/**
 * 控制脚：根据集合点信号覆写头尾速度（独立函数，不干涉渲染和计算层）
 *
 * 调用顺序：在 updateSteelSpeed() 之后、updateSteelPosition() 之前调用
 */
function applyCollectionPointControl(steel) {
    var key = steel.inMatNo;

    // ENTRY阶段跳过集合点控制（钢坯刚入线，头尾尚未完全形成，需先无阻进入）
    if (steel.state === 'ENTRY') {
        return;
    }

    // steelCollectionTracker LRU 容量控制：最多保留10条
    // （已下线钢坯的清理已统一移至 cleanupSteelTrackers，在 removeSteelFromState 中触发）
    trimCollectionTracker();

    // 初始化追踪（保留对旧tracker数据的兼容）
    if (!steelCollectionTracker[key]) {
        steelCollectionTracker[key] = {
            _updateTime: Date.now()
        };
    }
    steelCollectionTracker[key]._updateTime = Date.now();

    var tracker = steelCollectionTracker[key];
    var headCanGo = canHeadAdvance(steel);
    var tailReleasePoint = getTailReleasePoint(steel);

    // 记录上次控制状态，避免每帧重复打印相同状态
    var prevState = tracker._lastControlState || '';

    // 情况1：头可进、尾可释放 → 正常前进
    if (headCanGo && tailReleasePoint) {
        // 头部正常（速度保持不变或已有速度）
        // 尾部释放到集合点位置（信号=0 允许尾通过）
        if (steel.tailX < tailReleasePoint.x) {
            // 速度 = 距离差 × 10，上限 50（防止距离过大时尾部速度异常）
            steel.tailSpeed = Math.min((tailReleasePoint.x - steel.tailX) * 10, 50);
        }
        var stateKey1 = 'release-' + tailReleasePoint.tag;
        if (prevState !== stateKey1) {
            console.log('[集合控制]', steel.inMatNo, '头可进，尾释放到', tailReleasePoint.tag,
                '(信号=0→无钢)');
        }
        tracker._lastControlState = stateKey1;
        return;
    }

    // 情况2：头可进、尾不可释放 → 头正常前进（原速度），尾不动
    if (headCanGo && !tailReleasePoint) {
        steel.tailSpeed = 0;
        // headSpeed 保持原值，不干预
        tracker._lastControlState = '';
        return;
    }

    // 情况3：头不可进、尾可释放 → 头尾都不可前进
    if (!headCanGo && tailReleasePoint) {
        steel.headSpeed = 0;
        steel.tailSpeed = 0;
        // 仅在状态变化时打印（首次进入情况3 或 尾释放点变化）
        var stateKey3 = 'blocked3-' + tailReleasePoint.tag;
        if (prevState !== stateKey3) {
            console.log('[集合控制]', steel.inMatNo,
                '尾可释放(' + tailReleasePoint.tag + ')但头受阻，双边暂停');
        }
        tracker._lastControlState = stateKey3;
        return;
    }

    // 情况4：头尾都不可前进 → 钢坯停在两个集合点之间
    if (!headCanGo && !tailReleasePoint) {
        steel.headSpeed = 0;
        steel.tailSpeed = 0;
        if (prevState !== 'blocked4') {
            console.log('[集合控制]', steel.inMatNo, '头尾均受阻，双边暂停');
        }
        tracker._lastControlState = 'blocked4';
        return;
    }
}

// calculateLengthFromCollectionPoint 函数已删除，改用 applyProcessConstraints 工艺约束规则

/**
 * 集合点信号约束：裁切头位置
 *
 * 当头位置试图越过某个集合点时，检查该集合点是否可以通行。
 * 依次检查 currentHeadX → proposedHeadX 之间的所有集合点，
 * 遇到第一个信号≠1的活跃集合点，即将头位置卡在该点之前。
 * 未运行轧机(millstate runningState=0)不参与约束。
 *
 * @param {object} steel         - 钢坯状态对象
 * @param {number} proposedHeadX - 后端推送或正向推算的目标头位置
 * @returns {number} 受约束后的头位置
 */
function clipHeadBySignals(steel, proposedHeadX) {
    var clippedX = proposedHeadX;

    // 以 lo/hi 确定两位置间的范围，适应双向（RTL为主）
    var lo = Math.min(steel.headX, proposedHeadX);
    var hi = Math.max(steel.headX, proposedHeadX);

    // 遍历 [lo, hi] 范围内的集合点（All_POSITION_MAP 从右→左，即大X→小X）
    var iterator = All_POSITION_MAP.entries();
    var entry;
    while ((entry = iterator.next()) && !entry.done) {
        var tag = entry.value[0];
        var x = entry.value[1];

        // 在范围右侧（已走过），跳过
        if (x > hi) continue;
        // 在范围左侧（尚未到达），停止
        if (x < lo) break;

        // 未运行的轧机不参与约束
        if (!isActiveCollectionPoint(tag)) continue;

        // 检查此集合点是否允许通行（信号闪烁由后端处理）
        var signal = getCollectionSignal(tag);

        if (signal !== 1) {
            // 不允许越过此点，裁切头
            clippedX = x;
            console.log('[头位置约束]', steel.inMatNo,
                '目标=' + proposedHeadX.toFixed(1),
                '受阻于', tag + '(信号=' + signal + '→无钢)',
                '→裁切为' + clippedX.toFixed(1));
            break;
        }
    }

    return clippedX;
}

/**
 * 集合点信号约束：裁切尾位置
 *
 * 与头裁切对称：尾位置也不能越过信号=1的集合点（该点有钢在轧制）。
 * 依次检查 currentTailX → proposedTailX 之间的集合点，
 * 遇到第一个信号≠0或头未经过的点，即将尾位置卡在该点之前。
 *
 * @param {object} steel         - 钢坯状态对象
 * @param {number} proposedTailX - 后端推送或正向推算的目标尾位置
 * @returns {number} 受约束后的尾位置
 */
function clipTailBySignals(steel, proposedTailX) {
    var clippedX = proposedTailX;

    // 以 lo/hi 确定两位置间的范围，适应双向（RTL为主）
    var lo = Math.min(steel.tailX, proposedTailX);
    var hi = Math.max(steel.tailX, proposedTailX);

    // 遍历 [lo, hi] 范围内的集合点（All_POSITION_MAP 从右→左，即大X→小X）
    var iterator = All_POSITION_MAP.entries();
    var entry;
    while ((entry = iterator.next()) && !entry.done) {
        var tag = entry.value[0];
        var x = entry.value[1];

        // 在范围右侧，跳过
        if (x > hi) continue;
        // 在范围左侧，停止
        if (x < lo) break;

        // 跳过未运行的轧机
        if (!isActiveCollectionPoint(tag)) continue;

        // 头未经过此点 → 尾也不能过
        if (x > steel.headX) {
            clippedX = x;
            console.log('[尾位置约束]', steel.inMatNo,
                '目标=' + proposedTailX.toFixed(1),
                '受阻于', tag + '(头部未经过)',
                '→裁切为' + clippedX.toFixed(1));
            break;
        }

        // 信号=1(有钢) → 尾不能释放
        var signal = getCollectionSignal(tag);
        if (signal !== 0) {
            clippedX = x;
            console.log('[尾位置约束]', steel.inMatNo,
                '目标=' + proposedTailX.toFixed(1),
                '受阻于', tag + '(信号=' + signal + '→有钢)',
                '→裁切为' + clippedX.toFixed(1));
            break;
        }
    }

    return clippedX;
}

//位置求解函数
/**
 * 位置求解：钢坯从右至左运动，headX/tailX 递减
 *
 * @param {object} steel - 钢坯对象
 * @param {number} dt    - 时间步长（秒）
 */
function updateSteelPosition(steel, dt) {

    // 从右至左运动：headX/tailX 递减
    steel.headX -= steel.headSpeed * dt;

    var oldTailX = steel.tailX;
    steel.tailX -= steel.tailSpeed * dt;

    // 尾位置不能超出左边界
    if (steel.tailX < 0) {
        steel.tailX = 0;
    }

    // 头位置不超出左/右边界
    if (steel.headX > 3600) {
        steel.headX = 3600;
    }
    if (steel.headX < 0) {
        steel.headX = 0;
    }

    // 每帧尾部信号约束（安全网）：尾部不能越过 signal≠0 的集合点
    // 从右至左运动：tailX 递减，检查方向为 oldTailX → 变小
    if (steel.tailX < oldTailX && steel.tailSpeed > 0) {
        var iterator = All_POSITION_MAP.entries();
        var entry;
        while ((entry = iterator.next()) && !entry.done) {
            var tag = entry.value[0];
            var x = entry.value[1];
            if (x >= oldTailX) continue;
            if (x < steel.tailX) break;
            if (!isActiveCollectionPoint(tag)) continue;
            var signal = getCollectionSignal(tag);
            if (signal !== 0) {
                steel.tailX = x;
                steel.tailSpeed = 0;
                break;
            }
        }
    }
}

/**
 * 正向位置推算：从HMD经过位置+时间，推算当前钢坯头/尾的实际位置
 *
 * 为什么需要推算？
 *   后端推送的数据有网络延迟，钢坯在HMD检测后可能已经继续前进了。
 *   本函数根据经过时间和各分区的速度配置，正向推算出当前时刻钢坯应到达的位置。
 *
 * 算法：按顺序遍历所有分区，用经过时间消耗各分区的距离，
 *       剩余时间 × 速度 = 当前位置。
 *
 * @param {number} startX       - 起始位置（HMD的x坐标）
 * @param {string} startTimeStr - 经过时间 "YYYY-MM-DD HH:mm:ss.SSS"
 * @param {string} speedType    - 'head' | 'tail'（决定用headSpeed还是tailSpeed）
 * @returns {number} 推算后的当前位置
 */
function forwardSimulatePosition(startX, startTimeStr, speedType) {
    if (!startTimeStr) return startX;
    if (startX === undefined || startX === null) return 0;

    var startTime = new Date(startTimeStr.replace(' ', 'T')).getTime();
    if (isNaN(startTime)) return startX;

    var now = getServerNow();
    var remainingSec = (now - startTime) / 1000;

    if (remainingSec <= 0) return startX;

    var currentX = startX;
    var speedKey = speedType + 'Speed';  // 'headSpeed' or 'tailSpeed'

    // 从右至左运动：反向遍历分区（从大X到小X）
    for (var i = MILL_ZONES.length - 1; i >= 0; i--) {
        var zone = MILL_ZONES[i];

        if (zone.start >= currentX) continue;  // 已走过此分区（分区在当前位置的右侧）

        var zoneEnd = Math.min(currentX, zone.end);  // 进入分区的右边界
        var speed = SPEED_CONFIG[zone.name] ? SPEED_CONFIG[zone.name][speedKey] : 0;

        if (speed <= 0) {
            // 此分区速度为0，钢坯无法穿过（如tail在ENTRY阶段），终止推算
            break;
        }

        var zoneDistance = zoneEnd - zone.start;  // 从右到左穿过该分区的距离
        var timeInZone = zoneDistance / speed;

        if (remainingSec >= timeInZone) {
            currentX = zone.start;  // 到达分区左边界
            remainingSec -= timeInZone;
        } else {
            currentX -= remainingSec * speed;  // 向左移动
            remainingSec = 0;
            break;
        }
    }

    // 超出所有分区，以第一个分区的速度继续向左
    if (remainingSec > 0) {
        var firstZone = MILL_ZONES[0];
        var firstSpeed = SPEED_CONFIG[firstZone.name] ? SPEED_CONFIG[firstZone.name][speedKey] : 5;
        currentX -= remainingSec * firstSpeed;
    }

    return currentX;
}

/**
 * ===== 下线判定 =====
 * 钢坯满足以下任一条件即视为已下线，停止渲染和运动计算：
 *   1. 头位置超出终点 (≥3600)
 *   2. 尾位置经过了离线检查点 HMD 列表中的任一热检
 *
 * 已下线的钢坯会被加入 finishedInMatNos 黑名单，
 * 防止被后续的 syncFactToState / updateFactStore 重新加入（僵尸钢坯）。
 *
 * OFFLINE_HMD_LIST 和 finishedInMatNos 已声明在文件前部（~200行），
 * 因为启动重建时 cleanupFinishedSteels → isSteelFinished 会引用。
 */

/**
 * finishedInMatNos 容量控制：超过10条时淘汰最早的
 * 在所有写入点（isSteelFinished 两个分支）之后调用
 */
function trimFinishedInMatNos() {
    var keys = Object.keys(finishedInMatNos);
    if (keys.length <= 10) return;

    // 按时间戳升序排列，删除最早的
    keys.sort(function (a, b) {
        return (finishedInMatNos[a] || 0) - (finishedInMatNos[b] || 0);
    });

    var deleteCount = keys.length - 10;
    for (var i = 0; i < deleteCount; i++) {
        delete finishedInMatNos[keys[i]];
    }
}

function isSteelFinished(steel) {

    // 条件1：头超出左边界（RTL运动：headX 递减，≤0 即离开轧线起点）
    if (steel.headX <= 0) {
        finishedInMatNos[steel.inMatNo] = Date.now();
        trimFinishedInMatNos();
        return true;
    }

    // 条件2：尾经过了离线检查点（后端推送的 tailPosition 是最后经过的热检名称）
    var fact = SteelFactStore.data[steel.inMatNo];
    if (fact && fact.tailPosition && OFFLINE_HMD_LIST.indexOf(fact.tailPosition) !== -1) {
        finishedInMatNos[steel.inMatNo] = Date.now();
        trimFinishedInMatNos();
        return true;
    }

    return false;

}

/**
 * 批量清理 StateStore 中已下线的钢坯
 *
 * 使用场景：
 *   1. 启动重建后（防止已离线钢坯短暂闪现）
 *   2. 后端数据更新后（tailPosition 可能变为离线HMD，立即移除）
 *   3. 页面切回前台时（background 期间可能被 forwardSimulate 推过终点）
 *
 * 注意：仅从 StateStore 移除，不修改 FactStore（后端可能仍在推送）。
 */
function cleanupFinishedSteels() {

    var removeList = [];

    Object.values(SteelStateStore.data).forEach(function (steel) {
        if (isSteelFinished(steel)) {
            removeList.push(steel.inMatNo);
        }
    });

    removeList.forEach(function (inMatNo) {
        removeSteelFromState(inMatNo);
    });

}

/**
 * 运动推演主循环（已移除所有插件逻辑，仅保留核心运动）
 *
 * 对所有在线钢坯执行核心运动推演：
 *   1. 状态判定 → 确定钢坯当前阶段
 *   2. 速度求解 → 查表获取头/尾速度
 *   3. 位置求解 → 速度 × dt 累加到坐标
 *   4. 离线判断 → 收集需下线的钢坯
 *
 * dt 的计算：基于钢坯上次更新时间，而非固定100ms，
 * 这样即使偶尔漏帧也能保持位置计算的准确性。
 */
function updateSteelStates() {

    const now = getServerNow();

    const removeList = [];  // 先收集，后批量删除（避免遍历中修改集合）

    Object.values(
        SteelStateStore.data
    ).forEach(steel => {

        // 计算距上次更新的时间差（秒）
        const dt =
            (now - steel.updateTime) / 1000;

        steel.updateTime = now;

        // 1 状态判定 → 根据 headX/tailX 确定钢坯阶段
        updateSteelPhase(steel);

        // 2 速度求解 → 根据阶段查表获取头/尾速度
        updateSteelSpeed(steel);

        // 2.5 集合点信号控制 → 根据集合点有钢信号覆写头尾速度
        applyCollectionPointControl(steel);

        // 3 位置求解：headX/tailX -= speed × dt
        updateSteelPosition(steel, dt);

        // 4 离线判断
        if (isSteelFinished(steel)) {
            removeList.push(steel.inMatNo);
        }
    });

    // 批量移除已下线钢坯
    removeList.forEach(
        removeSteelFromState
    );

    // 快照最终渲染位置到 RenderCacheStore（用于页面刷新时恢复画面）
    RenderCacheStore.snapshot();
}

/**
 * ===== 渲染接入层 =====
 *
 * 将 StateStore 中的钢坯运动状态转换为渲染所需的模型，
 * 桥梁作用：运动数据 → 渲染数据
 */

//Render接入层：从 StateStore 提取所有钢坯并转为渲染模型
function buildRenderData() {

    return Object
        .values(
            SteelStateStore.data
        )
        .map(
            buildRenderModel
        );
}

/**
 * 构建单条钢坯的渲染模型
 * 在运动状态基础上追加渲染专用字段：length, label, borderColor
 */
function buildRenderModel(steel) {

    // 计算层坐标 → 渲染层坐标（归一化处理）
    var coords = processRenderCoords(steel.headX, steel.tailX);

    return {

        // 继承全部运动状态（headX, tailX, headSpeed, tailSpeed, state, ...）
        ...steel,

        // 渲染层归一化坐标
        leftX:  coords.leftX,
        rightX: coords.rightX,

        // 以下为渲染专用计算字段
        length:
        getSteelLength(
            steel
        ),

        label:
            buildSteelLabel(steel),

        borderColor:
            getSteelColor(steel)
    };
}

//钢坯显示标签：兼容两种格式
//  旧格式：inMatNo = cardNo + 支数 → 显示 "卡号-炉号-支数"
//  新格式：inMatNo 与 cardNo 无关 → 显示 "卡号-炉号-钢坯号"
function buildSteelLabel(steel) {

    var labelNo = steel.inMatNo || '';

    // 旧格式：inMatNo 以 cardNo 开头，去掉前缀只显示支数部分
    if (steel.inMatNo && steel.cardNo && steel.inMatNo.startsWith(steel.cardNo)) {
        labelNo = steel.inMatNo.substring(steel.cardNo.length);
    }

    if (steel.furnaceCode) {
        return `${steel.cardNo || ''}-${steel.furnaceCode}-${labelNo}`;
    }

    return `${steel.cardNo || ''}-${labelNo}`;
}

//钢坯显示颜色映射：将颜色名称映射为CSS颜色值
const COLOR_MAP = {

    red: '#ff0000',

    green: '#00ff00',

    blue: '#0066ff',

    yellow: '#ffff00'
};

//根据钢坯 color 字段返回对应的CSS颜色值，默认红色
function getSteelColor(steel) {

    return (
        COLOR_MAP[
            steel.color
        ] || '#ff0000'
    );
}

/**
 * 启动主模拟循环
 *
 * 每100ms执行一次推演+渲染循环：
 *   1. updateSteelStates()    → 运动推演（状态判定 + 速度求解 + 位置更新 + 下线判定）
 *   2. buildRenderData()      → 构建渲染模型
 *   3. renderMultipleSteels() → 渲染到画面
 *
 * 注：syncFactToState 已移至数据监听器（事件驱动），不再在定时器中轮询。
 */
function startSteelSimulator() {

    // 防重复启动：脚本被页面/图纸重复加载时 setInterval 会永久叠加，
    // 两条推演+渲染循环交替执行，会互相覆盖 animationFrames 动画句柄，
    // 导致同一钢坯出现两条 requestAnimationFrame 链轮流写坐标（抖动、重影）。
    // 用 window 全局句柄保证同一页面上下文内只有一个主循环（先清旧，再起新）。
    if (window.__steelSimulatorTimer) {
        clearInterval(window.__steelSimulatorTimer);
    }

    window.__steelSimulatorTimer = setInterval(() => {

        updateSteelStates();

        // syncFactToState 已移至数据监听器（事件驱动），不再在定时器中轮询

        const renderData =
            buildRenderData();

        renderMultipleSteels(
            renderData
        );
        // console.log(renderData);
    }, 100);

}

/**
 * 速度参数存储（由后端实时推送更新）
 * dischargeSpeed : 出炉速度
 * rgExitSpeed    : 粗轧出口速度
 * mdExitSpeed    : 中轧出口速度
 * pfExitSpeed    : 预精轧出口速度
 * fnExitSpeed    : 精轧出口速度
 */
let SpeedStore = {
    dischargeSpeed: 0,
    rgExitSpeed: 0,
    mdExitSpeed: 0,
    pfExitSpeed: 0,
    fnExitSpeed: 0
};

/**
 * ===== 数据源监听 =====
 *
 * 监听 dataModel 的 a:rolltable 属性变化，
 * 后端通过设置该属性推送钢坯热检数据。
 *
 * 数据格式：
 *   msgTime 为服务器当前时间（格式 "YYYY-MM-DD HH:mm:ss.SSS"），
 *   data 数组的最后一组可能包含速度参数（dischargeSpeed等字段），
 *   其余项为钢坯热检数据，每项包含 inMatNo, headPosition, headTime, tailPosition, tailTime 等。
 */
// 防重复注册：脚本可能被页面/图纸重复加载导致监听器注册多次，
// 同一消息会被多次触发（表现为 console 打印多次、钢坯反复刷新留下重影）。
// 用 window 全局标记保证同一页面上下文内只注册一次（与中棒线轧机.js 保持一致）。
if (!window.__trackingListenerInstalled) {
    window.__trackingListenerInstalled = true;

    dataModel.addDataPropertyChangeListener(function (e) {

    // 只响应 a:rolltable 属性变化
    if (e.property !== 'a:rolltable') {
        return;
    }

    // 用 msgTime 校准时偏
    if (e.newValue?.msgTime) {
        var serverMs = new Date(e.newValue.msgTime.replace(' ', 'T')).getTime();
        if (!isNaN(serverMs)) {
            clockOffset = Date.now() - serverMs;
        }
    }

    // 第一次收到数据时的启动重建逻辑
    if (!_startupRebuildDone) {
        _startupRebuildDone = true;  // 无论是否重建，都标记为已处理

        if (SteelFactStore.initialized && Object.keys(SteelStateStore.data).length === 0) {
            // 无缓存：用校准后的 clockOffset 全量重建
            console.log('[启动重建] 无缓存，clockOffset已校准，从FactStore全量重建');
            Object.values(SteelFactStore.data).forEach(function (fact) {
                addSteelToState(fact);
            });
            cleanupFinishedSteels();
        } else if (Object.keys(SteelStateStore.data).length > 0) {
            // 已从 RenderCacheStore 恢复：用服务器时间校准 updateTime
            var serverNow = getServerNow();
            Object.values(SteelStateStore.data).forEach(function (steel) {
                steel.updateTime = serverNow;
            });
            console.log('[启动] RenderCacheStore缓存已恢复，用服务器时间校准updateTime');
        }
    }

    const sourceData =
        e.newValue?.data || [];

    let rawData = sourceData;
    let speedData = null;

    // 检测最后一条是否为速度数据（包含 dischargeSpeed 字段）
    const lastItem =
        sourceData[sourceData.length - 1];

    if (
        lastItem &&
        Object.prototype.hasOwnProperty.call(
            lastItem,
            'dischargeSpeed'
        )
    ) {

        speedData = lastItem;

        // 分离速度数据与钢坯数据
        rawData =
            sourceData.slice(0, -1);

        Object.assign(
            SpeedStore,
            speedData
        );

        console.log(
            '[速度参数更新]',
            SpeedStore
        );
    }

    console.log(rawData,Date.now());

    // 首次接收数据 → 建立基线
    if (
        !SteelFactStore.initialized
    ) {

        buildFactBaseline(
            rawData
        );

    } else {

        // 后续接收 → 增量更新
        updateFactStore(
            rawData
        );

    }

    // 同步 + 校正钢坯位置
    syncFactToState();
    applyFactCorrections();

    // 校正后立即清理已下线钢坯（tailPosition可能变为离线HMD，或headX被推过终点）
    cleanupFinishedSteels();

    });

}

/**
 * 校正触发：遍历 FactStore 中所有钢坯，对 StateStore 中对应钢坯执行位置校正
 *
 * 校正目的：修正前端推演的累积误差。后端每次推送最新的热检经过数据，
 * 前端据此重新推算钢坯的准确位置。
 */
function applyFactCorrections() {

    const factMap =
        SteelFactStore.data;

    const stateMap =
        SteelStateStore.data;

    Object.values(factMap)
        .forEach(fact => {

            const steel =
                stateMap[
                    fact.inMatNo
                ];

            if (!steel) {
                return;  // FactStore 中有但 StateStore 中没有（尚未加入或已下线）
            }

            applyPositionCorrection(
                fact,
                steel
            );

        });

    SteelStateStore.save();

}

/**
 * 头尾位置校正函数
 *
 * 校正逻辑：
 *   1. 对比 Fact 中的 HMD 时间与 Steel 中记录的 _lastHeadHmdTime / _lastTailHmdTime
 *   2. 时间不同 → 说明后端推送了新的经过数据 → 正向推算新位置并覆盖
 *   3. 时间相同 → 说明没有新数据 → 跳过，保留前端推演结果
 *
 * 向后兼容：如果数据只有 position 没有 time（旧格式），回退到直接设置位置。
 */
function applyPositionCorrection(
    fact,
    steel
) {

    // 钢头校正：有新HMD数据且与上次不同才触发
    if (fact.headPosition && fact.headTime) {
        const hmdX = resolvePositionX(fact.headPosition);

        // _lastHeadHmdTime 用于检测是否为新数据（避免同一HMD重复校正）
        if (hmdX !== undefined && fact.headTime !== steel._lastHeadHmdTime) {
            // 记录热检经过历史
            HmdPassStore.recordPass(
                fact.inMatNo,
                fact.cardNo,
                fact.furnaceCode,
                'head',
                fact.headPosition,
                fact.headTime
            );

            // 从HMD位置正向推算钢坯当前头位置
            var newHeadX = forwardSimulatePosition(hmdX, fact.headTime, 'head');

            // 集合点信号约束：头位置不能越过信号≠1的集合点
            newHeadX = clipHeadBySignals(steel, newHeadX);

            console.log(
                '[钢头校正]', new Date(),
                steel.inMatNo,
                steel.headX.toFixed(1),
                '→',
                newHeadX.toFixed(1),
                '(' + fact.headPosition + ' @ ' + fact.headTime + ')'
            );

            steel.headX = newHeadX;
            steel._lastHeadHmdTime = fact.headTime;  // 记录已处理的HMD时间
        }
    }

    // 钢尾校正：逻辑同钢头校正
    if (fact.tailPosition && fact.tailTime) {
        const hmdX = resolvePositionX(fact.tailPosition);

        if (hmdX !== undefined && fact.tailTime !== steel._lastTailHmdTime) {
            // 记录热检经过历史
            HmdPassStore.recordPass(
                fact.inMatNo,
                fact.cardNo,
                fact.furnaceCode,
                'tail',
                fact.tailPosition,
                fact.tailTime
            );

            // 从HMD位置正向推算钢坯当前尾位置
            var newTailX = forwardSimulatePosition(hmdX, fact.tailTime, 'tail');

            // 集合点信号约束：尾位置只能释放到信号1→0的集合点，且必须按顺序
            newTailX = clipTailBySignals(steel, newTailX);

            console.log(
                '[钢尾校正]', new Date(),
                steel.inMatNo,
                steel.tailX.toFixed(1),
                '→',
                newTailX.toFixed(1),
                '(' + fact.tailPosition + ' @ ' + fact.tailTime + ')'
            );

            steel.tailX = newTailX;
            steel._lastTailHmdTime = fact.tailTime;
        }
    }

    // 兼容旧数据格式（只有position没有time），回退到直接跳位置
    if (fact.headPosition && !fact.headTime) {
        var pos = resolvePositionX(fact.headPosition);
        if (pos !== undefined) {
            pos = clipHeadBySignals(steel, pos);
            console.log('[钢头校正(无time)]', steel.inMatNo, pos);
            steel.headX = pos;
        }
    }

    if (fact.tailPosition && !fact.tailTime) {
        var pos = resolvePositionX(fact.tailPosition);
        if (pos !== undefined) {
            pos = clipTailBySignals(steel, pos);
            console.log('[钢尾校正(无time)]', steel.inMatNo, pos);
            steel.tailX = pos;
        }
    }
}

// ===== 右键菜单逻辑（暂时注释）=====
/*
const menuItems = [
    { label: "钢坯轧废", fordata: 1, action: () => handleMenuClick("钢坯轧废") },
    { label: "钢坯剔料", fordata: 1, action: () => handleMenuClick("钢坯剔料") },
    { label: "跟踪清除", fordata: 1, action: () => handleMenuClick("跟踪清除") },
    { label: "查看计划", fordata: 1, action: () => handleMenuClick("查看计划") },
    { label: "查看实绩", fordata: 1, action: () => handleMenuClick("查看实绩") }
];

const contextmenu = new ht.widget.ContextMenu(menuItems);
contextmenu.setVisibleFunc(item => steelLineShapesCollection.includes(graphView.sm().ld()));
contextmenu.addTo(view);

function handleMenuClick(menuLabel) {
    const data = graphView.sm().ld();
    if (!data || !steelLineShapesCollection.includes(data)) {
        alert("未选中合适的节点，点击的菜单项：" + menuLabel);
        return;
    }

    const line = data.getAttr("Line") || "H901";
    let inMatNo = data.s('label');

    switch (menuLabel) {
        case "钢坯轧废": handleRollChange("1"); break;
        case "钢坯剔料": handleRollChange("2"); break;
        case "跟踪清除": requestfallowDelete(line,inMatNo); break;
        case "查看计划": requestPlanView(); break;
        case "查看实绩": requestTrueView(); break;
        default: console.warn("未处理的菜单项:", menuLabel);
    }
}

function requeststeelDisable(line,inMatNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusrolllinetrack/delslab";
    requestGet(url, { Line: line , InMatNo: inMatNo });
}

function requeststeelDelete(line,inMatNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusrolllinetrack/slabenfurnback";
    requestGet(url, { Line: line , InMatNo: inMatNo });
}

function requestfallowDelete(line,inMatNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusrolllinetrack/clearslab";
    requestGet(url, { Line: line , InMatNo: inMatNo });
}

function requestPlanView() {
    window.open('http://180.10.10.11/#/5360058618240113987/5216491215829125201/4681989552413649962', '_blank');
}

function requestTrueView() {
    window.open('http://180.10.10.11/#/5360058618240113987/5021496965365457308/5462642838515585300', '_blank');
}
*/

// ===== 左键弹窗逻辑（暂时注释）=====
/*
let isClicked = false;
let isPreparingClick = false;
let hoverTimeout, leaveTimeout;
const virtualNode = graphView.dm().getDataByTag('set');

function setVirtualNodeProperty(key, value) {
    if (value != null) {
        virtualNode.a(key, value);
        console.log(key + ' 已赋值:', value);
    }
}

graphView.getView().addEventListener('click', function (e) {
    if (!e.target.closest('.your-popup-element')) {
        virtualNode.s('2d.visible', false);
        isClicked = false;
    }
});

graphView.mi(e => {
    const data = e.data;
    if (!(data instanceof ht.Shape)) return;
    const tag = data.s('label');
    const rollnum = tag;
    if (!rollnum) return;
    let canshu = graphView.dm().getDataByTag('ByData');
    let para = graphView.dm().getDataByTag('参数');
    canshu.a('部分选中',rollnum);
    para.s('text',rollnum);
    console.log(rollnum);
    const event = e.event;
    const point = graphView.getLogicalPoint(event);

    switch (e.kind) {
        case 'downData':
            isPreparingClick = true;
            break;
        case 'exitData':
            if (isClicked || isPreparingClick) return;
            clearTimeout(hoverTimeout);
            leaveTimeout = setTimeout(() => {
                virtualNode.s('2d.visible', false);
            }, 1000);
            break;
        case 'clickData':
            if (event.button !== 0) return;
            isClicked = true;
            isPreparingClick = false;
            clearTimeout(hoverTimeout);
            clearTimeout(leaveTimeout);
            virtualNode.setPosition(point.x + 80, point.y + 80);
            virtualNode.s('2d.visible', true);
            let canshu = graphView.dm().getDataByTag('ByData');
            canshu.a('部分选中',rollnum);
            const Line = "H901";
            const url = 'http://180.10.10.12:9003/api/sdf/sltbusrolllinetrack/mousehover'
                      + '?Line=' + Line + '&RollPieceID=' + rollnum;
            requestGet(url)
                .then(json => {
                    const item = json?.Data?.[0];
                    if (item) {
                        setVirtualNodeProperty('ROLL_PLAN_NO', item.ROLL_PLAN_NO);
                        setVirtualNodeProperty('HEAT_NO', item.HEAT_NO);
                        setVirtualNodeProperty('SG_SIGN', item.SG_SIGN);
                        setVirtualNodeProperty('IN_MAT_LEN', item.IN_MAT_LEN);
                        setVirtualNodeProperty('TOTAL_MAT_NUM', item.TOTAL_MAT_NUM);
                        setVirtualNodeProperty('OUT_MAT_NO', item.OUT_MAT_NO);
                    } else {
                        console.error('返回数据不正确');
                    }
                })
                .catch(err => {
                    console.error('请求失败:', err);
                    virtualNode.s('2d.visible', false);
                    isClicked = false;
                });
            break;
    }
});

function handleRollChange(type) {
    var bydata = graphView.dm().getDataByTag('ByData');
    if(type === "1"){ bydata.a('datetext',"1"); }
    if(type === "2"){ bydata.a('datetext',"2"); }
    const data = graphView.sm().ld();
    if (!data) {
        alert("请先选择一个节点");
        return;
    }
    var rollchange = graphView.dm().getDataByTag('再次确认');
    if (!rollchange) {
        console.error("未找到标签为 '再次确认' 的数据项");
        alert("再次确认功能暂时不可用");
        return;
    }
    const point = data.getPosition();
    rollchange.setPosition(point.x - 100, point.y - 100);
    rollchange.s('2d.visible', true);
}

dm.getDatas().each(node => trySetDoubleClickHandlerForNode(node));
*/


/**
 * ============================================================
 *  实时曲线数据采集器 (DataCollector)
 * ============================================================
 *
 * 独立功能模块，负责从图纸节点属性采集实时数据并更新到图表。
 * 与钢坯运动模拟无关，可独立启停。
 *
 * 主要功能：
 *   1. 从指定节点属性获取实时数据（如 tip1, tip2, tip3...）
 *   2. 使用共享时间戳确保所有数据系列时间对齐
 *   3. 滑动时间窗口算法管理数据点（默认5分钟窗口，最多300点）
 *   4. 支持定时器的启动/停止控制
 *   5. 动态读取图表 ht.series 数量，自动匹配 propertyMap，无需硬编码系列数
 */
class DataCollector {
  constructor(graphView) {
    this.graphView = graphView;
    this.timer = null;           // 定时器句柄
    this.isRunning = false;      // 运行状态
    this.currentTimestamp = null; // 统一时间戳
    this.chartConfig = null;     // 图表配置（start时动态生成）

    // 图表基础定义（getNode + 属性前缀，不含硬编码的propertyMap）
    this.chartDefs = {
      'line':     { chartTag: 'line',     propertyPrefix: 'tip', getNode: () => this.graphView.dm().getDataByTag('line') },
      'date':     { chartTag: 'date',     propertyPrefix: 'tip', getNode: () => this.graphView.dm().getDataByTag('date') },
      'liuliang': { chartTag: 'liuliang', propertyPrefix: 'tip', getNode: () => this.graphView.dm().getDataByTag('liuliang') }
    };
  }

  /**
   * 根据图表节点实际的 ht.series 数量动态生成 propertyMap
   * propertyMap 结构：{ 'tip1': { dataArray, seriesIndex }, 'tip2': {...}, ... }
   * 有多少条系列就生成多少个条目，不再硬编码
   */
  buildChartConfig() {
    var config = {};
    var self = this;

    Object.values(this.chartDefs).forEach(function (def) {
      var node = def.getNode();
      var propertyMap = {};

      if (node) {
        var series = node.a('ht.series');
        var count = (series && Array.isArray(series)) ? series.length : 0;

        for (var i = 0; i < count; i++) {
          var propName = def.propertyPrefix + (i + 1);  // tip1, tip2, ...
          propertyMap[propName] = { dataArray: [], seriesIndex: i };
        }

        console.log('[DataCollector]', def.chartTag, '图表系列数=' + count, '属性数=' + Object.keys(propertyMap).length);
      }

      config[def.chartTag] = {
        chartTag: def.chartTag,
        propertyMap: propertyMap,
        getNode: def.getNode
      };
    });

    this.chartConfig = config;
  }

  /**
   * 为所有图表节点开启 Tooltip 提示
   *
   * HT 图表 Tooltip 配置要点：
   *   - ht.seriesTipEnabled=true      开启 tooltip
   *   - ht.seriesTipTemplate          自定义 tooltip 内容（支持 HTML 字符串或函数）
   *   - 函数参数 pointInfo 包含: { series, seriesIndex, pointIndex, x, value, point }
   *
   * 可在 tooltip 中展示：
   *   1. 当前值 (pointInfo.value)
   *   2. 时间 (new Date(pointInfo.x).toLocaleTimeString())
   *   3. 系列名称 (pointInfo.series)
   *   4. 统计信息（最新值、最大值、最小值等）
   *   5. 自定义附加信息（单位、报警阈值等）
   */
  setupChartTooltips() {
    var self = this;

    Object.values(this.chartConfig).forEach(function (chart) {
      var node = chart.getNode();
      if (!node) return;

      // ===== 开启 tooltip =====
      node.a('ht.seriesTipEnabled', true);

      // ===== 自定义 tooltip 模板（函数模式，支持显示附加信息）=====
      node.a('ht.seriesTipTemplate', function (pointInfo) {
        // ---- 基础信息 ----
        var timeStr = new Date(pointInfo.x).toLocaleTimeString('zh-CN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        // ---- 附加信息：从 DataCollector 中获取该系列的实时最新值 ----
        var extraInfo = '';
        var props = Object.keys(chart.propertyMap);
        // 通过 seriesIndex 找到对应的属性名（tipN）
        var matchedProp = null;
        for (var i = 0; i < props.length; i++) {
          if (chart.propertyMap[props[i]].seriesIndex === pointInfo.seriesIndex) {
            matchedProp = props[i];
            break;
          }
        }
        if (matchedProp) {
          var dataArr = chart.propertyMap[matchedProp].dataArray;
          if (dataArr && dataArr.length > 0) {
            var latestVal = dataArr[dataArr.length - 1][1];  // 最新值
            var maxVal = Math.max.apply(null, dataArr.map(function (d) { return d[1]; }));
            var minVal = Math.min.apply(null, dataArr.map(function (d) { return d[1]; }));
            extraInfo =
              '<div style="font-size:11px;color:#aaa;margin-top:4px;">' +
              '最新值: ' + (typeof latestVal === 'number' ? latestVal.toFixed(2) : latestVal) + '<br>' +
              '最大: ' + (typeof maxVal === 'number' ? maxVal.toFixed(2) : maxVal) +
              ' / 最小: ' + (typeof minVal === 'number' ? minVal.toFixed(2) : minVal) +
              '</div>';
          }
        }

        // ---- 组装 tooltip HTML ----
        return (
          '<div style="font-size:13px;line-height:1.6;">' +
          '<b>' + pointInfo.series + '</b><br>' +
          '时间: ' + timeStr + '<br>' +
          '当前值: <b style="color:#1e90ff;">' +
          (typeof pointInfo.value === 'number' ? pointInfo.value.toFixed(2) : pointInfo.value) +
          '</b>' +
          extraInfo +
          '</div>'
        );
      });
    });

    console.log('[DataCollector] 图表 Tooltip 已开启（含附加信息：最新值/最大/最小）');
  }

  /**
   * 启动数据采集
   */
  start() {
    if (this.isRunning) {
      console.warn('[DataCollector] 已在运行中，无需重复启动');
      return;
    }

    // 动态生成配置（根据图纸实际的图表系列数）
    this.buildChartConfig();
    if (!this.chartConfig || Object.keys(this.chartConfig).length === 0) {
      console.error('[DataCollector] 图表配置为空，无法启动');
      return;
    }
    
    this.isRunning = true;
    console.log('[DataCollector] 启动数据采集，频率: 1秒/次');
    
    this.timer = setInterval(() => {
      this.currentTimestamp = Date.now(); // 记录统一时间戳
      try {
        this.updateAllCharts();
      } catch (error) {
        console.error('[DataCollector] 更新图表时出错:', error);
      }
    }, 1000);
  }

  /**
   * 停止数据采集并释放资源
   */
  stop() {
    if (!this.isRunning) return;
    
    clearInterval(this.timer);
    this.timer = null;
    this.isRunning = false;
    console.log('[DataCollector] 已停止数据采集');
  }

  /**
   * 从图表节点获取指定属性值并确保为数值类型
   * @param {object} chart - 图表配置
   * @param {string} propName - 属性名称
   * @returns {number} - 转换后的数值类型，无效值返回0
   */
  fetchDiamValue(chart, propName) {
    const chartNode = chart.getNode();
    if (!chartNode) {
      console.warn(`[DataCollector] 找不到图表节点: ${chart.chartTag}`);
      return 0;
    }
    
    const rawValue = chartNode.a(propName);
    
    // 处理特殊值
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      return 0;
    }
    
    // 处理布尔值
    if (typeof rawValue === 'boolean') {
      return rawValue ? 1 : 0;
    }
    
    // 处理字符串
    if (typeof rawValue === 'string') {
      const parsed = parseFloat(rawValue);
      if (!isNaN(parsed)) {
        return rawValue.endsWith('%') ? parsed / 100 : parsed;
      }
      console.warn(`[DataCollector] 无法解析属性 ${propName} 的值: "${rawValue}"`);
      return 0;
    }
    
    // 处理数值类型
    if (typeof rawValue === 'number') {
      return isFinite(rawValue) ? rawValue : 0;
    }
    
    // 处理对象类型
    if (typeof rawValue === 'object' && rawValue !== null) {
      if (rawValue.value !== undefined) {
        return this.fetchDiamValue(chart, rawValue.value);
      }
      console.warn(`[DataCollector] 不支持的对象类型属性 ${propName}:`, rawValue);
      return 0;
    }
    
    console.warn(`[DataCollector] 未知类型的属性 ${propName}: ${typeof rawValue}`);
    return 0;
  }

  /**
   * 更新所有图表的数据
   */
  updateAllCharts() {
    const timestamp = this.currentTimestamp;
    
    Object.values(this.chartConfig).forEach(chart => {
      const chartNode = chart.getNode();
      if (!chartNode) return;
      
      const series = chartNode.a('ht.series');
      if (!series || !Array.isArray(series)) {
        console.error(`[DataCollector] 图表 ${chart.chartTag} 系列数据异常`);
        return;
      }
      
      // 批量更新数据（使用统一时间戳）
      Object.entries(chart.propertyMap).forEach(([propName, propConfig]) => {
        const newValue = this.fetchDiamValue(chart, propName);
        
        // 使用共享时间戳更新数据
        propConfig.dataArray = this.updateTimeSeriesWithSharedTimestamp(
          propConfig.dataArray,
          timestamp,
          newValue
        );
        
        // 检查系列索引有效性
        if (propConfig.seriesIndex >= series.length) {
          console.error(`[DataCollector] 系列索引越界: ${propConfig.seriesIndex} (最大值: ${series.length-1})`);
          return;
        }
        
        // 更新图表数据（创建新数组确保引用变化）
        series[propConfig.seriesIndex].data = [...propConfig.dataArray];
      });
      
      // 强制触发图表重绘
      chartNode.invalidate();
    });
  }

  /**
   * 使用共享时间戳更新时间序列数据
   * @param {Array} seriesData - 数据数组 [ [时间戳1, 值1], [时间戳2, 值2], ... ]
   * @param {number} timestamp - 共享时间戳
   * @param {number} value - 数据值
   * @param {number} timeWindowMs - 时间窗口大小（毫秒）
   * @param {number} maxPoints - 最大数据点数
   * @returns {Array} 更新后的数据数组
   */
  updateTimeSeriesWithSharedTimestamp(seriesData, timestamp, value, timeWindowMs = 5 * 60 * 1000, maxPoints = 300) {
    // 添加新数据点（使用统一时间戳）
    seriesData.push([timestamp, value]);
    
    // 清理过期数据
    const cutoff = timestamp - timeWindowMs;
    let i = 0;
    
    while (i < seriesData.length && seriesData[i][0] < cutoff) {
      i++;
    }
    
    if (i > 0) {
      seriesData.splice(0, i); // 删除过期数据
    }
    
    // 限制最大数据点数
    if (seriesData.length > maxPoints) {
      seriesData.splice(0, seriesData.length - maxPoints);
    }
    
    return seriesData;
  }
}

// 启动数据采集器
// 防重复实例化：脚本被页面/图纸重复加载时，先停掉上一个采集器实例再建新的，
// 避免多个 1 秒定时器同时往同一批图表节点写数据（图表抖动、时间序列重复）。
// 注：DataCollector.start() 内的 this.isRunning 守卫只能防同一实例重复启动，管不到跨实例。
if (window.__dataCollector) {
    window.__dataCollector.stop();
}
const dataCollector = window.__dataCollector = new DataCollector(graphView);
dataCollector.start(); // 启动数据采集

// 当不再需要时停止
// dataCollector.stop();

//获取班组班次信息
var shiftGroupMap = { A: '一', B: '二', C: '三', D: '四' };
var shiftNoMap = { '1': '夜', '2': '白' };
request("https://bar.dayesteel.com.cn/api/api/bdy/bptbuscommon/getcurrentshiftinfo", {}, 'POST')
    .then(data => {
        var teamNode = graphView.dm().getDataByTag('Team');
        var shiftNode = graphView.dm().getDataByTag('Shift');
        if (data && data.Data) {
            if (teamNode) teamNode.s('text', shiftGroupMap[data.Data.ShiftGroup] || data.Data.ShiftGroup);
            if (shiftNode) shiftNode.s('text', shiftNoMap[data.Data.ShiftNo] || data.Data.ShiftNo);
        }
    });

//获取最近十卡
request("https://bar.dayesteel.com.cn/api/api/bdy/bptdatrollopact/list", {
    "PageSize": 20,
    "PageIndex": 1,
    "SortFields": [
        {
            "Field": "RollingStartTime",
            "Direct": 1
        }
    ],
    "FilterFields": [
        {
            "field": "ProductLine",
            "oper": "in",
            "data": "H9"
        }
    ],
    "Kw": ""
}, "POST", "json", false)
    .then(data => {
        var list = data.Data || data.list || data.rows || [];  // bptdatrollopact 返回大写 Data
        console.log('最近十卡:', list);

        // ★ 注入 tenCardNo 折线图
        updateTenCardNoChart(list);
    })
    .catch(err => {
        console.error('获取最近十卡失败:', err);
    });

/**
 * 将最近十卡数据渲染到 tenCardNo 折线图
 * @param {Array} cardList - 接口返回的数据列表
 *
 * 图表结构:
 *   X轴 = 卡号（CardNo）
 *   Y轴 = 轧制时长（RollDuration，单位分钟）
 */
function updateTenCardNoChart(cardList) {
    var chartNode = graphView.dm().getDataByTag('tenCardNo');
    if (!chartNode) {
        console.warn('[最近十卡] 未找到 tenCardNo 图表节点');
        return;
    }

    // ===== 1. 构建数据模型（X轴值 + 系列值 + 附加信息）=====
    var dataModel = new ht.DataModel();
    cardList.forEach(function(item) {
        var d = new ht.Data();
        d.a({
            cardNo: item.CardNo,                                // 卡号（X轴）
            duration: item.RollingDuration,                     // 轧制时长(分钟)
            startTime: item.RollingStartTime,                   // 开始时间
            heatNo: item.HeatNo,                                // 炉号（tooltip附加）
            steelGrade: item.SteelGrade                         // 钢种（tooltip附加）
        });
        dataModel.add(d);
    });

    // ===== 2. 设置X轴绑定字段 =====
    var xAxisList = chartNode.a('xAxisList');
    if (xAxisList && xAxisList.length > 0) {
        xAxisList[0].name = 'cardNo';   // X轴显示卡号
    }

    // ===== 3. 构建系列模型（一条折线：轧制时长）=====
    var seriesModel = new ht.DataModel();

    var seriesLine = new ht.Data();
    seriesLine.setName('duration');
    seriesLine.setDisplayName('轧制时长(分)');
    seriesLine.s('type', 'line');
    seriesLine.s('smooth', 0.3);         // 平滑曲线
    seriesModel.add(seriesLine);

    // ===== 4. 配置 Tooltip 附加信息（炉号、钢种）=====
    var toolTipOption = chartNode.a('toolTipOption') || {};
    toolTipOption.getOption = function(info, data, view) {
        // info.content 结构: [{ title, items: [['颜色','系列名',值,'单位','图标']] }]
        var content = info.content;
        if (content && content.length > 0) {
            var group = content[0];
            // 追加附加信息行
            group.items.push(
                ['#888', '炉号', data.a('heatNo'), '', null],
                ['#888', '钢种', data.a('steelGrade'), '', null]
            );
        }
        return info.option;
    };
    chartNode.a('toolTipOption', toolTipOption);

    // ===== 5. 绑定数据到图表节点 =====
    chartNode.a({
        dataModel: dataModel,
        seriesModel: seriesModel
    });

    console.log('[最近十卡] tenCardNo 图表已更新，数据量=' + cardList.length);
}

//获取最近十卡
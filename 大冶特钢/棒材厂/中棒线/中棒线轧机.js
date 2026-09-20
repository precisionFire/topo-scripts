/**
 * ============================================================
 *  中棒线轧机 - 钢坯运动模拟与可视化
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
 *   - 产线：中棒线（产线编码 B1）
 *   - 缓存仓库 key 前缀：B1_（localStorage，详见「数据仓库层」）
 *   - 本文件为中棒线主版本（独立编写），大棒/扁棒参考此结构
 *
 * 【中棒线适配说明（后续开发必读）】
 *   本文件为中棒线源头/主版本，无"从中棒复制"产生的适配项；但保留以下结构（与大棒线头部对齐，便于跨产线阅读）：
 *   1. 轨道/分区/热检坐标、速度、集合点等常量按中棒现场图纸核对
 *      （getYTrack / MILL_ZONES / SPEED_CONFIG / PHYSICAL_ORDER /
 *        applyProcessConstraints 内的热检位置等）。
 *   2. 无源产线专有字面量需替换（"B101"等如发现遗留字面量需替换为中棒真实值）。
 *   3. 初始化段中 trySetDoubleClickHandlerForNode 为外部全局函数，本文件未定义；
 *      文件末尾的注释块内有该调用，可按需启用。
 *   4. 「右键菜单逻辑」「左键弹窗逻辑」两段代码当前整体注释未启用。
 *
 * 【外部依赖】
 *   - graphView : HT for Web 图形视图实例（全局注入）
 *   - dm        : graphView.dm() 数据模型
 *   - request / requestGet : 全局 HTTP 请求函数
 *
 * 【版本记录】
 *   v1.0  2026-09-15  头部注释补充【产线信息】【外部依赖】【版本记录】3 块
 *                     （参考大棒线轧机.js 头部结构对齐）；
 *                     同日 7 个 apply* 函数加【中棒独有】标识
 *
 * @file       中棒线轧机.js
 * @requires   graphView (HT GraphView 全局对象)
 * @requires   dataModel (HT DataModel 全局对象)
 *
 * 【插件归属说明】（2026-09-15）
 *   本文件中标注【中棒独有】的 7 个 apply* 函数为中棒线工艺专属逻辑，
 *   其它产线（扁棒/大棒/小棒）不需要，请勿复制。
 *   大棒线轧机.js 已于 2026-09-15 v1.1 删除（从中棒复制时的残留）。
 * ============================================================
 */

// ===== 初始化：获取 GraphView 和数据模型 =====
var view = graphView.getView();
var dm = graphView.dm();
//滚动条不可见（轧线图形采用自动布局，不需要滚动条）
graphView.setScrollBarVisible(false);

/**
 * ===== 轨道Y坐标基准点 =====
 * 轧线分为3条平行的可视化轨道，每条有自己的 Y 基准位置。
 * 这些基准点来自图纸上预置的 roll-y1/roll-y2/roll-y3 节点，
 * 运行时通过 getYTrack(index) 动态获取，确保布局变化后仍准确。
 */
var rolly1 = dm.getDataByTag('roll-y1');
var rolly2 = dm.getDataByTag('roll-y2');
var rolly3 = dm.getDataByTag('roll-y3');

// ✅ 使用函数动态获取 Y 坐标（而非缓存固定值，保证布局变更后同步）
function getYTrack(index) {
    var node;
    switch (index) {
        case 0: node = rolly1; break;
        case 1: node = rolly2; break;
        case 2: node = rolly3; break;
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
    'track-1-DescalerBeforeHmd',
    'track-1-PinchRollBeforeHmd',
    'millstate1',
    'track-1-Stand2EntryHmd',
    'millstate2',
    'millstate3',
    'track-1-Stand4EntryHmd',
    'millstate4',
    'millstate5',
    'track-1-Stand6EntryHmd',
    'millstate6',
    'track-1-RollTable6AEntryHmd',
    'track-1-RollTable6BEntryHmd',
    'track-1-No1ShearBeforeHmd',
    'track-1-Stand7EntryHmd',
    'millstate7',
    'millstate8',
    'track-1-Stand9EntryHmd',
    'millstate9',
    'millstate10',
    'millstate11',
    'track-1-Stand12EntryHmd',
    'millstate12',
    'track-1-No2ShearEntryHmd',
    'track-1-Stand13EntryHmd',
    'millstate13',
    'millstate14',
    'track-1-Stand15EntryHmd',
    'millstate15',
    'millstate16',
    'track-1-Stand16ExitHmd',
    'track-2-No3ShearEntryHmd',
    'track-2-No3ShearExitHmd',
    'track-2-Stand17EntryHmd',
    'millstate17',
    'millstate18',
    'millstate19',
    'millstate20',
    'track-3-No4WaterTankEntryHmd',
    'track-3-No4ShearBeforeHmd',
    'track-3-No4ShearExitHmd',
    'track-3-BslHmd'
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
PHYSICAL_ORDER.forEach(tag => {
    var x = rawPositions[tag];
    if (x === undefined) return;  // 图纸上不存在的节点跳过

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

/**
 * ===== 轨道配置与渲染状态 =====
 * - segmentLength : 单条轨道的X坐标跨度（1800单位）
 * - allSteelLines : inMatNo → [track0_shape, track1_shape, track2_shape]  每条钢坯对应3个轨道Shape
 * - lastPositions : inMatNo → {headX, tailX, len}  上次渲染位置，用于判是否需要动画
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

// 修磨停顿追踪（声明提前，applyCollectionPointControl 第1547行会引用）
var steelPauseTracker = {};

// ---- 以下 tracker 声明提前，cleanupSteelTrackers 在启动重建/removeSteelFromState 中引用 ----
var steelCollectionTracker = {};
var headBlockedState = {};
var steelLengthLockTracker = {};
var steelHeadBlockTracker = {};
var steelTailJumpTracker = {};
var steelTailJump3350Tracker = {};
var steelTailJump3100Tracker = {};

// COLLECTION_POINT_LENGTHS 已删除，改用 applyProcessConstraints 工艺约束规则

// 离线检查点列表（声明提前，isSteelFinished → cleanupFinishedSteels 在启动重建时引用）
// 尾位置经过这些热检后视同离线
var OFFLINE_HMD_LIST = [
    'No4WaterTankEntryHmd',
    'No4ShearBeforeHmd',
    'No4ShearExitHmd',
    'BslHmd'
];

/**
 * ===== 渲染层：钢坯 Shape 创建与显示 =====
 *
 * 每条钢坯由 3 个 polyline Shape 组成（对应3条轨道），
 * 当钢坯跨越轨道边界时，每个轨道的 Shape 只显示属于该轨道的片段。
 * 钢坯纹理通过 shape.repeat.image 平铺实现。
 */

// ===== 工具函数：创建钢条 shape =====
// 为一条钢坯创建3个轨道 Shape，初始为空（暂无坐标点）
function createSteelLineShapes(steel) {
    const lineShapes = [];

    for (let i = 0; i < 3; i++) {
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
 * 更新钢坯在3条轨道上的显示
 *
 * 核心算法（跨轨裁剪）：
 *   钢坯在全局坐标系中是一个连续的区间 [leftX, rightX]，
 *   每条轨道的可见范围是 [trackStart, trackEnd]，
 *   取两者交集 [visibleStart, visibleEnd]，
 *   然后转换为轨道的相对坐标再设置 polyline 的点位。
 *
 * @param {string} rollnum - 钢坯号 (inMatNo)
 * @param {number} headX   - 钢头全局X坐标
 * @param {number} tailX   - 钢尾全局X坐标
 */
function updateSteelLines(rollnum, headX, tailX) {
    const lineShapes = allSteelLines[rollnum];
    if (!lineShapes) return;

    // 统一用 left/right 语义，不关心 head/tail 的先后顺序
    const leftX = Math.min(headX, tailX);
    const rightX = Math.max(headX, tailX);

    for (let i = 0; i < 3; i++) {
        const trackStart = i * segmentLength;        // 当前轨道起始X
        const trackEnd = trackStart + segmentLength; // 当前轨道结束X
        const y = getYTrack(i);

        // 取钢坯区间与轨道区间的交集
        const visibleStart = Math.max(leftX, trackStart);
        const visibleEnd = Math.min(rightX, trackEnd);

        if (visibleStart < visibleEnd) {
            // 转换为轨道相对坐标（每条轨道的原点在 trackStart）
            const relativeStartX = visibleStart - trackStart;
            const relativeEndX = visibleEnd - trackStart;

            // polyline 需要2个端点定义一条水平线段
            lineShapes[i].setPoints([
                {
                    x: relativeStartX,
                    y: y
                },
                {
                    x: relativeEndX,
                    y: y
                }
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
function animateSteelLine(rollnum, fromHeadX, fromTailX, fromLen, toHeadX, toTailX, toLen) {
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
        const currentHeadX = fromHeadX + (toHeadX - fromHeadX) * t;
        const currentTailX = fromTailX + (toTailX - fromTailX) * t;

        updateSteelLines(rollnum, currentHeadX, currentTailX);

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
            steel.headX,
            steel.tailX
        );

        lastPositions[
            rollnum
        ] = {

            headX:
                steel.headX,

            tailX:
                steel.tailX,

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
        steel.tailX <
        last.tailX
    ) {

        updateSteelLines(
            rollnum,
            steel.headX,
            steel.tailX
        );

    } else {

        // 分支3：正常前进，平滑动画
        animateSteelLine(
            rollnum,

            last.headX,
            last.tailX,
            last.len,

            steel.headX,
            steel.tailX,
            steel.length
        );
    }

    // 记录本次位置，供下次比较
    lastPositions[
        rollnum
    ] = {

        headX:
            steel.headX,

        tailX:
            steel.tailX,

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
        const cache = localStorage.getItem('B1_SteelFactStore');

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
            'B1_SteelFactStore',
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
        const cache = localStorage.getItem('B1_SteelStateStore');

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
            'B1_SteelStateStore',
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
        const cache = localStorage.getItem('B1_RenderCacheStore');
        if (!cache) return;
        try {
            this.data = JSON.parse(cache);
            console.log('[RenderCacheStore] 恢复成功，钢坯数:', Object.keys(this.data).length);
        } catch (err) {
            console.error('[RenderCacheStore] 恢复失败', err);
        }
    },

    save() {
        localStorage.setItem('B1_RenderCacheStore', JSON.stringify(this.data));
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
        const cache = localStorage.getItem('B1_HmdPassStore');
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
        localStorage.setItem('B1_HmdPassStore', JSON.stringify(this.data));
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
            x: TRACK_POSITION_MAP.get(position) || 0  // 将热检名称转为X坐标记录
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
    { name: 'ROLL1',    start: 0,    end: 320  },
    { name: 'ROUGH',    start: 320,  end: 630  },
    { name: 'ROLL2',    start: 630,  end: 1100 },
    { name: 'MIDDLE',   start: 1100, end: 1500 },
    { name: 'ROLL3',    start: 1500, end: 1600 },
    { name: 'PREFINISH',start: 1600, end: 1800 },
    { name: 'ROLL4',    start: 1800, end: 3380 },
    { name: 'FINISH',   start: 3380, end: 3550 },
    { name: 'ROLL5',    start: 3550, end: 5400 }
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
        var tailHmdX = TRACK_POSITION_MAP.get(tailPos);
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
        var hmdX = TRACK_POSITION_MAP.get(item.headPosition);
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
        var hmdX = TRACK_POSITION_MAP.get(item.tailPosition);
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

    // 统一清理该钢坯在所有插件中的追踪数据
    cleanupSteelTrackers(inMatNo);

    SteelStateStore.save();
}

/**
 * 统一清理钢坯在所有插件 tracker 中的追踪数据
 *
 * 替代原来分散在5个插件函数末尾的独立清理代码：
 *   steelCollectionTracker, headBlockedState, steelLengthLockTracker,
 *   steelHeadBlockTracker, steelTailJumpTracker, steelPauseTracker
 *
 * 在 removeSteelFromState 中调用，确保钢坯下线时一次性清理所有 tracker。
 * 新增 tracker 只需在此函数中添加一行 delete 即可。
 */
function cleanupSteelTrackers(inMatNo) {
    delete steelCollectionTracker[inMatNo];
    delete headBlockedState[inMatNo];
    delete steelLengthLockTracker[inMatNo];
    delete steelHeadBlockTracker[inMatNo];
    delete steelTailJumpTracker[inMatNo];
    delete steelTailJump3350Tracker[inMatNo];
    delete steelTailJump3100Tracker[inMatNo];
    delete steelPauseTracker[inMatNo];
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
 * 求解流程（每帧执行，12步流水线，后者可覆盖前者的速度/位置值）：
 *    1  updateSteelPhase()            → 根据位置判定钢坯阶段
 *    2  updateSteelSpeed()            → 根据阶段查表获取头/尾速度
 *    3  applySteelPauseAt1100()       → 1#剪修磨停顿10秒        【中棒独有】
 *    4  applyCollectionPointControl() → 集合点信号控制头尾进退
 *    5  applyLengthLockAt620()        → 尾到620时固定长度150    【中棒独有】
 *    6  applyHeadBlockAt1000()        → 头到1000后检查区间阻塞  【中棒独有】
 *    7  applyTailJumpAt1750()         → 头过1750时尾跳到下一集合点前50  【中棒独有】
 *    8  applyTailJumpAt3100()         → 头过3100时尾跳到下一集合点前50  【中棒独有】
 *    9  applyTailJumpAt3350()         → 头过3350时尾跳到2100    【中棒独有】
 *   10  applyTailSpeedAtStand16ExitHmd()  → 尾到Stand16ExitHmd时尾速设为10  【中棒独有】
 *   11  updateSteelPosition()         → 速度×dt累加到位置（含尾部信号安全网）
 *   12  isSteelFinished()             → 离线判断
 *
 * 注意：步骤 3 / 5~10 共 7 个 apply* 函数均为中棒线工艺专属逻辑。
 *       扁棒/大棒线轧机不应引入这些函数；大棒线轧机.js 已于 2026-09-15 v1.1 删除（从中棒复制时的残留）。
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
 * 获取集合点信号值
 * 优先读取 a('rolledState')，其次读取 a('有钢信号')，默认返回 0
 * @returns {number} 1=有钢, 0=无钢
 */
function getCollectionSignal(tag) {
    var node = getCollectionNode(tag);
    if (!node) return 0;

    var signal = node.a('rolledState');
    if (signal !== undefined && signal !== null) return Number(signal);

    signal = node.a('有钢信号');
    if (signal !== undefined && signal !== null) return Number(signal);

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

    // millstate需要检查运行状态
    var node = getCollectionNode(tag);
    if (!node) return false;

    var running = node.a('runningState');
    if (running !== undefined && running !== null && Number(running) !== 1) {
        return false;  // 轧机未运行，不作为集合点参与判断
    }
    return true;
}

/**
 * 获取头位置下一个即将经过的集合点
 * 在 All_POSITION_MAP 中按物理顺序查找第一个 X > headX 的活跃集合点
 */
function getNextCollectionPoint(headX) {
    var result = null;
    var iterator = All_POSITION_MAP.entries();
    var entry;
    while ((entry = iterator.next()) && !entry.done) {
        var tag = entry.value[0];
        var x = entry.value[1];
        if (x > headX && isActiveCollectionPoint(tag)) {
            result = { tag: tag, x: x };
            break;
        }
    }
    return result;
}

/**
 * 获取头位置上一次经过的最后一个集合点（X <= headX 且 X 最大者）
 */
function getLastPassedPoint(headX) {
    var result = null;
    var maxX = -Infinity;
    All_POSITION_MAP.forEach(function (x, tag) {
        if (x <= headX && x > maxX && isActiveCollectionPoint(tag)) {
            result = { tag: tag, x: x };
            maxX = x;
        }
    });
    return result;
}

/**
 * 获取尾位置下一个需要经过的集合点
 * 在 All_POSITION_MAP 中查找第一个 X > tailX 的集合点
 */
function getTailNextPoint(tailX) {
    var result = null;
    var iterator = All_POSITION_MAP.entries();
    var entry;
    while ((entry = iterator.next()) && !entry.done) {
        var tag = entry.value[0];
        var x = entry.value[1];
        if (x > tailX && isActiveCollectionPoint(tag)) {
            result = { tag: tag, x: x };
            break;
        }
    }
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
            console.log(
                '[集合控制·头受阻]', steel.inMatNo,
                '| 头位置=' + steel.headX.toFixed(1),
                '| 受阻于', next.tag + '(x=' + next.x + ')',
                '| 原因: 信号=' + signal + '→无钢'
            );
        }

        headBlockedState[steel.inMatNo] = { tag: next.tag };

        // 受阻解除时清理（当 headX 超过该集合点时视为解除）
        if (prevBlocked && steel.headX > next.x) {
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

    // 修磨停顿期间跳过集合点控制，防止尾速度覆盖停顿（P4优先级高于P5）
    if (steelPauseTracker[key] && steelPauseTracker[key].paused) {
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
    if (proposedHeadX <= steel.headX) return proposedHeadX;

    var clippedX = proposedHeadX;

    // 遍历 currentHeadX → proposedHeadX 之间的集合点（按物理顺序）
    var iterator = All_POSITION_MAP.entries();
    var entry;
    while ((entry = iterator.next()) && !entry.done) {
        var tag = entry.value[0];
        var x = entry.value[1];

        // 跳过当前头位置之前的点
        if (x <= steel.headX) continue;
        // 超出目标范围，不再检查
        if (x > proposedHeadX) break;

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
    if (proposedTailX <= steel.tailX) return proposedTailX;

    var clippedX = proposedTailX;

    // 遍历 currentTailX → proposedTailX 之间的集合点
    var iterator = All_POSITION_MAP.entries();
    var entry;
    while ((entry = iterator.next()) && !entry.done) {
        var tag = entry.value[0];
        var x = entry.value[1];

        // 跳过未运行的轧机
        if (!isActiveCollectionPoint(tag)) continue;

        // 跳过当前尾位置之前的点
        if (x <= steel.tailX) continue;
        // 超出目标范围
        if (x > proposedTailX) break;

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

/**
 * ===== 插件：尾位置到620时长度固定为180，头位置到1200时解除（独立函数） =====
 * 【中棒独有】此函数是中棒线工艺专属逻辑，其他产线（扁棒/大棒）不要复制引入。
 *
 * 当钢坯尾位置到达620时，将钢坯长度强制固定为180，
 * 即尾位置 = 头位置 - 180（最小为0）。
 * 当钢坯头位置到达1200时，长度控制解除，恢复正常运动。
 *
 * 独立函数，可随时移除不影响其他逻辑。
 * （steelLengthLockTracker 声明已提前至文件前部）
 */

function applyLengthLockAt620(steel) {
    const TAIL_TRIGGER = 620;
    const HEAD_RELEASE = 1200;
    const FIXED_LENGTH = 150;

    var key = steel.inMatNo;

    if (!steelLengthLockTracker[key]) {
        steelLengthLockTracker[key] = {
            locked: false,
            lockApplied: false
        };
    }

    var tracker = steelLengthLockTracker[key];

    // 当尾位置到达620时，触发长度固定
    if (!tracker.locked && !tracker.lockApplied && steel.tailX >= TAIL_TRIGGER) {
        tracker.locked = true;
        console.log('[长度锁定]', steel.inMatNo, '尾位置到达620，长度固定为150');
    }

    // 长度固定期间：强制尾位置 = 头位置 - 150（受集合点信号约束）
    if (tracker.locked) {
        var targetTailX = Math.max(0, steel.headX - FIXED_LENGTH);

        // 逐点检查 tailX→targetTailX 之间是否有信号≠0的集合点
        // 不能用 clipTailBySignals（其早退逻辑 target≤tailX 会导致逐帧漂过约束点）
        var blockedPoint = null;
        var iterator = All_POSITION_MAP.entries();
        var entry;
        while ((entry = iterator.next()) && !entry.done) {
            var tag = entry.value[0];
            var x = entry.value[1];
            if (x <= steel.tailX) continue;          // 跳过当前位置之前的点
            if (x > targetTailX) break;               // 超出目标范围
            if (!isActiveCollectionPoint(tag)) continue;
            if (x > steel.headX) { blockedPoint = x; break; }  // 头未经过
            var signal = getCollectionSignal(tag);
            if (signal !== 0) { blockedPoint = x; break; }     // 该点有钢
        }

        if (blockedPoint !== null) {
            steel.tailX = blockedPoint;   // 卡在阻塞的集合点
            steel.tailSpeed = 0;          // 尾不可前进
        } else {
            steel.tailX = targetTailX;
            steel.tailSpeed = steel.headSpeed;
        }
    }

    // 当头位置到达1200时，解除长度固定
    if (tracker.locked && steel.headX >= HEAD_RELEASE) {
        tracker.locked = false;
        tracker.lockApplied = true;
        console.log('[长度锁定]', steel.inMatNo, '头位置到达1200，长度控制解除');
    }

}

/**
 * ===== 插件：头位置到达1000后，若有其他钢坯尾在1050-1450则阻塞（独立函数） =====
 * 【中棒独有】此函数是中棒线工艺专属逻辑，其他产线（扁棒/大棒）不要复制引入。
 *
 * 当钢坯头位置到达1000后，检查所有其他在线钢坯。
 * 如果存在任意其他钢坯的尾位置在1050-1450之间，
 * 则当前钢坯头尾均不允许前进（speed设为0）。
 * 直到区间内无其他钢坯尾部时，恢复正常运动。
 *
 * 独立函数，可随时移除不影响其他逻辑。
 * （steelHeadBlockTracker 声明已提前至文件前部）
 */

function applyHeadBlockAt1000(steel) {
    const HEAD_BLOCK_POS = 1000;
    const BLOCK_TAIL_MIN = 1050;
    const BLOCK_TAIL_MAX = 1450;

    var key = steel.inMatNo;

    if (!steelHeadBlockTracker[key]) {
        steelHeadBlockTracker[key] = {
            triggered: false,
            blocked: false
        };
    }

    var tracker = steelHeadBlockTracker[key];

    // 检测头是否到达1000
    if (!tracker.triggered && steel.headX >= HEAD_BLOCK_POS) {
        tracker.triggered = true;
        console.log('[头阻塞检查]', steel.inMatNo, '头位置到达1000，开始检查其他钢坯身体是否在1050-1450区间');
    }

    // 头已到达1000，检查是否有其他钢坯的身体（tailX~headX）与1050-1450区间重叠
    if (tracker.triggered) {
        var shouldBlock = false;
        var blockingSteel = null;

        Object.values(SteelStateStore.data).forEach(function (other) {
            if (other.inMatNo === key) return;
            // 钢坯身体区间 [tailX, headX] 与阻塞区间 [1050, 1450] 是否重叠
            // 重叠条件：other.headX > 1050 且 other.tailX < 1450
            if (other.headX > BLOCK_TAIL_MIN && other.tailX < BLOCK_TAIL_MAX) {
                shouldBlock = true;
                blockingSteel = other.inMatNo;
            }
        });

        if (shouldBlock && !tracker.blocked) {
            tracker.blocked = true;
            console.log('[头阻塞]', steel.inMatNo, '头到达1000，被钢坯', blockingSteel, '身体阻塞（区间1050-1450有钢坯），不允许前进');
        }

        if (!shouldBlock && tracker.blocked) {
            tracker.blocked = false;
            console.log('[头阻塞解除]', steel.inMatNo, '1050-1450区间无其他钢坯身体，恢复前进');
        }

        if (tracker.blocked) {
            steel.headSpeed = 0;
            steel.tailSpeed = 0;
        }
    }
}

/**
 * ===== 插件：尾位置到达Stand16ExitHmd时尾速设为10 =====
 * 【中棒独有】此函数是中棒线工艺专属逻辑，其他产线（扁棒/大棒）不要复制引入。
 *
 * 当钢坯尾位置到达精轧入口（Stand16ExitHmd）后，
 * 距离下一个热检距离太远，尾部以速度10向前移动，
 * 避免尾部长时间停在无信号区域导致画面显示异常。
 *
 * 独立函数，可随时移除不影响其他逻辑。
 */
function applyTailSpeedAtStand16ExitHmd(steel) {
    const TRIGGER_X = TRACK_POSITION_MAP.get('Stand16ExitHmd');
    const TAIL_SPEED = 10;

    if (TRIGGER_X !== undefined && steel.tailX >= TRIGGER_X) {
        // 直接设置尾速，信号约束由 updateSteelPosition 安全网负责
        steel.tailSpeed = TAIL_SPEED;
    }
}

/**
 * ===== 插件：头越过1750时尾跳至下一集合点前50（独立函数） =====
 * 【中棒独有】此函数是中棒线工艺专属逻辑，其他产线（扁棒/大棒）不要复制引入。
 *
 * 当钢坯头位置跨过1750后，尾位置立刻跳到下一个要离开的集合点之前50的位置，
 * 使尾部快速追近头部，避免钢坯视觉长度无限拉长。
 *
 * 独立函数，可随时移除不影响其他逻辑。
 * （steelTailJumpTracker 声明已提前至文件前部）
 */

function applyTailJumpAt1750(steel) {
    const TRIGGER_X = 1750;
    const GAP_BEFORE_POINT = 50;

    var key = steel.inMatNo;

    if (!steelTailJumpTracker[key]) {
        steelTailJumpTracker[key] = {
            triggered: false,
            prevHeadX: 0   // 从0开始确保 crossed=true 即使 headX 已≥1750
        };
    }

    var tracker = steelTailJumpTracker[key];

    // 检测跨过1750：上一次低于1750，本次大于等于1750
    var crossed = tracker.prevHeadX < TRIGGER_X && steel.headX >= TRIGGER_X;

    if (crossed && !tracker.triggered) {
        // 找到尾位置下一个要离开的集合点
        var next = getTailNextPoint(steel.tailX);
        if (next) {
            var jumpTarget = Math.max(0, next.x - GAP_BEFORE_POINT);
            if (jumpTarget > steel.tailX) {
                steel.tailX = jumpTarget;
                console.log('[尾跳插件]', steel.inMatNo,
                    '头越过1750，尾跳至', jumpTarget.toFixed(1),
                    '(下一集合点', next.tag, 'x=' + next.x, '前' + GAP_BEFORE_POINT + ')');
            } else {
                console.log('[尾跳插件]', steel.inMatNo,
                    '头越过1750，尾已越过目标', jumpTarget.toFixed(1), '，跳过尾跳');
            }
        }
        tracker.triggered = true;
    }

    tracker.prevHeadX = steel.headX;

}

/**
 * ===== 插件：头越过3100时尾跳至下一集合点前50（独立函数） =====
 * 【中棒独有】此函数是中棒线工艺专属逻辑，其他产线（扁棒/大棒）不要复制引入。
 *
 * 当钢坯头位置跨过3100后，尾位置跳到下一个要离开的集合点之前50的位置。
 * 控制精轧入口区域钢坯视觉长度。
 *
 * 独立函数，可随时移除不影响其他逻辑。
 */
function applyTailJumpAt3100(steel) {
    const TRIGGER_X = 3100;
    const GAP_BEFORE_POINT = 50;

    var key = steel.inMatNo;

    if (!steelTailJump3100Tracker[key]) {
        steelTailJump3100Tracker[key] = {
            triggered: false,
            prevHeadX: 0   // 从0开始确保 crossed=true 即使 headX 已≥3100
        };
    }

    var tracker = steelTailJump3100Tracker[key];

    var crossed = tracker.prevHeadX < TRIGGER_X && steel.headX >= TRIGGER_X;

    if (crossed && !tracker.triggered) {
        var next = getTailNextPoint(steel.tailX);
        if (next) {
            var jumpTarget = Math.max(0, next.x - GAP_BEFORE_POINT);
            if (jumpTarget > steel.tailX) {
                steel.tailX = jumpTarget;
                console.log('[尾跳3100插件]', steel.inMatNo,
                    '头越过3100，尾跳至', jumpTarget.toFixed(1),
                    '(下一集合点', next.tag, 'x=' + next.x, '前' + GAP_BEFORE_POINT + ')');
            } else {
                console.log('[尾跳3100插件]', steel.inMatNo,
                    '头越过3100，尾已越过目标', jumpTarget.toFixed(1), '，跳过尾跳');
            }
        }
        tracker.triggered = true;
    }

    tracker.prevHeadX = steel.headX;

}

/**
 * ===== 插件：头经过3350时尾位置移动到2100（独立函数） =====
 * 【中棒独有】此函数是中棒线工艺专属逻辑，其他产线（扁棒/大棒）不要复制引入。
 *
 * 当钢坯头位置跨过3350后，尾位置立刻跳至2100。
 * 控制精轧区域钢坯视觉长度，避免钢坯在精轧后段被过度拉长。
 *
 * 独立函数，可随时移除不影响其他逻辑。
 */
function applyTailJumpAt3350(steel) {
    const TRIGGER_X = 3350;
    const JUMP_TARGET = 2100;

    var key = steel.inMatNo;

    if (!steelTailJump3350Tracker[key]) {
        steelTailJump3350Tracker[key] = {
            triggered: false,
            prevHeadX: 0   // 从0开始确保 crossed=true 即使 headX 已≥3350
        };
    }

    var tracker = steelTailJump3350Tracker[key];

    // 检测跨过3350：上一次低于3350，本次大于等于3350
    var crossed = tracker.prevHeadX < TRIGGER_X && steel.headX >= TRIGGER_X;

    if (crossed && !tracker.triggered) {
        if (JUMP_TARGET > steel.tailX) {
            steel.tailX = clipTailBySignals(steel, JUMP_TARGET);
            console.log('[尾跳3350插件]', steel.inMatNo,
                '头越过3350，尾跳至', steel.tailX,
                '(目标=' + JUMP_TARGET + ',经clipTailBySignals约束)');
        } else {
            console.log('[尾跳3350插件]', steel.inMatNo,
                '头越过3350，尾已越过目标', JUMP_TARGET, '，跳过尾跳');
        }
        tracker.triggered = true;
    }

    tracker.prevHeadX = steel.headX;

}

/**
 * ===== 钢坯头位置到达1100时停顿10秒（1#剪位置修磨工艺） =====
 * 【中棒独有】此函数是中棒线工艺专属逻辑，其他产线（扁棒/大棒）不要复制引入。
 *
 * 真实轧线工艺：钢坯头到达1100附近（MIDDLE区入口）时，
 * 需要在1#剪切前对钢坯头部进行修磨处理，
 * 整根钢坯停顿10秒，头尾均不前进。
 *
 * 独立函数，可随时移除不影响其他逻辑。
 */
function applySteelPauseAt1100(steel) {
    const PAUSE_POSITION = 1100;
    const PAUSE_DURATION = 10000; // 1#剪位置修磨，整根钢坯停顿10秒

    const key = steel.inMatNo;

    if (!steelPauseTracker[key]) {
        steelPauseTracker[key] = {
            paused: false,
            pauseStartTime: 0,
            passed: false,
            prevHeadX: steel.headX
        };
    }

    const tracker = steelPauseTracker[key];

    // 检测跨过1100：上一次低于1100，本次大于等于1100
    const crossed1100 = tracker.prevHeadX < PAUSE_POSITION && steel.headX >= PAUSE_POSITION;

    if (crossed1100 && !tracker.paused && !tracker.passed) {
        // 头位置从小于1100跨到1100，开始在1#剪位置修磨停顿
        tracker.paused = true;
        tracker.pauseStartTime = Date.now();
        steel.headSpeed = 0;
        steel.tailSpeed = 0;
        console.log('[停顿]', steel.inMatNo, '头跨过1100，1#剪修磨停顿10秒');
    } else if (tracker.paused) {
        // 停顿中，检查是否已到10秒
        if (Date.now() - tracker.pauseStartTime >= PAUSE_DURATION) {
            tracker.paused = false;
            tracker.passed = true;
            console.log('[停顿]', steel.inMatNo, '修磨停顿结束，恢复运动');
        } else {
            steel.headSpeed = 0;
            steel.tailSpeed = 0;
        }
    }

    // 记录本次headX供下次比较
    tracker.prevHeadX = steel.headX;

}

//位置求解函数
function updateSteelPosition(
    steel,
    dt
) {

    steel.headX +=
        steel.headSpeed * dt;

    var oldTailX = steel.tailX;
    steel.tailX +=
        steel.tailSpeed * dt;

    if (steel.tailX < 0) {

        steel.tailX = 0;
    }

    // 每帧尾部信号约束（安全网）：尾部不能越过 signal=1 的集合点
    if (steel.tailX > oldTailX && steel.tailSpeed > 0) {
        var iterator = All_POSITION_MAP.entries();
        var entry;
        while ((entry = iterator.next()) && !entry.done) {
            var tag = entry.value[0];
            var x = entry.value[1];
            if (x <= oldTailX) continue;
            if (x > steel.tailX) break;
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

    // 按顺序遍历所有分区
    for (var i = 0; i < MILL_ZONES.length; i++) {
        var zone = MILL_ZONES[i];

        if (zone.end <= currentX) continue;  // 已走过此分区

        var zoneStart = Math.max(currentX, zone.start);
        var speed = SPEED_CONFIG[zone.name] ? SPEED_CONFIG[zone.name][speedKey] : 0;

        if (speed <= 0) {
            // 此分区速度为0，钢坯无法穿过（如tail在ENTRY阶段），终止推算
            break;
        }

        var zoneDistance = zone.end - zoneStart;
        var timeInZone = zoneDistance / speed;

        if (remainingSec >= timeInZone) {
            currentX = zone.end;
            remainingSec -= timeInZone;
        } else {
            currentX += remainingSec * speed;
            remainingSec = 0;
            break;
        }
    }

    // 超出所有分区，以最后一个分区的速度继续前进
    if (remainingSec > 0) {
        var lastZone = MILL_ZONES[MILL_ZONES.length - 1];
        var lastSpeed = SPEED_CONFIG[lastZone.name] ? SPEED_CONFIG[lastZone.name][speedKey] : 5;
        currentX += remainingSec * lastSpeed;
    }

    return currentX;
}

/**
 * ===== 下线判定 =====
 * 钢坯满足以下任一条件即视为已下线，停止渲染和运动计算：
 *   1. 头位置超出终点 (≥5400)
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

    // 条件1：头超出终点
    if (steel.headX >= 5400) {
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
 * 完全求解器（每100ms执行一次）
 *
 * 对所有在线钢坯执行完整的运动推演循环：
 *   1.  状态判定   → 确定钢坯当前阶段
 *   2.  速度求解   → 查表获取头/尾速度
 *   3.  修磨停顿   → 1#剪位置修磨，整根钢坯停顿10秒
 *   4.  集合点控制 → 集合点信号控制头尾进退
 *   5.  长度锁定   → 尾到620时固定长度150，头到1200解除
 *   6.  头阻塞     → 头到1000后检查区间(1050-1450)有其他钢坯身体则阻塞
 *   7.  尾跳1750   → 头过1750时尾跳到下一集合点前50
 *   8.  尾跳3100   → 头过3100时尾跳到下一集合点前50
 *   9.  尾跳3350   → 头过3350时尾跳到2100（经clipTailBySignals约束）
 *   10. 尾速Stand16ExitHmd → 尾位置到达Stand16ExitHmd时尾速设为10（信号约束由updateSteelPosition安全网负责）
 *   11. 位置求解   → 速度 × dt 累加到坐标（含尾部信号安全网）
 *   12. 离线判断   → 收集需下线的钢坯
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

        // 2 速度求解 → 根据阶段查 SPEED_CONFIG 获取头/尾速度
        updateSteelSpeed(steel);

        // 3 修磨停顿：头跨过1100时在1#剪修磨，整根钢坯停顿10秒
        applySteelPauseAt1100(steel);

        // 4 集合点信号控制：根据各点的有钢信号控制头尾进退
        applyCollectionPointControl(steel);

        // 5 长度锁定：尾位置到620时固定长度为150，头到1200解除
        applyLengthLockAt620(steel);

        // 6 头阻塞：头到1000后若有其他钢坯身体在1050-1450区间则阻塞
        applyHeadBlockAt1000(steel);

        // 7 尾跳插件：头越过1750时尾位置跳至下一集合点前50
        applyTailJumpAt1750(steel);

        // 8 尾跳插件：头越过3100时尾位置跳至下一集合点前50
        applyTailJumpAt3100(steel);

        // 9 尾跳插件：头经过3350时尾位置移动到2100（经clipTailBySignals约束）
        applyTailJumpAt3350(steel);

        // 10 尾速插件：尾位置到达Stand16ExitHmd时尾速设为10（信号约束由updateSteelPosition安全网负责）
        applyTailSpeedAtStand16ExitHmd(steel);

        // 11 位置求解：headX/tailX += speed × dt（含尾部信号安全网）
        updateSteelPosition(
            steel,
            dt
        );

        // 12 离线判断
        if (
            isSteelFinished(
                steel
            )
        ) {

            removeList.push(
                steel.inMatNo
            );
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

    return {

        // 继承全部运动状态（headX, tailX, headSpeed, tailSpeed, state, ...）
        ...steel,

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
 *   1. updateSteelStates()    → 运动推演（9层控制逻辑 + 下线判定）
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
 * 监听 dataModel 的 a:rolltable / a:coldTable 属性变化，
 * 后端分别推送钢坯热检数据与冷床齿槽快照。
 *
 * 数据格式（rolltable）：
 *   msgTime 为服务器当前时间（格式 "YYYY-MM-DD HH:mm:ss.SSS"），
 *   data 数组的最后一组可能包含速度参数（dischargeSpeed等字段），
 *   其余项为钢坯热检数据，每项包含 inMatNo, headPosition, headTime, tailPosition, tailTime 等。
 */
// 防重复注册：脚本可能被页面/图纸重复加载导致监听器注册多次，
// 同一消息会被多次触发（表现为 console 打印多次、节点反复刷新）。
// 用 window 全局标记保证同一页面上下文内只注册一次。
if (!window.__trackingListenerInstalled) {
    window.__trackingListenerInstalled = true;

    dataModel.addDataPropertyChangeListener(function (e) {

    // ===== 分支1：冷床齿槽数据（a:coldTable）=====
    if (e.property === 'a:coldTable') {
        handleColdTableSnapshot(e.newValue);
        return;
    }

    // ===== 分支2：钢坯热检数据（a:rolltable）=====

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
 * ===== 冷床齿槽数据处理函数 =====
 *
 * 处理后端推送的冷床齿槽快照（COLD_BED_SNAPSHOT），
 * 将每个齿槽（toothNo 1~46）的状态同步到图纸节点 One-1 ~ One-46。
 *
 * 数据格式：
 *   { msgTime, lineCode, area, eventCode, source,
 *     data: { toothCount, teeth: [{ toothNo, occupied, cardNo, slabNo,
 *                                   displayText, color, isUnknown }] } }
 *
 * 映射关系（每个齿槽 → 对应图纸节点）：
 *   displayText → 节点属性 displayText / displayContent，并作为是否显示的判断依据
 *   cardNo      → 节点属性 CardNumber
 *   slabNo      → 节点属性 RollPieceID
 *   color       → 节点属性 Color
 */
function handleColdTableSnapshot(coldTable) {
    // console.log(coldTable); // 后端高频推送会刷屏，调试时可打开
    if (!coldTable || !coldTable.data || !Array.isArray(coldTable.data.teeth)) {
        return;
    }

    const teeth = coldTable.data.teeth;

    teeth.forEach(function (tooth) {
        if (!tooth || !tooth.toothNo) return;

        // 按齿槽号定位图纸节点 One-{toothNo}
        const node = dm.getDataByTag('One-' + tooth.toothNo);
        if (!node) return;

        // 显示文字：同时写入 displayText / displayContent，
        // 兼容图纸文本绑定属性名为 displayContent 的节点（与加热炉图纸一致）
        const text = tooth.displayText || '';
        node.a('displayText', text);
        node.a('displayContent', text);

        // 是否显示：以 displayText 是否有数据为准（有数据显示，无数据隐藏）
        node.s('2d.visible', !!text);

        // 卡号 → CardNumber
        node.a('CardNumber', tooth.cardNo || '');

        // 钢坯号 → RollPieceID
        node.a('RollPieceID', tooth.slabNo || '');

        // 颜色 → Color（后端发的是文本色名，转换为颜色格式；未匹配时默认红色）
        node.a('Color', COLOR_MAP[tooth.color] || '#ff0000');
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
        const hmdX = TRACK_POSITION_MAP.get(fact.headPosition);

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
        const hmdX = TRACK_POSITION_MAP.get(fact.tailPosition);

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
        var pos = TRACK_POSITION_MAP.get(fact.headPosition);
        if (pos !== undefined) {
            pos = clipHeadBySignals(steel, pos);
            console.log('[钢头校正(无time)]', steel.inMatNo, pos);
            steel.headX = pos;
        }
    }

    if (fact.tailPosition && !fact.tailTime) {
        var pos = TRACK_POSITION_MAP.get(fact.tailPosition);
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

    const line = data.getAttr("Line") || "B101";
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
            const Line = "B101";
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
            "data": "B1"
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
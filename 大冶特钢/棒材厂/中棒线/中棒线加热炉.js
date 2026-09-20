/**
 * ================================================================
 *  中棒加热炉出入炉 — 实时可视化监控系统
 * ================================================================
 *
 * 【场景描述】
 *   多轨道（自动发现 roll-y* 节点），一根固定长度的钢坯从右至左运动。
 *   数据到达后解析位置并渲染；炉内为离散位置网格，炉外为连续坐标。
 *
 * 【架构概述】
 *   数据监听 → 四大子系统分发:
 *     1. 炉内流渲染（inside）        — 离散位置网格，颜色+钢坯号
 *     2. 出入炉轨道渲染（in/out）    — 连续坐标，热检→像素→Shape
 *     3. 表格系统（will-in/out）      — 待入/待出表格
 *     4. 计划表（dataSource触发+兜底）  — 炉内坯信息变化时按炉拉取计划；超1分钟无变化自动兜底刷新
 *     5. 出炉自动前进（插件）         — 尾到 OutletHotDetector2 后按辊道速度移动
 *
 * 【外部依赖】
 *   - graphView   : HT for Web 图形视图实例（全局注入）
 *   - dataModel   : HT for Web 数据模型实例（全局注入）
 *   - requestGet  : 全局 HTTP GET 请求函数
 *   - showToast   : 全局 Toast 提示函数
 *
 * 【配套文档】
 *   中棒加热炉逻辑 — 架构设计与数据流全文档
 *
 * 【版本记录】
 *   v1.4  2026-09-05  计划表新增兜底定时刷新：炉内坯信息超 1 分钟无变化自动刷新计划
 *   v1.3  2026-09-03  炉内钢坯长度 > 10000mm 新增超长报警弹窗（OverlengthDialog）
 *   v1.2  2026-09-03  炉内钢坯输入长度 > 10000mm 时按 10000mm 处理
 *   v1.1  2026-08-27  报警弹窗调用统一改为 PopupManager.show（conflict / recognition）
 *   v1.0  2026-08-27  炉号识别不一致新增报警弹窗（RecognitionDialog，仅中棒画面使用）
 * ================================================================
 */


// ================================================================
//  一、基础初始化
// ================================================================

var view = graphView.getView();
var dm = graphView.dm();
graphView.setScrollBarVisible(false);


// ================================================================
//  二、轨道与热检坐标体系
// ================================================================

// ── 2.1 轨道发现 ──
// 自动扫描 dm 中所有 tag 匹配 /^roll-y(\d+)$/ 的节点，按序号构建数组
function getRollYNodes() {
    var nodes = [];
    dm.each(function (item) {
        var tag = item.getTag();
        var match = tag && tag.match(/^roll-y(\d+)$/);
        if (match) {
            nodes[parseInt(match[1], 10) - 1] = item;
        }
    });
    return nodes;
}
var ROLL_Y_NODES = getRollYNodes();

// 初始化日志（静默）
(function logRollYNodes() {
    var summary = ROLL_Y_NODES.map(function (node, i) {
        return '轨道' + i + (node ? '=y' + node.getPosition().y : '=未找到');
    }).join(', ');
    // console.log('[轨道纵坐标] 共发现', ROLL_Y_NODES.length, '条轨道:', summary);
})();

/**
 * 根据轨道索引获取 Y 坐标（带懒刷新）
 * @param {number} trackIndex - 轨道索引: 0→y1, 1→y2, 2→y3, ...
 * @returns {number}
 */
function getYTrack(trackIndex) {
    var node = ROLL_Y_NODES[trackIndex];
    if (!node) {
        ROLL_Y_NODES = getRollYNodes();  // 懒刷新：热检节点延迟加载时补救
        node = ROLL_Y_NODES[trackIndex];
    }
    return node ? node.getPosition().y : 0;
}

// ── 2.2 热检坐标映射 ──
// 统一 tag 格式: track-{轨道序号}-{热检名} → TRACK_POSITION_MAP[trackIndex][热检名] = X
// 出炉轨道与入炉轨道共用该格式，不再区分 1#/2#炉热检位置
// 【中棒独有·历史设计】四段式命名（track-{序号}-{炉号}-{热检名}）原为中棒独有逻辑，现已废弃，统一三段式
function getTrackPositionMap() {
    var map = {};
    dm.each(function (item) {
        var tag = item.getTag();
        if (!tag || !tag.startsWith('track-')) return;

        var match = tag.match(/^track-(\d+)-(.+)$/);
        if (!match) return;
        var trackIndex = parseInt(match[1], 10) - 1;
        if (!map[trackIndex]) map[trackIndex] = {};
        map[trackIndex][match[2]] = item.getX();
    });
    return map;
}
var TRACK_POSITION_MAP = {};
function refreshTrackPositionMap() {
    TRACK_POSITION_MAP = getTrackPositionMap();
}
refreshTrackPositionMap();


// ================================================================
//  三、常量与配置
// ================================================================

var MILL_TOTAL_LENGTH = 1500;     // 轨道总像素长度
var STEEL_FIXED_LENGTH = 202;     // 钢坯固定像素长度（默认值，实际按比例计算）

// ── 钢坯长度按比例显示 ──
// 中棒1#/2#炉最大钢坯长度均为 10000mm，对应钢坯图标 200px
var FURNACE_MAX_LENGTH_MM = {
    A1: 10000,   // 1#炉最大钢坯长度（毫米）
    A2: 10000    // 2#炉最大钢坯长度（毫米）
};
var FURNACE_STEEL_ICON_PX = {
    A1: 200,     // 1#炉钢坯图标像素宽度
    A2: 200      // 2#炉钢坯图标像素宽度
};
var SHORT_STEEL_LENGTH_MM = 8000;   // 短坯判定阈值：≤8000mm 视为短坯，炉内左右交替显示
var OVERLENGTH_LIMIT_MM = 10000;   // 超长报警阈值：炉内钢坯长度 > 10000mm 触发超长报警
// 超长报警会话级触发记录：furnaceKey → { 钢坯号: true }
// 仅用于"出现新超长钢坯号才调用弹窗"；真正的去重/确认由 OverlengthDialog 内部缓存负责
var lastOverlengthShown = {};

/**
 * 根据炉号和实际长度（毫米）计算对应的像素宽度
 * @param {string} furnaceKey - 炉号 'A1' | 'A2'
 * @param {number} lengthMm   - 钢坯实际长度（毫米）
 * @returns {number} 像素宽度
 */
function calcSteelPixelLength(furnaceKey, lengthMm) {
    if (!lengthMm || lengthMm <= 0) return STEEL_FIXED_LENGTH;
    var maxMm = FURNACE_MAX_LENGTH_MM[furnaceKey] || 10000;
    var iconPx = FURNACE_STEEL_ICON_PX[furnaceKey] || 200;
    return Math.round(lengthMm / maxMm * iconPx);
}

// 属性与轨道的映射关系：监听到哪个属性，就用哪条轨道
// a:chulu 已拆分为 a:A1-out / a:A2-out，各自携带 furnaceCode 供 label 显示炉号
var PROPERTY_TRACK_MAP = {
    'a:A1-in': 0,     // 1#炉入炉 → 轨道0 (y1)
    'a:A2-in': 1,     // 2#炉入炉 → 轨道1 (y2)
    'a:A1-out': 2,    // 1#炉出炉 → 轨道2 (y3) — 共用轨道
    'a:A2-out': 2     // 2#炉出炉 → 轨道2 (y3) — 共用轨道
};
// 钢坯颜色映射（轨道渲染用 hex）
var COLOR_MAP = {
    red: '#ff0000', green: '#00ff00', blue: '#0066ff', yellow: '#ffff00'
};


// ================================================================
//  四、炉内流渲染（Furnace Inside Flow）
// ================================================================

// ── 4.1 炉内节点缓存 ──
// 两套节点体系，按前缀缓存到 positionMap
const positionMap = {
    A1: {},     // One-0 ~ One-100 → 1#炉炉内位置节点
    A2: {}      // Two-0 ~ Two-100 → 2#炉炉内位置节点
};

/**
 * 缓存炉内位置节点映射
 * @param {string} furnaceKey - 炉号 'A1' | 'A2'
 * @param {string} prefix     - 节点tag前缀 'One' | 'Two'
 */
function cachePositionMap(furnaceKey, prefix) {
    const map = {};
    for (let i = 0; i <= 100; i++) {
        const tag = `${prefix}-${i}`;
        const node = dm.getDataByTag(tag);
        if (node) map[i] = node;
    }
    positionMap[furnaceKey] = map;
}

// 炉内节点初始化
cachePositionMap('A1', 'One');
cachePositionMap('A2', 'Two');

// ── 4.2 炉内颜色映射（渲染用 RGB） ──
function mapColorToRGB(color) {
    if (!color) return 'rgb(0,0,0)';
    const map = {
        red: 'rgb(255,0,0)',
        blue: 'rgb(51,153,255)',
        green: 'rgb(0,255,0)',
        yellow: 'rgb(255,255,0)',
        orange: 'rgb(255,165,0)'
    };
    return map[color.toLowerCase()] || 'rgb(0,0,0)';
}

// ── 4.3 炉内渲染核心 ──
/**
 * 渲染炉内钢坯位置网格
 * 数据到达 → 逐位置设置节点属性 → 清理未占用节点
 *
 * @param {string} furnaceKey - 炉号 'A1' | 'A2'
 * @param {Array}  dataList   - 后端推送数据 [[pos, inMatNo, info, linecolor], ...]
 *                               钢坯长度从 info 中解析 inMatLen:xxxx（与扁棒线/小棒线一致）
 */
function renderFurnaceInsideLayer(furnaceKey, dataList) {
    // 数据兜底
    if (!dataList) dataList = [];
    // 消息顶层时间（e.newValue 为对象时携带，超长报警弹窗展示用）
    var arriveMsgTime = (!Array.isArray(dataList) && dataList) ? (dataList.msgTime || '') : '';
    if (!Array.isArray(dataList)) dataList = dataList.data || [];

    const occupied = new Set();
    // 本次数据中超长钢坯收集（>10000mm），用于超长报警弹窗
    const overlengthItems = [];

    // 按 pos 升序排序，保证短坯左右交替顺序稳定
    const sortedList = dataList.slice().sort((a, b) => Number(a[0]) - Number(b[0]));

    let shortToggle = false;   // 短坯左右交替标志

    // 逐节点渲染
    sortedList.forEach(item => {
        const pos = Number(item[0]);
        const inMatNo = item[1];
        const info = item[2];
        const linecolor = item[3];
        // 钢坯实际长度（毫米）：从 info 字符串中解析 inMatLen:6800
        var lengthMm = 0;
        if (info) {
            var lenMatch = String(info).match(/inMatLen:(\d+)/);
            if (lenMatch) lengthMm = Number(lenMatch[1]);
        }
        // 超长报警收集：长度 > 10000mm 的钢坯记入报警列表（按原始长度判断，先于渲染截断）
        if (lengthMm > OVERLENGTH_LIMIT_MM) {
            overlengthItems.push({
                inMatNo: inMatNo, pos: pos, lengthMm: lengthMm, furnaceCode: furnaceKey
            });
        }
        // 渲染长度上限：输入钢坯长度 > 10000mm 时按 10000mm 处理（炉子最大钢坯长度）
        if (lengthMm > OVERLENGTH_LIMIT_MM) lengthMm = OVERLENGTH_LIMIT_MM;

        const node = positionMap[furnaceKey]?.[pos];
        if (!node) return;

        occupied.add(pos);

        // 按比例计算钢坯图标像素宽度
        var pixelLen = calcSteelPixelLength(furnaceKey, lengthMm);

        node.s('2d.visible', true);
        node.a('inMatNo', inMatNo);
        node.a('pos', pos);
        node.a('info', info);
        node.a('linecolor', linecolor);           // 原始颜色名
        node.a('Color', mapColorToRGB(linecolor)); // 实际渲染RGB
        node.a('furnace', furnaceKey);
        node.a('lengthMm', lengthMm);              // 实际长度（毫米）
        node.a('lengthPx', pixelLen);              // 像素宽度

        // 按长度比例缩放节点（与扁棒线/小棒线一致：以原始图标宽度为基准等比缩放）
        var maxMm = FURNACE_MAX_LENGTH_MM[furnaceKey] || 10000;
        var scaleX = lengthMm > 0 ? (lengthMm / maxMm) : 1;
        node.setScaleX(scaleX);

        // ── 短坯左右交替显示（≤8000mm 视为短坯）──
        // 记录节点原始中心X（首次渲染缓存，供偏移与恢复使用）
        if (node.a('_originX') === undefined) node.a('_originX', node.getX());
        var ox = node.a('_originX');
        var isShort = lengthMm > 0 && lengthMm <= SHORT_STEEL_LENGTH_MM;

        if (isShort) {
            // 短坯在原始钢坯位置范围内左右偏移：最大偏移 = (图标宽 - 短坯像素宽) / 2，不超出边界
            shortToggle = !shortToggle;
            var iconPx = FURNACE_STEEL_ICON_PX[furnaceKey] || 200;
            var maxOffset = (iconPx - pixelLen) / 2;
            var offset = shortToggle ? maxOffset : -maxOffset;
            node.setX(ox + offset);
        } else {
            // 长坯居中显示，恢复原始位置
            node.setX(ox);
        }
    });

    // 清理未占用节点（钢坯已移出的位置）
    Object.keys(positionMap[furnaceKey] || {}).forEach(pos => {
        if (!occupied.has(Number(pos))) {
            const node = positionMap[furnaceKey][pos];
            node.s('2d.visible', false);
            node.a('inMatNo', '');
            node.a('info', '');
            node.a('linecolor', '');
            node.a('Color', 'rgb(0,0,0)');
            // 恢复原始位置（短坯交替偏移后，下次渲染重新计算）
            if (node.a('_originX') !== undefined) node.setX(node.a('_originX'));
        }
    });

    // ── 超长钢坯报警（长度 > 10000mm）：出现新超长钢坯号才弹窗 ──
    // 真正的去重/确认由 OverlengthDialog（PopupManager 'overlength' 类型）内部缓存负责，
    // 这里只做"会话级新增号"判断，避免每帧快照重复调用弹窗
    if (overlengthItems.length && typeof PopupManager !== 'undefined' && PopupManager.show) {
        var hasNewOver = false;
        overlengthItems.forEach(function (it) {
            var shownMap = lastOverlengthShown[furnaceKey] || (lastOverlengthShown[furnaceKey] = {});
            if (!shownMap[it.inMatNo]) {
                hasNewOver = true;
                shownMap[it.inMatNo] = true;
            }
        });
        if (hasNewOver) {
            PopupManager.show('overlength', {
                furnaceCode: furnaceKey,
                msgTime: arriveMsgTime,
                // 当前炉内全部超长钢坯快照（超长总数与道次明细由弹窗展示）
                items: overlengthItems.slice()
            });
        }
    }
}


// ================================================================
//  五、出入炉轨道渲染（Entry/Exit Track Rendering）
// ================================================================

// ── 5.1 头尾位置校正 ──
/**
 * 将后端热检数据转换为渲染模型
 * headPosition/tailPosition → 查热检坐标表 → 推算出缺失的头/尾 → 返回渲染模型
 *
 * @param   {Object} item - 后端原始数据 { headPosition, tailPosition, inMatNo, color, ... }
 * @returns {Object|null} 渲染模型 { inMatNo, headX, tailX, trackIndex, label, borderColor }
 */
function applyPositionCorrection(item) {
    var trackIndex = item._trackIndex || 0;
    // 出炉轨道与入炉轨道共用同一坐标表，不再按炉号区分热检位置（四段式炉号区分属中棒独有历史设计，已废弃）
    var trackMap = TRACK_POSITION_MAP[trackIndex] || {};

    var headX = item.headPosition ? trackMap[item.headPosition] : undefined;
    var tailX = item.tailPosition ? trackMap[item.tailPosition] : undefined;

    // 头尾都缺失 → 无法渲染
    if (headX === undefined && tailX === undefined) return null;

    // 根据钢坯固定长度推算缺失端
    if (headX === undefined) headX = tailX - STEEL_FIXED_LENGTH;
    if (tailX === undefined) tailX = headX + STEEL_FIXED_LENGTH;

    var color = item.color || 'red';
    return {
        inMatNo: item.inMatNo,
        cardNo: item.cardNo,
        furnaceCode: item.furnaceCode || '',
        color: color,
        headX: headX,
        tailX: tailX,
        trackIndex: item._trackIndex || 0,
        label: item.furnaceCode ? item.inMatNo + '-' + item.furnaceCode : (item.inMatNo || ''),
        borderColor: COLOR_MAP[color] || '#ff0000'
    };
}

// ── 5.2 Shape 管理 ──
// allSteelLines: inMatNo → { shape: ht.Shape, trackIndex: number }
var allSteelLines = {};

/**
 * 创建钢坯 Shape 图形（polyline）
 */
function createSteelLineShape(steel) {
    var line = new ht.Shape();
    line.setTag('steel-' + steel.inMatNo);
    line.setStyle('label', steel.label);
    line.setStyle('shape.border.color', steel.borderColor);
    line.setStyle('label.position', "17");
    line.setStyle('label.font', "16px arial, sans-serif");
    line.setStyle('label.color', "rgb(255,255,255)");
    line.setStyle('shape.border.width', 15);
    line.setStyle('shape.type', 'polyline');
    line.setStyle('2d.movable', false);
    line.setStyle('shape.repeat.image', 'symbols/青岛特钢/扁钢钢坯.json');
    line.setLayer('0');
    line.setPoints([]);
    dm.add(line);

    // 挂载到"整体"父节点下，避免画面尺寸改变时钢坯偏移
    var parentNode = dm.getDataByTag('整体');
    if (parentNode) {
        line.setParent(parentNode);
    }
    return line;
}

/**
 * 更新钢坯线段头尾位置
 * @param {string} inMatNo - 钢坯号
 * @param {number} headX   - 头部 X 坐标
 * @param {number} tailX   - 尾部 X 坐标
 */
function updateSteelLine(inMatNo, headX, tailX) {
    var entry = allSteelLines[inMatNo];
    if (!entry) return;
    var shape = entry.shape;
    var leftX = Math.min(headX, tailX);
    var rightX = Math.max(headX, tailX);
    var y = getYTrack(entry.trackIndex);
    // 约束轨道边界 [0, MILL_TOTAL_LENGTH]
    var vs = Math.max(leftX, 0);
    var ve = Math.min(rightX, MILL_TOTAL_LENGTH);
    shape.setPoints(vs < ve ? [{ x: vs, y: y }, { x: ve, y: y }] : []);
}

/**
 * 绘制单根钢坯（创建或更新）
 */
function drawSteel(steel) {
    var inMatNo = steel.inMatNo;
    if (!allSteelLines[inMatNo]) {
        // 新钢坯：创建 Shape 并注册
        var shape = createSteelLineShape(steel);
        allSteelLines[inMatNo] = { shape: shape, trackIndex: steel.trackIndex || 0 };
    } else {
        // 已有钢坯：更新轨道索引、标签、颜色
        var entry = allSteelLines[inMatNo];
        entry.trackIndex = steel.trackIndex || 0;
        entry.shape.setStyle('label', steel.label);
        entry.shape.setStyle('shape.border.color', steel.borderColor);
    }
    updateSteelLine(inMatNo, steel.headX, steel.tailX);
}

/**
 * 渲染某条轨道上的全部钢坯，同时清理不在最新数据中的旧钢坯
 * @param {Array}  steelList  - 渲染模型数组
 * @param {number} trackIndex - 轨道索引
 */
function renderSteels(steelList, trackIndex) {
    var activeSet = {};
    steelList.forEach(function (steel) {
        activeSet[steel.inMatNo] = true;
        drawSteel(steel);
    });
    // 清理同一轨道中已消失的旧钢坯
    for (var inMatNo in allSteelLines) {
        if (!activeSet[inMatNo] && allSteelLines[inMatNo].trackIndex === trackIndex) {
            dm.remove(allSteelLines[inMatNo].shape);
            delete allSteelLines[inMatNo];
        }
    }
}


// ================================================================
//  六、表格系统
// ================================================================

// ── 6.1 will-in / will-out 表格 ──
let inTable_A1 = [];    // Onein-1 ~ Onein-10
let inTable_A2 = [];    // Twoin-1 ~ Twoin-10
let outTable_A1 = [];   // Oneout-1 ~ Oneout-10
let outTable_A2 = [];   // Twoout-1 ~ Twoout-10

// 表格节点初始化
for (var i = 1; i <= 10; i++) {
    let n = dm.getDataByTag('Onein-' + i);
    if (n) inTable_A1.push(n);
}
for (var i = 1; i <= 10; i++) {
    let n = dm.getDataByTag('Oneout-' + i);
    if (n) outTable_A1.push(n);
}
for (var i = 1; i <= 10; i++) {
    let n = dm.getDataByTag('Twoin-' + i);
    if (n) inTable_A2.push(n);
}
for (var i = 1; i <= 10; i++) {
    let n = dm.getDataByTag('Twoout-' + i);
    if (n) outTable_A2.push(n);
}

/**
 * 更新待入/待出表格
 * @param {Object} payload - { data:{...}, msgTime, furnaceCode, eventCode }
 * @param {Array}  table   - 表格行节点数组
 */
function updateTable(payload, table) {
    if (!payload || !table) return;

    const { data: d = {}, msgTime, furnaceCode, eventCode } = payload;
    const fullData = { ...d, msgTime, furnaceCode, eventCode };

    const fieldOrder = [
        'cardNo', 'sortNumber', 'inMatNo', 'steelGrade', 'heatNo',
        'inMatThick', 'inMatWidth', 'inMatLen', 'inMatWt', 'rollPlanNo'
    ];

    fieldOrder.forEach((key, index) => {
        const node = table[index];
        if (node) node.a('ht.value', fullData[key] ?? '');
    });
}

// ── 6.2 计划表数据获取 ──
// 由 1#BilletProduction / 2#BilletProduction 的 ht.dataSource 属性变化触发调用
let tableData1;
let tableData2;
// 计划表最近一次刷新时间（分炉记录）：监听触发与兜底定时刷新都会更新。
// 用于"炉内坯信息超过 1 分钟无变化时自动刷新一次"的兜底判断。
var lastPlanRefreshTime = { A1: Date.now(), A2: Date.now() };
var PLAN_STALE_THRESHOLD_MS = 60 * 1000;   // 兜底阈值：某炉距上次刷新超过 60s 则自动拉取一次
var PLAN_FALLBACK_CHECK_MS = 30 * 1000;    // 兜底定时器检查周期

/**
 * 获取计划表数据（由BilletProduction的ht.dataSource变化触发）
 * @param {string} [furnace] - 可选，指定炉号 'A1' | 'A2'；不传则拉取两个炉
 */
function fetchPlanData(furnace) {
    // 记录本次刷新时间（分炉），供兜底定时器判断是否超时未刷新
    if (!furnace || furnace === 'A1') lastPlanRefreshTime.A1 = Date.now();
    if (!furnace || furnace === 'A2') lastPlanRefreshTime.A2 = Date.now();

    // 获取班组班次信息
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

    if (!furnace || furnace === 'A1') {
        requestGet(`https://bar.dayesteel.com.cn/api/api/bdy/bptbusrollingplan/getreadyplans?wholeBacklogCode=B1&furNo=A1`)
            .then(data => {
                tableData1 = data.Data;
                let table1 = graphView.dm().getDataByTag('1#plan');
                if (table1) table1.a('ht.dataSource', tableData1);
            });
    }
    if (!furnace || furnace === 'A2') {
        requestGet(`https://bar.dayesteel.com.cn/api/api/bdy/bptbusrollingplan/getreadyplans?wholeBacklogCode=B1&furNo=A2`)
            .then(data => {
                tableData2 = data.Data;
                let table2 = graphView.dm().getDataByTag('2#plan');
                if (table2) table2.a('ht.dataSource', tableData2);
            });
    }
}


// ================================================================
//  七、消息过期判断
// ================================================================

/**
 * 判断消息是否过期（超过指定分钟数则返回 true，跳过后续逻辑）
 * @param {string} msgTime        - 消息时间，格式: "2026-06-25 14:14:09.194"
 * @param {number} maxAgeMinutes  - 最大允许分钟数
 * @param {string} propertyName   - 属性名（用于日志）
 * @returns {boolean}
 */
function isMsgExpired(msgTime, maxAgeMinutes, propertyName) {
    if (!msgTime) return false;
    var msgDate = new Date(msgTime.replace(' ', 'T'));
    if (isNaN(msgDate.getTime())) return false;
    var diffMinutes = (new Date() - msgDate) / (1000 * 60);
    var expired = diffMinutes > maxAgeMinutes;
    if (expired && propertyName) {
        console.warn('[消息过期] 属性=' + propertyName
            + ' 数据推送间隔大于' + maxAgeMinutes + '分钟，请检查问题。'
            + ' msgTime=' + msgTime + ' 差值=' + diffMinutes.toFixed(2) + '分钟');
    }
    return expired;
}


// ================================================================
//  八、炉前识别逻辑
// ================================================================

// 设备识别缓存（ALMAR 系统）
var cachedSystemId = {};

/**
 * 炉前识别：对比系统识别炉号与入炉检测炉号
 * @param {string} heatKey - 炉号 'A1' | 'A2'
 * @param {string} furNo   - 炉编号 '1' | '2'
 * @param {Object|Array} newValue - 入炉检测数据（单对象或数组）
 * @param {string} msgTime - 消息时间（报警弹窗展示用）
 */
function tryRecognize(heatKey, furNo, newValue, msgTime) {
    if (!newValue) return;

    function doRecognition() {
        var recognitionNumber = graphView.dm().getDataByTag(furNo + '#炉识别坯号');
        var recognitionText = graphView.dm().getDataByTag(furNo + '#炉识别结果');
        if (!recognitionText) return;

        var hasSystem = !!cachedSystemId[heatKey];
        var hasHeatNo = !!newValue.heatNo;

        if (hasSystem && hasHeatNo && cachedSystemId[heatKey] === newValue.heatNo) {
            // 炉号一致
            if (recognitionNumber) recognitionNumber.a('num', newValue.heatNo);
            recognitionText.s('text', '炉前识别炉号一致');
        } else if (hasSystem && hasHeatNo && cachedSystemId[heatKey] !== newValue.heatNo) {
            // 炉号不一致
            console.log('[炉号不一致] ' + heatKey + '炉: ALMAR=' + cachedSystemId[heatKey]
                + ' INLET_ROLLER=' + newValue.heatNo);
            recognitionText.s('text', '炉号不一致');
            // 报警弹窗：显示卡号/钢坯号/跟踪炉号/炉前识别炉号，缓存后点击一次不再显示
            // showRecognitionDialog(heatKey, newValue, msgTime);
        } else if (hasSystem && !hasHeatNo) {
            recognitionText.s('text', 'INLET_ROLLER标签未带入炉号');
        } else if (!hasSystem && hasHeatNo) {
            recognitionText.s('text', 'ALMAR标签未带入炉号');
        } else {
            recognitionText.s('text', '未识别到炉号信息');
        }
    }

    doRecognition();
    // 缓存未就绪则 1000ms 后重试
    if (!cachedSystemId[heatKey]) setTimeout(doRecognition, 1000);
}

/**
 * 炉号识别不一致报警弹窗
 * 显示卡号、钢坯号、跟踪炉号、炉前识别炉号
 * 与炉内冲突弹窗一致：localStorage 缓存，点击确认一次后不再显示
 * @param {string} heatKey  - 炉号 'A1' | 'A2'
 * @param {Object|Array} newValue - 入炉检测数据（单对象或数组）
 * @param {string} msgTime  - 消息时间
 */
function showRecognitionDialog(heatKey, newValue, msgTime) {
    if (typeof PopupManager === 'undefined' || !PopupManager.show) return;

    // 兼容单对象/数组，取第一条非空数据
    var items = Array.isArray(newValue) ? newValue : [newValue];
    var cardNo = '', inMatNo = '', heatNo = '';
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        if (!cardNo && it.cardNo) cardNo = it.cardNo;
        if (!inMatNo && it.inMatNo) inMatNo = it.inMatNo;
        if (!heatNo && it.heatNo) heatNo = it.heatNo;
        if (cardNo && inMatNo && heatNo) break;
    }

    PopupManager.show('recognition', {
        furnaceCode: heatKey,
        cardNo: cardNo,
        inMatNo: inMatNo,
        trackHeatNo: heatNo,
        systemHeatNo: cachedSystemId[heatKey] || '',
        msgTime: msgTime || ''
    });
}

/**
 * 从入炉检测数据中提取跟踪炉号（heatNo）
 * @param {Object|Array} data - A1-in/A2-in 的 data 字段，可能是单对象或数组
 * @returns {string}
 */
function extractHeatNo(data) {
    if (!data) return '';
    if (Array.isArray(data)) {
        for (var i = 0; i < data.length; i++) {
            if (data[i] && data[i].heatNo) return data[i].heatNo;
        }
        return '';
    }
    return data.heatNo || '';
}

/**
 * 将文本值直接赋值到指定 tag 的文本节点
 * @param {string} tag   - 节点 tag，如 '1#跟踪炉号'
 * @param {string} value - 要显示的文本
 */
function setNodeText(tag, value) {
    if (value === undefined || value === null || value === '') return;
    var node = dm.getDataByTag(tag);
    if (!node) return;
    node.s('text', value);
}


// ================================================================
//  九、数据监听分发（核心入口）
// ================================================================

dataModel.addDataPropertyChangeListener(function (e) {

    // ── 9.1 炉内坯信息dataSource变化 → 触发计划表数据拉取 ──
    if (e.property === 'ht.dataSource') {
        var tag = e.data && e.data.getTag();
        if (tag === '1#BilletProduction') {
            fetchPlanData('A1');
        } else if (tag === '2#BilletProduction') {
            fetchPlanData('A2');
        }
    }

    // ── 9.2 设备识别数据缓存：炉前识别炉号赋值到对应节点 ──
    if (e.property === 'a:A1-systemIdentification') {
        cachedSystemId.A1 = e.newValue;
        setNodeText('1#炉前识别炉号', e.newValue);
    }
    if (e.property === 'a:A2-systemIdentification') {
        cachedSystemId.A2 = e.newValue;
        setNodeText('2#炉前识别炉号', e.newValue);
    }

    // ── 9.3 炉内流渲染 ──
    if (e.property === 'a:A1-inside') {
        renderFurnaceInsideLayer('A1', e.newValue);
    }
    if (e.property === 'a:A2-inside') {
        renderFurnaceInsideLayer('A2', e.newValue);
    }

    // ── 9.4 表格更新（will-in / will-out） ──
    if (e.property === 'a:A1-willin') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A1-willin')) return;
        updateTable(e.newValue, inTable_A1);
    }
    if (e.property === 'a:A1-willout') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A1-willout')) return;
        updateTable(e.newValue, outTable_A1);
    }
    if (e.property === 'a:A2-willin') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A2-willin')) return;
        updateTable(e.newValue, inTable_A2);
    }
    if (e.property === 'a:A2-willout') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A2-willout')) return;
        updateTable(e.newValue, outTable_A2);
    }

    // ── 9.5 异常事件监听（A1/A2-ABNORMAL） ──
    if (e.property === 'a:A1-ABNORMAL' || e.property === 'a:A2-ABNORMAL') {
        var abnormalData = e.newValue?.data;
        if (abnormalData && abnormalData.abnormalType === 'SLAB_IN_POSITION_CARD_CONFLICT') {
            abnormalData.msgTime = e.newValue?.msgTime || '';
            if (typeof PopupManager !== 'undefined' && PopupManager.show) {
                PopupManager.show('conflict', abnormalData);
            }
        }
    }

    // ── 9.6 出入炉轨道渲染 ──
    var trackIndex = PROPERTY_TRACK_MAP[e.property];
    if (trackIndex === undefined) return;
    if (isMsgExpired(e.newValue?.msgTime, 30, e.property)) return;

    var rawData = e.newValue?.data || [];
    if (!Array.isArray(rawData)) rawData = [rawData];

    // 分离速度数据（末条含 dischargeSpeed → 丢弃）
    var lastItem = rawData[rawData.length - 1];
    if (lastItem && Object.prototype.hasOwnProperty.call(lastItem, 'dischargeSpeed')) {
        rawData = rawData.slice(0, -1);
    }

    // 热检节点可能延迟加载，数据到达时刷新映射
    if (!TRACK_POSITION_MAP[trackIndex] || Object.keys(TRACK_POSITION_MAP[trackIndex] || {}).length === 0) {
        refreshTrackPositionMap();
    }

    // 出炉轨道：furnaceCode 在消息顶层(e.newValue)，注入到每条 item 供 label 显示炉号
    var topFurnaceCode = e.newValue?.furnaceCode;

    // 位置校正 → 渲染
    var steelList = [];
    rawData.forEach(function (item) {
        item._trackIndex = trackIndex;
        if (topFurnaceCode && !item.furnaceCode) item.furnaceCode = topFurnaceCode;

        // 出炉自动前进标记：尾位置到 OutletHotDetector2 时启动自动前进
        if (trackIndex === 2 && item.tailPosition === 'OutletHotDetector2' && item.rollerSpeed) {
            item._autoAdvance = true;
            item._rollerSpeed = item.rollerSpeed;
        }

        var steel = applyPositionCorrection(item);
        if (steel) {
            steel._autoAdvance = item._autoAdvance;
            steel._rollerSpeed = item._rollerSpeed;
            steelList.push(steel);
        }
    });
    renderSteels(steelList, trackIndex);

    // 出炉自动前进：尾到 OutletHotDetector2 的钢坯启动/继续前进动画
    if (trackIndex === 2) {
        steelList.forEach(function (steel) {
            if (steel._autoAdvance) {
                startChuluAutoAdvance(steel);
            }
        });
    }

    // ── 9.7 炉前识别触发：跟踪炉号赋值到对应节点 ──
    if (e.property === 'a:A1-in') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A1-in')) return;
        var a1InData = e.newValue && e.newValue.data;
        tryRecognize('A1', '1', a1InData, e.newValue && e.newValue.msgTime);
        setNodeText('1#跟踪炉号', extractHeatNo(a1InData));
    }
    if (e.property === 'a:A2-in') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A2-in')) return;
        var a2InData = e.newValue && e.newValue.data;
        tryRecognize('A2', '2', a2InData, e.newValue && e.newValue.msgTime);
        setNodeText('2#跟踪炉号', extractHeatNo(a2InData));
    }
});


// ================================================================
//  十、交互系统（节点点击 + 右键菜单）
//  选择模型: HT 内置 graphView.sm()，支持普通/ Ctrl / Shift 三种选择方式。
//  菜单过滤: setVisibleFunc(item) 按选中数+跨炉检查控制显隐，multi=true 标记多选条目。
//  跨炉保护: hasMixedFurnaces() 三层拦截（菜单可见性/确认多选/菜单点击）。
// ================================================================

// ── 10.1 炉内节点选中样式 ──
var SELECTION_BORDER_COLOR = 'rgb(255, 255, 255)'; // 选中高亮

/**
 * 范围选择：选中同一炉内 pos 在 [a, b] 区间的所有可见节点
 */
function rangeSelectFurnaceNodes(furnaceKey, posFrom, posTo) {
    var lo = Math.min(posFrom, posTo);
    var hi = Math.max(posFrom, posTo);
    var map = positionMap[furnaceKey];
    if (!map) return;
    var sm = graphView.sm();
    for (var p = lo; p <= hi; p++) {
        var node = map[p];
        if (node && node.s('2d.visible')) {
            sm.as(node); // 追加到 HT 选择集
        }
    }
}

// ── 10.2 炉内节点左击事件绑定 ──
Object.keys(positionMap).forEach(furnaceKey => {
    Object.values(positionMap[furnaceKey]).forEach(node => {

        // 设置选中边框样式（HT 选择模型激活时生效）
        node.s({
            'selectable': true,
            'focusable': true,
            'select.width': 3,
            'select.color': SELECTION_BORDER_COLOR,
        });

        // 左击：普通单选 / Ctrl多选 / Shift范围选择
        // 注意：selectable:true 已开启，HT 原生自动管理单选的选择模型，
        // 这里只处理 Ctrl/Shift 特殊选择逻辑，不手动调用 sm.ss()，
        // 否则会干扰 HT 内部事件管线，导致 DOM 级点击监听器失效。
        node.s('onClick', function (event) {
            if (event.button !== 0) return;   // 仅处理左键，右键由 onContextMenu 处理
            event.stopPropagation();

            var sm = graphView.sm();

            if (event.ctrlKey || event.metaKey) {
                // ── Ctrl/Cmd+Click：切换选中状态 ──
                if (sm.contains(node)) {
                    sm.rs(node);
                } else {
                    sm.as(node);
                }
            } else if (event.shiftKey) {
                // ── Shift+Click：同一炉内范围全选 ──
                var lastData = sm.ld();
                var lastPos = lastData ? lastData.a('pos') : undefined;
                var lastFurnace = lastData ? (lastData.furnaceKey || lastData.a('furnace')) : undefined;
                var curPos = node.a('pos');
                if (lastData && lastFurnace === furnaceKey
                    && lastPos !== undefined && curPos !== undefined) {
                    rangeSelectFurnaceNodes(furnaceKey, lastPos, curPos);
                }
            }
            // ── 普通左键：不做任何 sm() 操作，selectable:true 自动管理 ──

            // 更新上下文（供右键菜单使用）
            graphView._ctx = node;
            graphView._ctx.furnaceKey = furnaceKey;

            // 回调插件
            window.appBridge?.runNodeClickPlugins({
                node: node,
                event: event,
                furnaceKey: furnaceKey,
                selectedNodes: sm.toSelection().toArray()
            });
        });
    });
});

// ── 10.3 全局右键监听 ──
// 策略：通过 capture 阶段提前存储右键节点到 _rightClickNode 和 _ctx，
// 确保 setVisibleFunc 和 handleMenuClick 执行时已有正确的节点上下文。
// 菜单的弹出和点击回调由 contextmenu.addTo(view) 自动管理，
// 不再手动设置 view.onContextMenu，避免与 HT 内部 handler 冲突导致 action 无法触发。
view.addEventListener('contextmenu', function (event) {
    var node = graphView.getDataAt(event);
    if (node) {
        var tag = node.getTag();
        if (tag && (tag.startsWith('One-') || tag.startsWith('Two-'))) {
            var furnaceKey = tag.startsWith('One-') ? 'A1' : 'A2';
            var pos = parseInt(tag.split('-')[1], 10);
            var furnaceNode = positionMap[furnaceKey]?.[pos];
            graphView._rightClickNode = furnaceNode || node;
            graphView._rightClickNode.furnaceKey = furnaceKey;
            // 同步到 _ctx（保持与原有插件/onClick 的兼容）
            graphView._ctx = graphView._rightClickNode;
            graphView._ctx.furnaceKey = furnaceKey;
            return;   // 炉内节点 → 放行，HT 的 addTo(view) 内部 handler 继续处理
        }
    }
    // 非炉内节点 → 清空，setVisibleFunc 返回 false 阻止 HT 显示菜单
    graphView._rightClickNode = null;
    graphView._ctx = null;
}, true);   // capture=true，确保在 HT 内部 handler 之前执行

// ── 10.4 点击空白清除选择+关闭弹窗 ──
view.addEventListener('click', function (e) {
    // 忽略右键菜单项上的点击，避免点击菜单时误清 _ctx 导致 handleMenuClick 提前 return
    if (e.target.closest && e.target.closest('.ht_contextmenu, .ht-widget-contextmenu, [class*="contextmenu"]')) return;

    if (!graphView.getDataAt(e)) {
        var popup = document.getElementById('steel-popup');
        if (popup) popup.remove();
        graphView.sm().ss(null);
        graphView._ctx = null;
    }
}, true);   // capture=true，在 HT 内部处理前先过滤

// ── 10.5 右键菜单定义 ──
// multi=true 标记多选专用条目，setVisibleFunc(item) 按选中数 + 节点类型过滤

const menuItems = [
    { label: "入炉退回", action: () => handleMenuClick("入炉退回") },
    { label: "出炉撤回", action: () => handleMenuClick("出炉撤回") },
    { label: "单支前移", action: () => handleMenuClick("单支前移") },
    { label: "单支后移", action: () => handleMenuClick("单支后移") },
    { label: "部分前移", multi: true, action: () => handleMenuClick("部分前移") },
    { label: "部分后移", multi: true, action: () => handleMenuClick("部分后移") },
];

const contextmenu = new ht.widget.ContextMenu(menuItems);
contextmenu.setVisibleFunc(function (item) {
    // ── 第一步：校验右键节点是不是炉内坯 ──
    // 不管单选还是多选，非炉内坯一律不显示菜单
    var rightClickNode = graphView._rightClickNode;
    if (!rightClickNode || !rightClickNode.furnaceKey) return false;

    var datas = graphView.sm().toSelection();
    // 只统计炉内钢坯节点，过滤框选时混入的轨道/标记等非炉内图元
    var furnaceNodes = datas.toArray().filter(isFurnaceSteelNode);
    var count = furnaceNodes.length;
    if (count === 0) return false;

    // 多选：仅显示 multi=true 的条目（部分前移/部分后移）
    if (count > 1) {
        // 跨炉检查：不允许同时操作1#、2#炉，不显示菜单
        if (hasMixedFurnaces(datas)) return false;
        return item.multi === true;
    }

    // 单选：显示非 multi 条目（入炉退回/出炉撤回/单支前移/单支后移），且右键节点必须有钢坯号
    var hasMatNo = rightClickNode.a('inMatNo');
    return !item.multi && hasMatNo;
});
contextmenu.addTo(view);

// ── 10.6 多选节点数组 ──
// 确认多选后，将所有选中的钢坯节点存入此数组
// 一个钢坯节点 = 实物的一根钢坯，没有道次概念

/**
 * 判断节点是否为炉内钢坯节点（tag 形如 One-数字 / Two-数字）
 * 用于过滤选择集中混入的非炉内图元（轨道 Shape、标记节点等 tag 为空的节点）
 */
function isFurnaceSteelNode(node) {
    var t = node && node.getTag ? node.getTag() : '';
    return /^(One|Two)-\d+$/.test(t || '');
}

var selectedSteelNodes = [];

/**
 * 检查选择集中是否同时包含 A1 和 A2 炉的节点（跨炉选择）
 * @param {ht.List} datas - 选择集
 * @returns {boolean}
 */
function hasMixedFurnaces(datas) {
    var hasA1 = false;
    var hasA2 = false;
    datas.each(function (node) {
        var fk = node.a('furnace');
        if (fk === 'A1') hasA1 = true;
        if (fk === 'A2') hasA2 = true;
    });
    return hasA1 && hasA2;
}

/**
 * 确认多选：将当前选择集中的所有炉内钢坯节点存入 selectedSteelNodes
 * 不允许同时选择 1#炉 和 2#炉 的节点
 * @returns {Array} 选中的节点信息数组
 */
function confirmMultiSelect() {
    var datas = graphView.sm().toSelection();
    if (datas.size() === 0) {
        selectedSteelNodes = [];
        return selectedSteelNodes;
    }

    // 跨炉检查：不允许同时操作1#、2#炉
    if (datas.size() > 1 && hasMixedFurnaces(datas)) {
        showToast('不允许同时操作1#、2#炉');
        selectedSteelNodes = [];
        return selectedSteelNodes;
    }

    selectedSteelNodes = datas.toArray().filter(isFurnaceSteelNode).map(function (node) {
        return {
            node: node,                          // HT 节点对象
            inMatNo: node.a('inMatNo') || '',    // 钢坯号
            pos: node.a('pos'),                  // 炉内位置
            furnaceKey: node.a('furnace') || '', // 炉号 A1/A2
            info: node.a('info') || '',          // 附加信息
            linecolor: node.a('linecolor') || '' // 颜色标签
        };
    });

    // 按 pos 排序（炉内位置从左到右）
    selectedSteelNodes.sort(function (a, b) {
        return (a.pos || 0) - (b.pos || 0);
    });

    return selectedSteelNodes;
}

// ── 10.7 辅助函数 ──

/**
 * 从选择集提取首尾节点信息（用于部分前移/后移接口参数）
 * @returns {{ firstNode, lastNode, firstPos, lastPos, line }|null}
 */
function extractSelectedRange() {
    var datas = graphView.sm().toSelection();
    var size = datas.size();
    if (size === 0) return null;

    var ctx = graphView._ctx;
    var furnaceKey = ctx ? (ctx.furnaceKey || ctx.a('furnace')) : undefined;
    // 只保留炉内钢坯节点，过滤框选时混入的非炉内图元
    // （否则按 pos 排序时，pos=undefined 的杂项会排最前，导致 first/last 取到 undefined，无法发请求）
    var nodes = datas.toArray().filter(isFurnaceSteelNode);
    if (nodes.length === 0) return null;

    // 按 pos 排序
    nodes.sort(function (a, b) {
        return (a.a('pos') || 0) - (b.a('pos') || 0);
    });

    var firstNode = nodes[0];
    var lastNode = nodes[nodes.length - 1];

    return {
        firstNode: firstNode,
        lastNode: lastNode,
        firstPos: firstNode.a('pos'),
        lastPos: lastNode.a('pos'),
        firstMatNo: firstNode.a('inMatNo'),
        lastMatNo: lastNode.a('inMatNo'),
        furnaceKey: furnaceKey
    };
}

/**
 * 右键菜单统一处理
 */
function handleMenuClick(type) {
    var ctx = graphView._ctx;
    if (!ctx) return;
    var furnaceKey = ctx.furnaceKey || ctx.a('furnace');

    switch (type) {
        case "部分前移":
        case "部分后移": {
            // 跨炉检查：不允许同时操作1#、2#炉
            var sm = graphView.sm().toSelection();
            if (sm.size() > 1 && hasMixedFurnaces(sm)) {
                showToast('不允许同时操作1#、2#炉');
                return;
            }

            // 确认多选：将选中节点存入数组
            confirmMultiSelect();

            var range = extractSelectedRange();
            if (range && range.firstPos !== undefined && range.lastPos !== undefined
                     && range.firstMatNo && range.lastMatNo) {
                var direction = type === "部分前移" ? "forward" : "backward";
                requestPartialMove(furnaceKey, direction,
                    range.firstPos, range.lastPos);
            }
            break;
        }
        case "入炉退回":
        case "出炉撤回": {
            var inMatNo = ctx.a('inMatNo');
            if (inMatNo) {
                if (type === "入炉退回") {
                    requestInRollback(furnaceKey, inMatNo);
                } else {
                    requestOutRollback(furnaceKey, inMatNo);
                }
            }
            break;
        }
        case "单支前移":
        case "单支后移": {
            // 单支移动与部分移动一致，发送炉内位置（pos），不是钢坯号
            var singlePos = ctx.a('pos');
            if (singlePos !== undefined && singlePos !== null) {
                var direction = type === "单支前移" ? "forward" : "backward";
                requestSingleMove(furnaceKey, direction, singlePos);
            }
            break;
        }
    }
}


// ================================================================
//  十一、业务接口
// ================================================================

const API_BASE = "https://bar.dayesteel.com.cn/api125/BarHeatFurnaceg/TRACK_MIDDLE/FURNACE";

/**
 * 入炉退回（单支）
 * @param {string} furnaceCode - 炉号 'A1' | 'A2'
 * @param {string} slabNo       - 钢坯号
 */
function requestInRollback(furnaceCode, slabNo) {
    requestGet(API_BASE + "/SLAB/IN/ROLLBACK", {
        furnaceCode: furnaceCode,
        slabNo: slabNo
    });
}

/**
 * 出炉撤回（单支）
 * @param {string} furnaceCode - 炉号 'A1' | 'A2'
 * @param {string} slabNo       - 钢坯号
 */
function requestOutRollback(furnaceCode, slabNo) {
    requestGet(API_BASE + "/SLAB/OUT/ROLLBACK", {
        furnaceCode: furnaceCode,
        slabNo: slabNo
    });
}

/**
 * 部分前移/后移（多选批量）
 * @param {string} furnaceCode  - 炉号 'A1' | 'A2'
 * @param {string} direction    - 'forward' | 'backward'
 * @param {number} fromPosition - 起始位置
 * @param {number} toPosition   - 结束位置
 */
function requestPartialMove(furnaceCode, direction, fromPosition, toPosition) {
    requestGet(API_BASE + "/WALKINGBEAM/PARTIAL", {
        furnaceCode: furnaceCode,
        direction: direction,
        fromPosition: fromPosition,
        toPosition: toPosition
    });
}

/**
 * 单支前移/后移（单支）
 * 复用 /WALKINGBEAM/PARTIAL 接口，fromPosition 与 toPosition 发同一个炉内位置（pos）
 * @param {string} furnaceCode  - 炉号 'A1' | 'A2'
 * @param {string} direction    - 'forward' | 'backward'
 * @param {number} position     - 炉内位置（pos）
 */
function requestSingleMove(furnaceCode, direction, position) {
    requestGet(API_BASE + "/WALKINGBEAM/PARTIAL", {
        furnaceCode: furnaceCode,
        direction: direction,
        fromPosition: position,
        toPosition: position
    });
}


// ================================================================
//  十二、出炉钢坯自动前进（插件）
//  触发条件: 钢坯尾位置到达 OutletHotDetector2
//  行为: 按辊道速度自动向前移动，头位置到达坐标0时消失
// ================================================================

var CHULU_SPEED_FACTOR = 15;  // 速度转换系数 (像素/秒 per 速度单位)，可调

// 正在自动前进的钢坯: inMatNo → { inMatNo, headX, tailX, speed, lastTime }
var autoAdvancingSteels = {};
var chuluAnimFrameId = null;

/**
 * 启动出炉钢坯自动前进动画
 * @param {Object} steel - 钢坯渲染模型（含 _rollerSpeed）
 */
function startChuluAutoAdvance(steel) {
    autoAdvancingSteels[steel.inMatNo] = {
        inMatNo: steel.inMatNo,
        headX: steel.headX,
        tailX: steel.tailX,
        speed: (steel._rollerSpeed || 0.7) * CHULU_SPEED_FACTOR,  // pixels/s
        lastTime: Date.now()
    };
    if (!chuluAnimFrameId) {
        chuluAnimFrameId = requestAnimationFrame(animateChuluLoop);
    }
}

/**
 * 动画循环：逐帧更新出炉钢坯位置
 */
function animateChuluLoop() {
    var now = Date.now();
    var hasActive = false;

    for (var inMatNo in autoAdvancingSteels) {
        var s = autoAdvancingSteels[inMatNo];
        var elapsed = (now - s.lastTime) / 1000;  // seconds
        if (elapsed <= 0) { hasActive = true; continue; }

        s.lastTime = now;
        var delta = s.speed * elapsed;

        s.headX -= delta;
        s.tailX -= delta;

        // 头位置到达坐标0 → 钢坯消失
        if (s.headX <= 0) {
            delete autoAdvancingSteels[inMatNo];
            var entry = allSteelLines[inMatNo];
            if (entry) {
                dm.remove(entry.shape);
                delete allSteelLines[inMatNo];
            }
            continue;
        }

        // 更新图形位置
        if (allSteelLines[inMatNo]) {
            var leftX = Math.max(s.headX, 0);
            var rightX = Math.min(s.tailX, MILL_TOTAL_LENGTH);
            var shape = allSteelLines[inMatNo].shape;
            var y = getYTrack(2);  // 出炉轨道 y3
            shape.setPoints(leftX < rightX ? [{ x: leftX, y: y }, { x: rightX, y: y }] : []);
        }
        hasActive = true;
    }

    if (hasActive) {
        chuluAnimFrameId = requestAnimationFrame(animateChuluLoop);
    } else {
        chuluAnimFrameId = null;
    }
}

/**
 * 停止出炉自动前进动画（页面销毁时调用）
 */
function stopChuluAutoAdvance() {
    if (chuluAnimFrameId) {
        cancelAnimationFrame(chuluAnimFrameId);
        chuluAnimFrameId = null;
    }
    autoAdvancingSteels = {};
}


// ================================================================
//  十三、启动
// ================================================================
// 计划表数据由 1#BilletProduction / 2#BilletProduction 的
// ht.dataSource 属性变化触发 fetchPlanData()，不再使用定时器轮询。
// 首次加载时拉取两个炉的计划数据。
fetchPlanData();

// ── 13.2 计划表兜底定时刷新 ──
// 事件驱动存在盲区：炉内坯信息若长期不变（数据停止推送/内容未变化），
// BilletProduction 的 ht.dataSource 不会变化，计划表将不再刷新。
// 兜底策略：每 30s 检查一次，某炉距上次刷新超过 60s 则自动拉取一次该炉计划。
setInterval(function () {
    if (Date.now() - lastPlanRefreshTime.A1 > PLAN_STALE_THRESHOLD_MS) {
        fetchPlanData('A1');
    }
    if (Date.now() - lastPlanRefreshTime.A2 > PLAN_STALE_THRESHOLD_MS) {
        fetchPlanData('A2');
    }
}, PLAN_FALLBACK_CHECK_MS);
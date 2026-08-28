/**
 * ================================================================
 *  大棒二号加热炉出入炉 — 实时可视化监控系统
 * ================================================================
 *
 * 【场景描述】
 *   单炉（2#炉 A2）监控：两根轨道，一根固定长度的钢坯从右至左运动。
 *   数据到达后解析位置并渲染；炉内为离散位置网格，炉外为连续坐标。
 *
 * 【轨道结构】
 *   roll-y1（轨道0）→ 2#炉入炉辊道
 *   roll-y2（轨道1）→ 2#炉出炉辊道
 *
 * 【架构概述】
 *   数据监听 → 五大子系统分发:
 *     1. 炉内流渲染（inside）        — 离散位置网格，颜色+钢坯号
 *     2. 出入炉轨道渲染（in/out）    — 连续坐标，热检→像素→Shape
 *     3. 表格系统（will-in/out）      — 待入/待出表格
 *     4. 计划表（dataSource触发）      — 炉内坯信息变化时拉取计划
 *     5. 出炉自动前进（插件）         — 尾到 OutletHotDetector2 后按辊道速度移动
 *
 * 【外部依赖】
 *   - graphView   : HT for Web 图形视图实例（全局注入）
 *   - dataModel   : HT for Web 数据模型实例（全局注入）
 *   - requestGet  : 全局 HTTP GET 请求函数
 *   - showToast   : 全局 Toast 提示函数
 *
 * 【来源说明】
 *   本文件由"大棒一号加热炉"（A1 单炉）版本改造而来：
 *   - 画面为 2#炉（A2），节点前缀 Two-*、表格 Twoin/Twoout、计划表 2#plan
 *   - 轨道为两轨（y1入炉/y2出炉），与一号炉画面结构一致
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
 * @param {number} trackIndex - 轨道索引: 0→y1(入炉), 1→y2(出炉)
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
// tag 格式: track-{轨道序号}-{热检名} → TRACK_POSITION_MAP[trackIndex][热检名] = X
// 入炉轨道与出炉轨道共用该格式，同一轨道内热检名唯一
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
// 大棒2#炉最大钢坯长度为 7000mm，对应钢坯图标 250px（可调整）
var FURNACE_MAX_LENGTH_MM = {
    A2: 7000     // 2#炉最大钢坯长度（毫米）
};
var FURNACE_STEEL_ICON_PX = {
    A2: 250      // 2#炉钢坯图标像素宽度
};

/**
 * 根据炉号和实际长度（毫米）计算对应的像素宽度
 * @param {string} furnaceKey - 炉号 'A2'
 * @param {number} lengthMm   - 钢坯实际长度（毫米）
 * @returns {number} 像素宽度
 */
function calcSteelPixelLength(furnaceKey, lengthMm) {
    if (!lengthMm || lengthMm <= 0) return STEEL_FIXED_LENGTH;
    var maxMm = FURNACE_MAX_LENGTH_MM[furnaceKey] || 7000;
    var iconPx = FURNACE_STEEL_ICON_PX[furnaceKey] || 250;
    return Math.round(lengthMm / maxMm * iconPx);
}

// 属性与轨道的映射关系：监听到哪个属性，就用哪条轨道
// 大棒单炉（A2）：入炉走 1#辊道(轨道0/y1)，出炉走 2#辊道(轨道1/y2)
var PROPERTY_TRACK_MAP = {
    'a:A2-in': 0,     // 2#炉入炉 → 轨道0 (y1) 入炉辊道
    'a:A2-out': 1     // 2#炉出炉 → 轨道1 (y2) 出炉辊道
};
// 钢坯颜色映射（轨道渲染用 hex）
var COLOR_MAP = {
    red: '#ff0000', green: '#00ff00', blue: '#0066ff', yellow: '#ffff00'
};


// ================================================================
//  四、炉内流渲染（Furnace Inside Flow）
// ================================================================

// ── 4.1 炉内节点缓存 ──
// Two-0 ~ Two-200 → 2#炉炉内位置节点
const positionMap = {
    A2: {}
};

/**
 * 缓存炉内位置节点映射
 * @param {string} furnaceKey - 炉号 'A2'
 * @param {string} prefix     - 节点tag前缀 'Two'
 */
function cachePositionMap(furnaceKey, prefix) {
    const map = {};
    for (let i = 0; i <= 200; i++) {
        const tag = `${prefix}-${i}`;
        const node = dm.getDataByTag(tag);
        if (node) map[i] = node;
    }
    positionMap[furnaceKey] = map;
}

// 炉内节点初始化
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
 * @param {string} furnaceKey - 炉号 'A2'
 * @param {Array}  dataList   - 后端推送数据 [[pos, inMatNo, info, linecolor, lengthMm], ...]
 */
function renderFurnaceInsideLayer(furnaceKey, dataList) {
    // 数据兜底
    if (!dataList) dataList = [];
    if (!Array.isArray(dataList)) dataList = dataList.data || [];

    const occupied = new Set();

    // 逐节点渲染
    dataList.forEach(item => {
        const pos = Number(item[0]);
        const inMatNo = item[1];
        const info = item[2];
        const linecolor = item[3];
        const lengthMm = Number(item[4]) || 0;  // 钢坯实际长度（毫米）

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

        // 按长度比例设置节点宽度
        var curWidth = node.getWidth();
        if (curWidth !== pixelLen) {
            node.setWidth(pixelLen);
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
        }
    });
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
let inTable_A2 = [];    // Twoin-1 ~ Twoin-10
let outTable_A2 = [];   // Twoout-1 ~ Twoout-10

// 表格节点初始化
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
// 由 2#BilletProduction 的 ht.dataSource 属性变化触发调用
let tableData2;

/**
 * 获取计划表数据（由BilletProduction的ht.dataSource变化触发）
 * @param {string} [furnace] - 可选，指定炉号 'A2'
 */
function fetchPlanData(furnace) {
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

    if (!furnace || furnace === 'A2') {
        requestGet(`https://bar.dayesteel.com.cn/api/api/bdy/bptbusrollingplan/getreadyplans?wholeBacklogCode=H7,H8&furNo=A2`)
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
 * @param {string} heatKey - 炉号 'A2'
 * @param {string} furNo   - 炉编号 '2'
 */
function tryRecognize(heatKey, furNo, newValue) {
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


// ================================================================
//  九、数据监听分发（核心入口）
// ================================================================

dataModel.addDataPropertyChangeListener(function (e) {

    // ── 9.1 炉内坯信息dataSource变化 → 触发计划表数据拉取 ──
    if (e.property === 'ht.dataSource') {
        var tag = e.data && e.data.getTag();
        if (tag === '2#BilletProduction') {
            fetchPlanData('A2');
        }
    }

    // ── 9.2 设备识别数据缓存 ──
    if (e.property === 'a:A2-systemIdentification') {
        cachedSystemId.A2 = e.newValue;
    }

    // ── 9.3 炉内流渲染 ──
    if (e.property === 'a:A2-inside') {
        renderFurnaceInsideLayer('A2', e.newValue);
    }

    // ── 9.4 表格更新（will-in / will-out） ──
    if (e.property === 'a:A2-willin') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A2-willin')) return;
        updateTable(e.newValue, inTable_A2);
    }
    if (e.property === 'a:A2-willout') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A2-willout')) return;
        updateTable(e.newValue, outTable_A2);
    }

    // ── 9.5 异常事件监听（A2-ABNORMAL） ──
    if (e.property === 'a:A2-ABNORMAL') {
        var abnormalData = e.newValue?.data;
        if (abnormalData && abnormalData.abnormalType === 'SLAB_IN_POSITION_CARD_CONFLICT') {
            abnormalData.msgTime = e.newValue?.msgTime || '';
            ConflictDialog.show(abnormalData);
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
        if (trackIndex === 1 && item.tailPosition === 'OutletHotDetector2' && item.rollerSpeed) {
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
    if (trackIndex === 1) {
        steelList.forEach(function (steel) {
            if (steel._autoAdvance) {
                startChuluAutoAdvance(steel);
            }
        });
    }

    // ── 9.7 炉前识别触发 ──
    if (e.property === 'a:A2-in') {
        if (isMsgExpired(e.newValue?.msgTime, 30, 'A2-in')) return;
        tryRecognize('A2', '2', e.newValue && e.newValue.data);
    }
});


// ================================================================
//  十、交互系统（节点点击 + 右键菜单）
//  选择模型: HT 内置 graphView.sm()，支持普通/ Ctrl / Shift 三种选择方式。
//  菜单过滤: setVisibleFunc(item) 按选中数控制显隐，multi=true 标记多选条目。
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
        if (tag && tag.startsWith('Two-')) {
            var furnaceKey = 'A2';
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
    { label: "前移", multi: true, action: () => handleMenuClick("部分前移") },
    { label: "后移", multi: true, action: () => handleMenuClick("部分后移") },
];

const contextmenu = new ht.widget.ContextMenu(menuItems);
contextmenu.setVisibleFunc(function (item) {
    // ── 第一步：校验右键节点是不是炉内坯 ──
    // 不管单选还是多选，非炉内坯一律不显示菜单
    var rightClickNode = graphView._rightClickNode;
    if (!rightClickNode || !rightClickNode.furnaceKey) return false;

    var datas = graphView.sm().toSelection();
    var count = datas.size();
    if (count === 0) return false;

    // 多选：仅显示 multi=true 的条目（前移/后移）
    if (count > 1) {
        return item.multi === true;
    }

    // 单选：显示非 multi 条目（入炉退回/出炉撤回），且右键节点必须有钢坯号
    var hasMatNo = rightClickNode.a('inMatNo');
    return !item.multi && hasMatNo;
});
contextmenu.addTo(view);

// ── 10.6 多选节点数组 ──
// 确认多选后，将所有选中的钢坯节点存入此数组
// 一个钢坯节点 = 实物的一根钢坯，没有道次概念
var selectedSteelNodes = [];

/**
 * 确认多选：将当前选择集中的所有炉内钢坯节点存入 selectedSteelNodes
 * @returns {Array} 选中的节点信息数组
 */
function confirmMultiSelect() {
    var datas = graphView.sm().toSelection();
    if (datas.size() === 0) {
        selectedSteelNodes = [];
        return selectedSteelNodes;
    }

    selectedSteelNodes = datas.toArray().map(function (node) {
        return {
            node: node,                          // HT 节点对象
            inMatNo: node.a('inMatNo') || '',    // 钢坯号
            pos: node.a('pos'),                  // 炉内位置
            furnaceKey: node.a('furnace') || '', // 炉号 A2
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
    var nodes = datas.toArray();

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
    }
}


// ================================================================
//  十一、业务接口
// ================================================================

// 大棒2#炉 API 基地址
const API_BASE = "https://bar.dayesteel.com.cn/api124/BarHeatFurnaceg/TRACK_BIG/FURNACE";

/**
 * 入炉退回（单支）
 * @param {string} furnaceCode - 炉号 'A2'
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
 * @param {string} furnaceCode - 炉号 'A2'
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
 * @param {string} furnaceCode  - 炉号 'A2'
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
            var y = getYTrack(1);  // 出炉轨道 y2
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
// 计划表数据由 2#BilletProduction 的
// ht.dataSource 属性变化触发 fetchPlanData()，不再使用定时器轮询。
// 首次加载时拉取计划数据。
fetchPlanData();
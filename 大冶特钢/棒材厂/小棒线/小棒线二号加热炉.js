/**
 * ================================================================
 *  小棒线二号加热炉出入炉 — 实时可视化监控系统
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
 *     4. 计划表（dataSource触发）      — 炉内坯信息变化时按炉拉取计划
 *     5. 出炉自动前进（插件）         — 尾到 OutletHotDetector2 后按辊道速度移动
 *
 * 【外部依赖】
 *   - graphView   : HT for Web 图形视图实例（全局注入）
 *   - dataModel   : HT for Web 数据模型实例（全局注入）
 *   - requestGet  : 全局 HTTP GET 请求函数
 *   - showToast   : 全局 Toast 提示函数
 *
 * 【配套文档】
 *   小棒线二号加热炉逻辑 — 架构设计与数据流全文档
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
// 统一三段式: track-{轨道序号}-{热检名} → TRACK_POSITION_MAP[trackIndex][热检名] = X
function getTrackPositionMap() {
    var map = {};
    dm.each(function (item) {
        var tag = item.getTag();
        if (!tag) return;
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
    // // 打印热检节点一览（三段式: track-{轨道序号}-{热检名}）
    // Object.keys(TRACK_POSITION_MAP).forEach(function (ti) {
    //     console.log('[热检坐标] 刷新 轨道' + ti + ':', JSON.stringify(TRACK_POSITION_MAP[ti]));
    // });
}
refreshTrackPositionMap();


// ================================================================
//  三、常量与配置
// ================================================================

var MILL_TOTAL_LENGTH = 1500;     // 轨道总像素长度
var STEEL_FIXED_LENGTH = 202;     // 钢坯固定像素长度（默认值，实际按比例计算）

// ── 钢坯长度按比例显示 ──
// 最大 7000mm，对应钢坯图标 380px
var FURNACE_MAX_LENGTH_MM = {
    A2: 7000     // 2#炉最大钢坯长度（毫米）
};
var FURNACE_STEEL_ICON_PX = {
    A2: 380      // 2#炉钢坯图标像素宽度
};

/**
 * 根据炉号和实际长度（毫米）计算对应的像素宽度
 * @param {string} furnaceKey - 炉号 'A2'
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
// 小棒线二号单加热炉：入炉1#辊道，出炉2#辊道
var PROPERTY_TRACK_MAP = {
    'a:A2-in': 0,     // 2#炉入炉 → 轨道0 (y1)  入炉辊道1#
    'a:A2-out': 1     // 2#炉出炉 → 轨道1 (y2)  出炉辊道2#
};
// 钢坯颜色映射（轨道渲染用 hex）
var COLOR_MAP = {
    red: '#ff0000', green: '#00ff00', blue: '#0066ff', yellow: '#ffff00'
};


// ================================================================
//  四、炉内流渲染（Furnace Inside Flow）
// ================================================================

// ── 4.1 炉内节点缓存 ──
// One-0 ~ One-200 → 2#炉炉内位置节点
const positionMap = {
    A2: {}
};

/**
 * 缓存炉内位置节点映射
 * @param {string} furnaceKey - 炉号 'A2'
 * @param {string} prefix     - 节点tag前缀 'One'
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
cachePositionMap('A2', 'One');

// ── 4.2 颜色选择模式 ──
// "颜色选择"按钮组节点，支持3种模式: 卡号 / 钢种 / 炉号
var colorModeBtnGroup = dataModel.getDataByTag('颜色选择');
console.log('[颜色模式] 初始化 colorModeBtnGroup=', colorModeBtnGroup ? '找到' : '未找到');
var _colorModeListenerSetup = false;

/**
 * 懒注册：监听按钮组内部 DataModel 的 checked 属性变化
 * colorModeBtnGroup 可能不是完整的 ht.Data 实例（缺少 addPropertyChangeListener），
 * 所以通过其内部 DataModel（a('dataModel')）的 addDataPropertyChangeListener 来监听按钮切换。
 */
function ensureColorModeListener() {
    if (_colorModeListenerSetup) return;
    if (!colorModeBtnGroup) {
        colorModeBtnGroup = dataModel.getDataByTag('颜色选择');
    }
    if (!colorModeBtnGroup) return;
    var btnDM = colorModeBtnGroup.a && colorModeBtnGroup.a('dataModel');
    if (!btnDM) return;

    _colorModeListenerSetup = true;
    console.log('[颜色模式] 注册内部 DataModel 监听, 按钮数=' + btnDM.size() + ', colorModeBtnGroup类型=' + (typeof colorModeBtnGroup) + ', has addPropertyChangeListener=' + (typeof colorModeBtnGroup.addPropertyChangeListener));

    btnDM.addDataPropertyChangeListener(function(e) {
        // setChecked 可能用 data.s('checked', val) 或 data.a('checked', val)，匹配多种属性名格式
        var prop = e.property;
        if (prop === 'checked' || prop === 's:checked' || prop === 'a:checked') {
            console.log('[颜色模式] DataPropertyChange: property=' + prop + ' newValue=' + e.newValue + ' displayName=' + (e.data ? e.data._displayName : '?'));
            if (e.newValue === true) {
                var mode = e.data ? e.data._displayName : '卡号';
                steelGradeColorCache = {};
                heatNoColorCache = {};
                refreshFurnaceColors(mode);
            }
        }
    });
}

/**
 * 获取当前颜色模式
 * @returns {string} '卡号' | '钢种' | '炉号'
 */
function getColorMode() {
    ensureColorModeListener();
    if (!colorModeBtnGroup) return '卡号';
    var checkedData = colorModeBtnGroup.getCheckedData ? colorModeBtnGroup.getCheckedData() : null;
    if (checkedData) {
        return checkedData._displayName || '卡号';
    }
    return '卡号';
}

// 钢种/炉号 → 颜色调色板（16色）
var STEEL_COLOR_PALETTE = [
    'rgb(255,0,0)', 'rgb(0,128,0)', 'rgb(0,102,255)', 'rgb(255,165,0)',
    'rgb(128,0,128)', 'rgb(0,128,128)', 'rgb(255,105,180)', 'rgb(139,69,19)',
    'rgb(0,100,0)', 'rgb(220,20,60)', 'rgb(75,0,130)', 'rgb(255,140,0)',
    'rgb(70,130,180)', 'rgb(255,215,0)', 'rgb(178,34,34)', 'rgb(0,139,139)'
];

// 简单哈希：字符串 → 整数
function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

// 钢种 → 颜色缓存（同种钢种保持一致颜色）
var steelGradeColorCache = {};
function getSteelGradeColor(steelGrade) {
    if (!steelGrade) return 'rgb(128,128,128)';
    if (!steelGradeColorCache[steelGrade]) {
        steelGradeColorCache[steelGrade] = STEEL_COLOR_PALETTE[hashString(steelGrade) % STEEL_COLOR_PALETTE.length];
    }
    return steelGradeColorCache[steelGrade];
}

// 炉号 → 颜色缓存（同炉号保持一致颜色）
var heatNoColorCache = {};
function getHeatNoColor(heatNo) {
    if (!heatNo) return 'rgb(128,128,128)';
    if (!heatNoColorCache[heatNo]) {
        heatNoColorCache[heatNo] = STEEL_COLOR_PALETTE[hashString(heatNo) % STEEL_COLOR_PALETTE.length];
    }
    return heatNoColorCache[heatNo];
}

/**
 * 根据当前颜色模式和info，计算炉内钢坯渲染颜色
 * @param {string} linecolor - 后端推送的颜色字段
 * @param {string} info      - 后端推送的info字符串，含 steelGrade:xxx heatNo:xxx
 * @returns {string} RGB颜色
 */
function resolveFurnaceColor(linecolor, info, optMode) {
    var mode = optMode || getColorMode();
    // console.log('[颜色模式] resolveFurnaceColor mode=' + mode + ' linecolor=' + linecolor + ' info=' + (info || '空').substring(0, 80));
    if (mode === '钢种') {
        var steelGrade = '';
        if (info) {
            var gradeMatch = info.match(/steelGrade:([^,\s]+)/);
            if (gradeMatch) steelGrade = gradeMatch[1];
        }
        return getSteelGradeColor(steelGrade);
    }
    if (mode === '炉号') {
        var heatNo = '';
        if (info) {
            var heatMatch = info.match(/heatNo:([^,\s]+)/);
            if (heatMatch) heatNo = heatMatch[1];
        }
        var heatColor = getHeatNoColor(heatNo);
        console.log('[颜色模式] 炉号色 heatNo=' + heatNo + ' hash=' + (heatNo ? hashString(heatNo) : 'N/A') + ' index=' + (heatNo ? hashString(heatNo) % 16 : 'N/A') + ' color=' + heatColor);
        return heatColor;
    }
    // 卡号模式：用原始颜色字段
    return mapColorToRGB(linecolor);
}

/**
 * 刷新所有炉内可见钢坯节点的颜色（颜色模式切换时调用）
 */
function refreshFurnaceColors(optMode) {
    var count = 0;
    Object.keys(positionMap).forEach(function(furnaceKey) {
        var map = positionMap[furnaceKey];
        Object.values(map).forEach(function(node) {
            if (node.s('2d.visible')) {
                var linecolor = node.a('linecolor') || '';
                var info = node.a('info') || '';
                node.a('Color', resolveFurnaceColor(linecolor, info, optMode));
                count++;
            }
        });
    });
    console.log('[颜色模式] refreshFurnaceColors 刷新了 ' + count + ' 个节点');
}



// ── 4.3 炉内颜色映射（渲染用 RGB） ──
function mapColorToRGB(color) {
    if (!color) return 'rgb(0,0,0)';
    const map = {
        red: 'rgb(255,0,0)',
        blue: 'rgb(51,153,255)',
        green: 'rgb(240,225,19)',
        yellow: 'rgb(255,255,0)',
        orange: 'rgb(255,165,0)'
    };
    return map[color.toLowerCase()] || 'rgb(0,0,0)';
}

// ── 4.4 炉内渲染核心 ──
/**
 * 渲染炉内钢坯位置网格
 * 数据到达 → 逐位置设置节点属性 → 清理未占用节点
 *
 * @param {string} furnaceKey - 炉号 'A2'
 * @param {Array}  dataList   - 后端推送数据 [[pos, inMatNo, info, linecolor], ...]
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
        // 钢坯实际长度（毫米）：从 info 字符串中解析 inMatLen:6800
        var lengthMm = 0;
        // 钢种、炉号：从 info 中解析（颜色切换模式用）
        var steelGrade = '';
        var heatNo = '';
        if (info) {
            var lenMatch = info.match(/inMatLen:(\d+)/);
            if (lenMatch) lengthMm = Number(lenMatch[1]);
            var gradeMatch = info.match(/steelGrade:([^,\s]+)/);
            if (gradeMatch) steelGrade = gradeMatch[1];
            var heatMatch = info.match(/heatNo:([^,\s]+)/);
            if (heatMatch) heatNo = heatMatch[1];
        }

        const node = positionMap[furnaceKey]?.[pos];
        if (!node) return;

        occupied.add(pos);

        // 按比例计算钢坯图标像素宽度
        var pixelLen = calcSteelPixelLength(furnaceKey, lengthMm);

        // console.log('[小棒线二号炉内坯] 炉号=' + furnaceKey + ' pos=' + pos
        //     + ' inMatNo=' + inMatNo + ' lengthMm=' + lengthMm
        //     + ' pixelLen=' + pixelLen + ' maxMm=' + (FURNACE_MAX_LENGTH_MM[furnaceKey] || 7000)
        //     + ' iconPx=' + (FURNACE_STEEL_ICON_PX[furnaceKey] || 380));

        node.s('2d.visible', true);
        node.a('inMatNo', inMatNo);
        node.a('displayContent', inMatNo);           // 钢坯号显示内容
        node.a('pos', pos);
        node.a('info', info);
        node.a('linecolor', linecolor);              // 原始颜色名
        node.a('steelGrade', steelGrade);            // 钢种（颜色模式切换用）
        node.a('heatNo', heatNo);                     // 炉号（颜色模式切换用）
        node.a('Color', resolveFurnaceColor(linecolor, info)); // 根据颜色模式计算RGB
        node.a('furnace', furnaceKey);
        node.a('lengthMm', lengthMm);              // 实际长度（毫米）
        node.a('lengthPx', pixelLen);              // 像素宽度

        // 按长度比例缩放节点
        var maxMm = FURNACE_MAX_LENGTH_MM[furnaceKey] || 7000;
        var scaleX = lengthMm > 0 ? (lengthMm / maxMm) : 1;
        node.setScaleX(scaleX);
    });

    // 清理未占用节点（钢坯已移出的位置）
    Object.keys(positionMap[furnaceKey] || {}).forEach(pos => {
        if (!occupied.has(Number(pos))) {
            const node = positionMap[furnaceKey][pos];
            node.s('2d.visible', false);
            node.a('inMatNo', '');
            node.a('displayContent', '');
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
    if (headX === undefined && tailX === undefined) {
        // console.warn('[位置校正] 头尾都缺失! inMatNo=' + item.inMatNo
        //     + ' headPosition=' + item.headPosition + ' tailPosition=' + item.tailPosition
        //     + ' trackIndex=' + trackIndex + ' trackMap keys=' + Object.keys(trackMap).join(','));
        return null;
    }

    // 根据钢坯固定长度推算缺失端
    if (headX === undefined) headX = tailX - STEEL_FIXED_LENGTH;
    if (tailX === undefined) tailX = headX + STEEL_FIXED_LENGTH;

    // console.log('[位置校正] inMatNo=' + item.inMatNo
    //     + ' head=' + item.headPosition + '→' + headX.toFixed(1)
    //     + ' tail=' + item.tailPosition + '→' + tailX.toFixed(1)
    //     + ' 轨道=' + trackIndex);

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
        // console.log('[钢坯Shape] 新建 inMatNo=' + inMatNo + ' 轨道=' + steel.trackIndex 
        //     + ' headX=' + steel.headX.toFixed(1) + ' tailX=' + steel.tailX.toFixed(1)
        //     + ' borderColor=' + steel.borderColor);
    } else {
        // 已有钢坯：更新轨道索引、标签、颜色
        var entry = allSteelLines[inMatNo];
        entry.trackIndex = steel.trackIndex || 0;
        entry.shape.setStyle('label', steel.label);
        entry.shape.setStyle('shape.border.color', steel.borderColor);
        // console.log('[钢坯Shape] 更新 inMatNo=' + inMatNo + ' 轨道=' + steel.trackIndex
        //     + ' headX=' + steel.headX.toFixed(1) + ' tailX=' + steel.tailX.toFixed(1));
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
            // console.log('[钢坯Shape] 清理消失 inMatNo=' + inMatNo + ' 轨道=' + trackIndex);
            dm.remove(allSteelLines[inMatNo].shape);
            delete allSteelLines[inMatNo];
        }
    }
    // console.log('[钢坯Shape] 当前轨道' + trackIndex + '活跃钢坯数=' + Object.keys(activeSet).length
    //     + ' 总Shape数=' + Object.keys(allSteelLines).length);
}


// ================================================================
//  六、表格系统
// ================================================================

// ── 6.1 will-in / will-out 表格 ──
let inTable_A2 = [];    // Onein-1 ~ Onein-10
let outTable_A2 = [];   // Oneout-1 ~ Oneout-10

// 表格节点初始化
for (var i = 1; i <= 10; i++) {
    let n = dm.getDataByTag('Onein-' + i);
    if (n) inTable_A2.push(n);
}
for (var i = 1; i <= 10; i++) {
    let n = dm.getDataByTag('Oneout-' + i);
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
let tableData;

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
        requestGet(`https://bar.dayesteel.com.cn/api/api/bdy/bptbusrollingplan/getreadyplans?wholeBacklogCode=H6&furNo=A2`)
            .then(data => {
                tableData = data.Data;
                let table = graphView.dm().getDataByTag('2#plan');
                if (table) table.a('ht.dataSource', tableData);
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
        // console.warn('[消息过期] 属性=' + propertyName
        //     + ' 数据推送间隔大于' + maxAgeMinutes + '分钟，请检查问题。'
        //     + ' msgTime=' + msgTime + ' 差值=' + diffMinutes.toFixed(2) + '分钟');
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
 * @param {string} furNo   - 炉编号 '1'
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
            // console.log('[炉号不一致] ' + heatKey + '炉: ALMAR=' + cachedSystemId[heatKey]
            //     + ' INLET_ROLLER=' + newValue.heatNo);
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

    // ── 9.4 表格更新（will-in / will-out）：只更新表格 + 缓存数据 ──
        if (e.property === 'a:A2-willin') {
            if (isMsgExpired(e.newValue?.msgTime, 30, 'A2-willin')) return;
            updateTable(e.newValue, inTable_A2);
            // 缓存数据供点击事件弹窗使用
            e.newValue.eventCode = 'a:A2-willin';
            window._willInOilPayload = e.newValue;
        }
        if (e.property === 'a:A2-willout') {
            if (isMsgExpired(e.newValue?.msgTime, 30, 'A2-willout')) return;
            updateTable(e.newValue, outTable_A2);
            // 缓存数据供点击事件弹窗使用
            e.newValue.eventCode = 'a:A2-willout';
            window._willOutOilPayload = e.newValue;
        }

    // ── 9.5 出炉计时文本联动 ──
    if (e.property === 's:text') {
        var tag = e.data && e.data.getTag();
        if (tag === 'outSetTime' || tag === 'outCountTime') {
            refreshOutTrueTime();
        }
    }

    // ── 9.6 出入炉轨道渲染 ──
    var trackIndex = PROPERTY_TRACK_MAP[e.property];
    if (trackIndex === undefined) return;
    if (isMsgExpired(e.newValue?.msgTime, 30, e.property)) return;

    // console.log('[出入炉] 属性=' + e.property + ' 轨道=' + trackIndex 
    //     + ' 热检映射=' + (TRACK_POSITION_MAP[trackIndex] ? 'OK' : '空')
    //     + ' furnaceCode=' + (e.newValue?.furnaceCode || '无')
    //     + ' msgTime=' + (e.newValue?.msgTime || '无'));

    var rawData = e.newValue?.data || [];
    if (!Array.isArray(rawData)) rawData = [rawData];
    // 兜底：如果外层无 data 字段（e.newValue 直接就是 track 数据），
    // 以 e.newValue 自身为数据源（需包含 headPosition 或 tailPosition）
    if (rawData.length === 0 && e.newValue && (e.newValue.headPosition || e.newValue.tailPosition)) {
        rawData = [e.newValue];
        // console.log('[出入炉] 兜底：e.newValue 直作为数据源');
    }

    // console.log('[出入炉] rawData长度=' + rawData.length + ' 轨道=' + trackIndex);

    // 分离速度数据（末条含 dischargeSpeed → 丢弃）
    var lastItem = rawData[rawData.length - 1];
    if (lastItem && Object.prototype.hasOwnProperty.call(lastItem, 'dischargeSpeed')) {
        rawData = rawData.slice(0, -1);
    }

    // 热检节点可能延迟加载，数据到达时刷新映射
    if (!TRACK_POSITION_MAP[trackIndex] || Object.keys(TRACK_POSITION_MAP[trackIndex] || {}).length === 0) {
        refreshTrackPositionMap();
    }

    // 出炉轨道：furnaceCode 在消息顶层(e.newValue)，注入到每条 item 供 applyPositionCorrection 查炉号子映射
    var topFurnaceCode = e.newValue?.furnaceCode;

    // 位置校正 → 渲染
    var steelList = [];
    rawData.forEach(function (item, idx) {
        item._trackIndex = trackIndex;
        if (topFurnaceCode && !item.furnaceCode) item.furnaceCode = topFurnaceCode;

        // 出炉自动前进标记：尾位置到 OutletHotDetector2 时启动自动前进
        if (trackIndex === 1 && item.tailPosition === 'OutletHotDetector2' && item.rollerSpeed) {
            item._autoAdvance = true;
            item._rollerSpeed = item.rollerSpeed;
        }

        // console.log('[出入炉] rawData[' + idx + '] inMatNo=' + item.inMatNo
        //     + ' headPosition=' + (item.headPosition || '无')
        //     + ' tailPosition=' + (item.tailPosition || '无')
        //     + ' color=' + (item.color || '无')
        //     + ' furnaceCode=' + (item.furnaceCode || '无')
        //     + (item._autoAdvance ? ' [自动前进]' : ''));

        var steel = applyPositionCorrection(item);
        if (steel) {
            steel._autoAdvance = item._autoAdvance;
            steel._rollerSpeed = item._rollerSpeed;
            steelList.push(steel);
        } else {
            // console.warn('[出入炉] applyPositionCorrection 返回 null for inMatNo=' + item.inMatNo);
        }
    });
    // console.log('[出入炉] steelList数目=' + steelList.length + ' → 调用renderSteels');
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
        tryRecognize('A2', '1', (e.newValue && e.newValue.data) || e.newValue);
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
        if (tag && tag.startsWith('One-')) {
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
// 策略：只有点击到炉内钢坯节点时才保留弹窗，其他任何位置（轨道钢坯Shape、空白区域等）都关闭弹窗。
// 原因：轨道钢坯Shape会覆盖大片轨道路段，导致 graphView.getDataAt(e) 不为 null，
//       如果不做节点类型判断，点击轨道区域弹窗不会消失。
view.addEventListener('click', function (e) {
    // 忽略右键菜单项上的点击：菜单通过 contextmenu.addTo(view) 挂载在 view 内，
    // 点击菜单项会冒泡到 view，并先于 HT 的 action 触发这里的 capture 监听。
    // 若继续往下走，getDataAt(e) 会命中的是菜单覆盖区域下的画布内容（空白/轨道Shape等），
    // 进而误执行 ss(null)/_ctx=null，导致 handleMenuClick 提前 return、部分前移/后移接口不发请求。
    // 因此用 contextmenu 实例自身的 DOM 判断，不能依赖 HT 内部不存在的 class 名。
    var menuDom = (typeof contextmenu !== 'undefined' && contextmenu.getView) ? contextmenu.getView() : null;
    if (menuDom && menuDom.contains(e.target)) return;
    // 忽略弹窗本体上的点击（弹窗在 document.body 上，z-index 高于 canvas）
    if (e.target.closest && e.target.closest('#steel-popup')) return;

    var hitData = graphView.getDataAt(e);
    // 判断是否点击到炉内钢坯节点（格式: One-数字）
    var isFurnaceInsideNode = hitData && /^(One|Two)-\d+$/.test(hitData.getTag() || '');

    if (!isFurnaceInsideNode) {
        var popup = document.getElementById('steel-popup');
        if (popup) popup.remove();
        graphView.sm().ss(null);
        graphView._ctx = null;
    }
}, true);   // capture=true，在 HT 内部处理前先过滤

// ── 10.5 右键菜单定义 ──
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
 * 确认多选：将当前选择集中的所有炉内钢坯节点存入 selectedSteelNodes
 * @returns {Array} 选中的节点信息数组
 */
function confirmMultiSelect() {
    var datas = graphView.sm().toSelection();
    if (datas.size() === 0) {
        selectedSteelNodes = [];
        return selectedSteelNodes;
    }

    selectedSteelNodes = datas.toArray().filter(isFurnaceSteelNode).map(function (node) {
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
            // ── 调试打印：点击部分前移/后移时，此刻选中的节点 ──
            (function () {
                var sel = graphView.sm().toSelection();
                var ctxTag = graphView._ctx && graphView._ctx.getTag ? graphView._ctx.getTag() : (graphView._ctx ? '无tag' : 'null');
                console.log('[部分移动调试] type=' + type
                    + ' 选中数=' + sel.size()
                    + ' _ctx=' + ctxTag);
                sel.toArray().forEach(function (n, i) {
                    var p = n.getParent ? n.getParent() : null;
                    console.log('[部分移动调试] 选中[' + i + '] id=' + n.getId()
                        + ' class=' + (n.getClass ? n.getClass() : '?')
                        + ' tag=' + (n.getTag ? n.getTag() : '?')
                        + ' name=' + (n.getDisplayName ? n.getDisplayName() : '?')
                        + ' parentId=' + (p ? p.getId() : '无')
                        + ' pos=' + n.a('pos')
                        + ' inMatNo=' + n.a('inMatNo')
                        + ' visible=' + n.s('2d.visible'));
                });
            })();

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

const API_BASE = "https://bar.dayesteel.com.cn/api126/BarHeatFurnaceg/TRACK_SMALL/FURNACE";

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

/**
 * 单支前移/后移（单支）
 * 复用 /WALKINGBEAM/PARTIAL 接口，fromPosition 与 toPosition 发同一个炉内位置（pos）
 * @param {string} furnaceCode  - 炉号 'A2'
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
    // console.log('[出炉自动前进] 启动 inMatNo=' + steel.inMatNo
    //     + ' headX=' + steel.headX.toFixed(1) + ' tailX=' + steel.tailX.toFixed(1)
    //     + ' rollerSpeed=' + steel._rollerSpeed + ' speed(px/s)=' + autoAdvancingSteels[steel.inMatNo].speed.toFixed(1));
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
            // console.log('[出炉自动前进] 消失 inMatNo=' + inMatNo + ' headX=' + s.headX.toFixed(1));
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
//  十三、出炉计时文本联动（工具函数）
//  由第九节统一监听 's:text' 触发，不在本节注册独立监听器
// ================================================================

var outSetTimeNode = dm.getDataByTag('outSetTime');
var outCountTimeNode = dm.getDataByTag('outCountTime');
var outTrueTimeNode = dm.getDataByTag('outTrueTime');

function refreshOutTrueTime() {
    if (!outSetTimeNode || !outCountTimeNode || !outTrueTimeNode) return;
    var setVal = parseFloat(outSetTimeNode.s('text')) || 0;
    var countVal = parseFloat(outCountTimeNode.s('text')) || 0;
    var diff = setVal - countVal;
    if (diff < 0) {
        outTrueTimeNode.s('text', '已超过设定时间' + Math.abs(diff) + '秒');
    } else {
        outTrueTimeNode.s('text', diff.toString());
    }
}

refreshOutTrueTime();


// ================================================================
//  十四、启动
// ================================================================
// 计划表数据由 2#BilletProduction 的
// ht.dataSource 属性变化触发 fetchPlanData()，不再使用定时器轮询。
// 首次加载时拉取计划数据。

fetchPlanData();
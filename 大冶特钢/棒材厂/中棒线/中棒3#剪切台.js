// ===== 基础初始化 =====
var view = graphView.getView();
var dm = graphView.dm();
graphView.setScrollBarVisible(false);

// ======================================================
// 🔥 表格更新（原逻辑保留）
function updateTable(payload, table) {
    if (!payload || !table) return;

    const {
        data: d = {},
        msgTime,
        furnaceCode,
        eventCode
    } = payload;

    const fullData = {
        ...d,
        msgTime,
        furnaceCode,
        eventCode
    };

    const fieldOrder = [
        'OutId2',
        'CardNo',
        'HeatNo',
        'SteelGrade',
        'OrderThick',
        'OrderLen',
        'TotalMatNum'
    ];

    fieldOrder.forEach((key, index) => {
        const node = table[index];
        if (node) node.a('ht.value', fullData[key] ?? '');
    });
}

let tableData1 ;
// 1. 定义轮询控制器（安全核心：可中断、防重复）
let pollingTimer = null;
let isRequesting = false; // 防重复请求关键

// 2. 轮询核心函数
async function startPolling(interval = 3000) {
  // 防止多次调用 startPolling 导致多轮询同时运行
  if (pollingTimer) return;

  // 递归执行轮询
  const execute = async () => {
    try {
      // 防重复：上一个请求没结束，不发新请求
      if (isRequesting) return;
      isRequesting = true;
    // 👇 获取班组班次信息
    var shiftGroupMap = { A: '一', B: '二', C: '三', D: '四' };
    var shiftNoMap = { '1': '夜', '2': '白' };
    request("https://bar.dayesteel.com.cn/api/api/bdy/bptbuscommon/getcurrentshiftinfo",{},'POST')
        .then(data => {
            var teamNode = graphView.dm().getDataByTag('Team');
            var groupNode = graphView.dm().getDataByTag('Group');
            var shift1Node = graphView.dm().getDataByTag('Shift1');
            var shiftNode = graphView.dm().getDataByTag('Shift');
            if (data && data.Data) {
                if (teamNode) teamNode.s('text', shiftGroupMap[data.Data.ShiftGroup] || data.Data.ShiftGroup);
                if (groupNode) groupNode.a('value', data.Data.ShiftGroup);
                if (shift1Node) shift1Node.s('text', shiftNoMap[data.Data.ShiftNo] || data.Data.ShiftNo);
                if (shiftNode) shiftNode.a('value', data.Data.ShiftNo);
            }
        });
    // 👇 你的接口请求
    request(`https://bar.dayesteel.com.cn/api/api/bdy/bptdatcutopact/fetchcardinfo?ProductLine=B1`,{},'POST')
    .then(data => {
        tableData1 = data.Data;
        let table1 = graphView.dm().getDataByTag('1#plan');
        table1.a('ht.dataSource',tableData1);
    });
    } catch (err) {
      console.error("轮询异常：", err);
      // 安全：出错后不中断轮询，继续执行
    } finally {
      isRequesting = false; // 重置请求状态
      // 上一次请求结束后，再延迟指定时间发起下一次（绝对不堆积）
      pollingTimer = setTimeout(execute, interval);
    };
  };

  // 启动第一次
  execute();
}

// 3. 安全停止轮询（必须！防止内存泄漏）
function stopPolling() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  isRequesting = false;
}

// ============= 使用方式 =============
startPolling(1000000); // 每1000秒轮询一次
// stopPolling(); // 页面销毁/切换时必须调用

// ===== 锯片直径输入框监听：自动联动锯位选择 =====
var btnGroupNode = dm.getDataByTag('SawMachineNumber');
var btnGroupDm = btnGroupNode ? btnGroupNode.a('dataModel') : null;

// 构建锯号到按钮的映射（如 "1#" -> 按钮节点）
function getSawBtnMap() {
    var map = {};
    if (btnGroupDm) {
        btnGroupDm.toDatas().toArray().forEach(function(btn) {
            map[btn._name] = btn; // btn._name 如 "1#"、"2#"、"3#"
        });
    }
    return map;
}

// 检查锯位并联动选中/取消
function syncSawChecked(saw) {
    var sawBtnMap = getSawBtnMap();
    var btn = sawBtnMap[saw];
    if (!btn) return;

    var oldNode = dm.getDataByTag(saw + 'OldBladeDiameter');
    var newNode = dm.getDataByTag(saw + 'NewBladeDiameter');
    var oldVal = oldNode ? oldNode.a('value') : null;
    var newVal = newNode ? newNode.a('value') : null;
    var oldEmpty = (oldVal === null || oldVal === undefined || oldVal === '');
    var newEmpty = (newVal === null || newVal === undefined || newVal === '');

    if (!oldEmpty || !newEmpty) {
        // 任一个有值，自动选中
        btn.s('checked', true);
    } else {
        // 都为空，取消选中
        btn.s('checked', false);
    }
}

// 防重复注册：脚本可能被页面/图纸重复加载导致监听器注册多次，
// 同一消息会被多次触发（表现为 console 打印多次、节点反复刷新）。
// 用 window 全局标记保证同一页面上下文内只注册一次。
if (!window.__trackingListenerInstalled) {
    window.__trackingListenerInstalled = true;

    // 统一数据监听：冷床齿槽（a:coldTable）+ 锯片直径联动（a:value）
    dataModel.addDataPropertyChangeListener(function(e) {

        // ===== 分支1：冷床齿槽数据（a:coldTable）=====
        if (e.property === 'a:coldTable') {
            handleColdTableSnapshot(e.newValue);
            return;
        }

        // ===== 分支2：锯片直径输入框 value 变化联动 =====
        if (e.property !== 'a:value') return;
        var tag = e.data && e.data.getTag();
        if (!tag) return;

        // 匹配 1#OldBladeDiameter、1#NewBladeDiameter、2#OldBladeDiameter 等
        var match = tag.match(/^(1#|2#|3#)(OldBladeDiameter|NewBladeDiameter)$/);
        if (match) {
            syncSawChecked(match[1]);
        }
    });
}

//钢坯显示颜色映射：将颜色名称映射为CSS颜色值
const COLOR_MAP = {

    red: '#ff0000',

    green: '#00ff00',

    blue: '#0066ff',

    yellow: '#ffff00'
};

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
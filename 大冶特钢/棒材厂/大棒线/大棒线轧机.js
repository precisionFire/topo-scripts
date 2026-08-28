// ===== 获取 GraphView 和数据模型 =====
var view = graphView.getView();
var dm = graphView.dm();
//滚动条不可见
graphView.setScrollBarVisible(false);
// 获取实时纵坐标基准点
var rolly1 = dm.getDataByTag('roll-y1');
var rolly2 = dm.getDataByTag('roll-y2');
var rolly3 = dm.getDataByTag('roll-y3');

// ✅ 使用函数动态获取 Y 坐标
function getYTrack(index) {
    switch (index) {
        case 0: return rolly1.getPosition().y;
        case 1: return rolly2.getPosition().y;
        case 2: return rolly3.getPosition().y;
        default: return 0;
    }
}

// 轨道配置
var segmentLength = 1800;
var allSteelLines = {};
var lastPositions = {};
var animationFrames = {};
var steelLineShapesCollection = [];

// ===== 工具函数：创建钢条 shape =====
function createSteelLineShapes(rollnum) {
    const lineShapes = [];

    for (let i = 0; i < 3; i++) {
        let line = new ht.Shape();
        line.setTag(`steel-${rollnum}-track-${i}`);
        line.setStyle('label', String(rollnum));
        line.setStyle('label.position', "17");
        line.setStyle('label.font', "16px arial, sans-serif");
        line.setStyle('label.color', "rgb(255,255,255)");
        line.setStyle('shape.border.width', 6);
        line.setStyle('shape.border.color', 'red');
        line.setStyle('shape.type', 'polyline');
        line.setStyle('shadow2', true);
        line.setStyle('shadow2.color', "rgb(255,72,0)");
        line.setStyle('shadow2.blur', 10);
        line.setStyle('shadow2.offset.x', 0);
        line.setStyle('shadow2.offset.y', 0);
        line.setStyle('2d.movable', false);
        line.setStyle('shape.repeat.image', 'symbols/青岛特钢/扁钢钢坯.json'); // 设置图像并平铺
        line.setLayer('0');
        line.setPoints([]);
        dm.add(line);
        lineShapes.push(line);
    }

    return lineShapes;
}

// ===== 工具函数：更新轨道显示 =====
function updateSteelLines(rollnum, headX, tailX) {
    const lineShapes = allSteelLines[rollnum];
    if (!lineShapes) return;

    for (let i = 0; i < 3; i++) {
        const trackStart = i * segmentLength;
        const trackEnd = trackStart + segmentLength;
        const y = getYTrack(i);  // ✅ 动态获取 Y

        const visibleStart = Math.max(headX, trackStart);
        const visibleEnd = Math.min(tailX, trackEnd);

        if (visibleStart < visibleEnd) {
            const relativeStartX = visibleStart - trackStart;
            const relativeEndX = visibleEnd - trackStart;

            lineShapes[i].setPoints([
                { x: relativeStartX, y: y },
                { x: relativeEndX, y: y }
            ]);
        } else {
            lineShapes[i].setPoints([]);
        }
    }
}

// ===== 动画函数 =====
function animateSteelLine(rollnum, fromHeadX, fromTailX, fromLen, toHeadX, toTailX, toLen) {
    const duration = 1000;
    const startTime = performance.now();

    if (animationFrames[rollnum]) {
        cancelAnimationFrame(animationFrames[rollnum]);
    }

    function animateFrame(currentTime) {
        const elapsed = currentTime - startTime;
        const t = Math.min(elapsed / duration, 1);

        const currentHeadX = fromHeadX + (toHeadX - fromHeadX) * t;
        const currentTailX = fromTailX + (toTailX - fromTailX) * t;

        updateSteelLines(rollnum, currentHeadX, currentTailX);

        if (t < 1) {
            animationFrames[rollnum] = requestAnimationFrame(animateFrame);
        } else {
            delete animationFrames[rollnum];
        }
    }

    animationFrames[rollnum] = requestAnimationFrame(animateFrame);
}

// ===== 添加或更新钢条 =====
function drawSteel(rollnum, headX, tailX, len) {
    if (!rollnum) {
        if (allSteelLines[rollnum]) {
            allSteelLines[rollnum].forEach(shape => shape.s('2d.visible', false));
        }
        return;
    }

    if (!allSteelLines[rollnum]) {
        allSteelLines[rollnum] = createSteelLineShapes(rollnum);
        updateSteelLines(rollnum, headX, tailX);
        allSteelLines[rollnum].forEach(shape => shape.s('2d.visible', true));
        lastPositions[rollnum] = { headX, tailX, len };
        return;
    }

    allSteelLines[rollnum].forEach(shape => shape.s('2d.visible', true));

    let last = lastPositions[rollnum] || { headX, tailX, len };

    // ✅ 后退时直接渲染，不执行动画
    if (tailX < last.tailX) {
        console.log(tailX,last.tailX)
        updateSteelLines(rollnum, headX, tailX);
    } else {
        animateSteelLine(rollnum, last.headX, last.tailX, last.len, headX, tailX, len);
    }

    lastPositions[rollnum] = { headX, tailX, len };
}


// ✅ 更新全局 shape 集合
function updateSteelLineShapesCollection() {
    steelLineShapesCollection = [];

    Object.values(allSteelLines).forEach(shapeList => {
        steelLineShapesCollection.push(...shapeList);
    });
}

// ===== 主函数：渲染多个钢条数据 =====
function renderMultipleSteels(dataList) {
    const newRollnums = new Set();

    dataList.forEach(([rollnum, start, end, length]) => {
        let headX = Number(end) * 12;
        let tailX = Number(start) * 12;
        let steelLength = Number(start - end) * 12;

        newRollnums.add(rollnum);
        drawSteel(rollnum, headX, tailX, steelLength);
    });

    Object.keys(allSteelLines).forEach(rollnum => {
        if (!newRollnums.has(rollnum)) {
            allSteelLines[rollnum].forEach(shape => dm.remove(shape));
            delete allSteelLines[rollnum];
            delete lastPositions[rollnum];
            if (animationFrames[rollnum]) {
                cancelAnimationFrame(animationFrames[rollnum]);
                delete animationFrames[rollnum];
            }
        }
    });

    updateSteelLineShapesCollection();
}

// ===== 监听数据变化 =====
var isUpdating = false;
const alertSlots = [null, null, null, null, null, null]; // 5 个位置槽位
const slotCount = alertSlots.length;
dataModel.addDataPropertyChangeListener(function (e) {
    let parent = graphView.dm().getDataByTag('main');
    if (e.property === 'a:rolltable') {
        renderMultipleSteels(e.newValue);
        console.log('📥 收到 rolltable 数据：', e.newValue);
    }


    // 消息规则 - 处理War报警数据
    if (e.property === 'a:War') {
        const War = e.newValue;
        console.log('📥 收到 War 数据：', War);

        // 查找第一个空位
        const freeIndex = alertSlots.findIndex(slot => slot === null);
        if (freeIndex === -1) {
            console.log('⚠️ 已达到最大报警数，忽略新报警');
            return;
        }

        // 创建节点 - 根据War[2]的值使用不同的创建逻辑
        const newNode = new ht.Node();
        newNode.setLayer('2');
        
        // 根据War[2]的值设置不同的节点样式
        if (War[2] === '0') {
            // War[2]为0时：自动消失类型
            newNode.setImage('symbols/青岛特钢/扁棒剪切线跟踪/报警提醒.json');
            newNode.setSize(240, 80);
            newNode.setPosition(115, 190 + freeIndex * 80);
            newNode.a('text', War[0]);
            newNode.a('text1', War[1]);
            newNode.a('id', War[3]);
            newNode.a('closeType', 0);
            console.log('⏱️ 自动消失型报警已创建');
        } else if (War[2] === '1') {
            // War[2]为1时：手动处理类型
            newNode.setImage('symbols/青岛特钢/扁钢线轧机跟踪/报警提醒确定.json');
            newNode.setSize(240, 100);
            newNode.setPosition(115, 190 + freeIndex * 100);
            newNode.a('text', War[0]);
            newNode.a('text1', War[1]);
            newNode.a('id', War[3]);
            newNode.a('closeType', 0);
            console.log('🔒 手动处理型报警已创建',newNode);
        } else {
            // 未知值时使用默认样式
            newNode.setImage('symbols/青岛特钢/扁钢线轧机跟踪/报警提醒.json');
            newNode.setSize(240, 80);
            newNode.setPosition(115, 190 + freeIndex * 80);
            newNode.a('text', War[0]);
            newNode.a('text1', War[1]);
            newNode.a('id', War[3]);
            newNode.a('closeType', 0);
        }

        // 添加节点到数据模型
        dataModel.add(newNode);
        newNode.setParent(parent);
        alertSlots[freeIndex] = newNode;

        // 仅自动消失类型设置消失逻辑
        if (War[2] === '0') {
            // 自动消失逻辑
            setTimeout(() => {
                dataModel.remove(newNode);
                if (alertSlots[freeIndex] === newNode) {
                    alertSlots[freeIndex] = null;
                }
                console.log('⏱️ 自动消失型报警已清除');
            }, 6000);
        }
        // 手动处理类型不设置自动消失逻辑，需要其他方式处理
    }

    // 处理closeType属性变化
    if (e.property === 'a:closeType') {
        // 当新值为1时，移除当前变化的节点
        if (e.newValue === 1) {
            // e.object通常指向发生属性变化的节点对象
            const targetNode = e.data;
            console.log(targetNode)
            // 检查节点是否存在于数据模型中
            if (targetNode && dataModel.contains(targetNode)) {
                // 从数据模型中移除节点
                dataModel.remove(targetNode);
                
                // 同时从报警槽位中清除
                const nodeIndex = alertSlots.findIndex(slot => slot === targetNode);
                if (nodeIndex !== -1) {
                    alertSlots[nodeIndex] = null;
                    console.log('🔌 已移除closeType触发的节点并释放槽位');
                } else {
                    console.log('🔌 已移除closeType触发的节点');
                }
            } else {
                console.log('⚠️ 尝试移除不存在的节点');
            }
        }
    }

    //班组信息标签
    if (e.property === 'a:group') {
        const group = e.newValue;
        const groupMap = {
        'A': '甲班',
        'B': '乙班',
        'C': '丙班',
        'D': '丁班'
        };

        const className = groupMap[group] || '未知班级';
        let groupNode = graphView.dm().getDataByTag('班组');
        groupNode.s('text', className);
        console.log('📥 收到 group 数据：', e.newValue);
    }

    if (isUpdating) return;
    if (e.property === 's:text') {
        var d = e.data;
        var textValue = d.s('text');
        var numericValue = parseFloat(textValue);

        isUpdating = true;
        if (d.getDisplayName() === '开关量') {
            if (!isNaN(numericValue)) {
                d.s('text', numericValue === 1 ? '运行' : '停止');
                d.s('text.color', 'rgb(0,204,133)');
            }
        } else {
            if (!isNaN(numericValue)) {
                if (d.getDisplayName() === '整数') {
                    d.s('text', numericValue.toFixed(0));
                }
                if (d.getDisplayName() === '一位数') {
                    d.s('text', numericValue.toFixed(1));
                }
                if (d.getDisplayName() === '二位数') {
                    d.s('text', numericValue.toFixed(2));
                }
                if (d.getDisplayName() === '三位数') {
                    d.s('text', numericValue.toFixed(3));
                }
                if (d.getDisplayName() === '') {
                    d.s('text', numericValue.toFixed(2));
                }
            }
        }
        isUpdating = false;
    }
});

// ===== 右键菜单逻辑 =====
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
    // 轧线钢坯参数
    let slabNo = data.s('label');

    switch (menuLabel) {
        case "钢坯轧废": handleRollChange("1"); break;
        case "钢坯剔料": handleRollChange("2"); break;
        case "跟踪清除": requestfallowDelete(line,slabNo); break;
        case "查看计划": requestPlanView(); break;
        case "查看实绩": requestTrueView(); break;
        default: console.warn("未处理的菜单项:", menuLabel);
    }
}

// // ✅ 接口请求封装（GET）
// function requestGet(url, params = {}) {
//     const query = new URLSearchParams(params).toString();
//     const fullUrl = `${url}?${query}`;

//     // 添加 return 关键字，返回整个 Promise 链
//     return fetch(fullUrl)
//         .then(response => {
//             if (!response.ok) throw new Error(`HTTP 错误! 状态码: ${response.status}`);
//             return response.json();
//         })
//         .then(data => {
//             if (data.Message) {
//                 showToast(data.Message);
//             }
//             console.log(data);
//             return data; // 确保数据传递到下一个 .then()
//         })
//         .catch(error => {
//             console.error('请求失败:', error);
//             showToast('请求失败，请稍后重试');
//             throw error; // 继续抛出错误，让调用者处理
//         });
// }

// ✅ 实际接口：钢坯轧废
function requeststeelDisable(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusrolllinetrack/delslab";
    requestGet(url, { Line: line , SlabNo: slabNo });
}

// ✅ 实际接口：钢坯剔料
function requeststeelDelete(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusrolllinetrack/slabenfurnback";
    requestGet(url, { Line: line , SlabNo: slabNo });
}

// ✅ 实际接口：跟踪清除
function requestfallowDelete(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusrolllinetrack/clearslab";
    requestGet(url, { Line: line , SlabNo: slabNo });
}

// ✅ 实际接口：查看计划
function requestPlanView() {
    window.open('http://180.10.10.11/#/5360058618240113987/5216491215829125201/4681989552413649962', '_blank'); // 在新标签页打开
}

// ✅ 实际接口：查看实绩
function requestTrueView() {
    window.open('http://180.10.10.11/#/5360058618240113987/5021496965365457308/5462642838515585300', '_blank'); // 在新标签页打开
}

// ===== 全局状态和弹窗节点 =====
let isClicked = false;
let isPreparingClick = false;
let hoverTimeout, leaveTimeout;
const virtualNode = graphView.dm().getDataByTag('set');

// 辅助函数：给虚拟节点赋属性
function setVirtualNodeProperty(key, value) {
    if (value != null) {
        virtualNode.a(key, value);
        console.log(`${key} 已赋值:`, value);
    }
}

// 点击空白处时，自动关闭弹窗并重置状态
graphView.getView().addEventListener('click', function (e) {
    if (!e.target.closest('.your-popup-element')) {
        virtualNode.s('2d.visible', false);
        isClicked = false;
    }
});

// ===== 统一绑定所有交互事件 =====
graphView.mi(e => {
    const data = e.data;

    // 只处理钢条（tag 以 steel- 开头）
    if (!(data instanceof ht.Shape)) return;
    const tag = data.s('label');
    const rollnum = tag;  // 拆出钢条编号
    if (!rollnum) return;               // 没有编号也不处理
    let canshu = graphView.dm().getDataByTag('ByData');
    let para = graphView.dm().getDataByTag('参数');
    canshu.a('部分选中',rollnum);
    para.s('text',rollnum);
    console.log(rollnum);
    const event = e.event;               // 拿到原生 DOM 事件
    const point = graphView.getLogicalPoint(event); // 关键点：必须传 event！

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
    // ===== 新增一行：只允许左键点击弹窗，右键点击直接 return =====
    if (event.button !== 0) return; 

    isClicked = true;
    isPreparingClick = false;
    clearTimeout(hoverTimeout);
    clearTimeout(leaveTimeout);

    virtualNode.setPosition(point.x + 80, point.y + 80);
    virtualNode.s('2d.visible', true);
    let canshu = graphView.dm().getDataByTag('ByData');
    canshu.a('部分选中',rollnum);
    const Line = "B101";  // 线路编码（固定）
    const url = `http://180.10.10.12:9003/api/sdf/sltbusrolllinetrack/mousehover`
              + `?Line=${Line}&RollPieceID=${rollnum}`;
    requestGet(url)  // 如果有参数，解开注释并传入
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
            virtualNode.s('2d.visible', false); // 出错时隐藏弹窗
            isClicked = false;
        });
    break;

    }
});

//再次确认
function handleRollChange(type) {
    // 获取接口类型
    var bydata = graphView.dm().getDataByTag('ByData');
    if(type === "1"){
    bydata.a('datetext',"1")
    }
    if(type === "2"){
    bydata.a('datetext',"2")    
    }
    // 检查是否有选中的数据
    const data = graphView.sm().ld();
    if (!data) {
        alert("请先选择一个节点");
        return;
    }
    // 获取道次修改节点
    var rollchange = graphView.dm().getDataByTag('再次确认');

    // 检查节点是否存在
    if (!rollchange) {
        console.error("未找到标签为 '再次确认' 的数据项");
        alert("再次确认功能暂时不可用");
        return;
    }

    // 如果是右键菜单点击，可能需要从 contextmenu 事件中获取位置
    const point = data.getPosition();
    rollchange.setPosition(point.x - 100, point.y - 100);
    rollchange.s('2d.visible', true);
}

// ✅ 正确使用方式
requestGet("http://180.10.10.12:9003/api/sdf/sltdatabnormal/getfields")
    .then(data => {
        let node = graphView.dm().getDataByTag('异常类型');
        console.log(data.DataDic.AbnormalType);
        node.a('ht.dataSource', data.DataDic.AbnormalType);
    });

dm.getDatas().each(node => trySetDoubleClickHandlerForNode(node));

//点位名称为流动管道，可新增参数修改方向速度，示例：dm,-3
startFlowAnimation(dm);

/**
 * 实时曲线数据采集器 - 支持多图表多数据源（统一时间轴版本）
 * 主要功能：
 * 1. 从指定节点属性获取实时数据
 * 2. 使用共享时间戳确保所有数据系列时间对齐
 * 3. 滑动时间窗口算法管理数据点
 * 4. 支持定时器的启动/停止控制
 */
class DataCollector {
  constructor(graphView) {
    this.graphView = graphView;
    this.timer = null;           // 定时器句柄
    this.isRunning = false;      // 运行状态
    this.currentTimestamp = null; // 统一时间戳
    
    // 图表配置（支持多个图表）
    this.chartConfig = {
      'line': {
        chartTag: 'line',
        propertyMap: {
          'tip1': { dataArray: [], seriesIndex: 0 },
          'tip2': { dataArray: [], seriesIndex: 1 },
          'tip3': { dataArray: [], seriesIndex: 2 }
        },
        getNode: () => this.graphView.dm().getDataByTag('line')
      },
      'date': {
        chartTag: 'date',
        propertyMap: {
          'tip1': { dataArray: [], seriesIndex: 0 },
          'tip2': { dataArray: [], seriesIndex: 1 },
          'tip3': { dataArray: [], seriesIndex: 2 },
          'tip4': { dataArray: [], seriesIndex: 3 },
          'tip5': { dataArray: [], seriesIndex: 4 },
          'tip6': { dataArray: [], seriesIndex: 5 }
        },
        getNode: () => this.graphView.dm().getDataByTag('date')
      }
    };
  }

  /**
   * 启动数据采集
   */
  start() {
    if (this.isRunning) {
      console.warn('[DataCollector] 已在运行中，无需重复启动');
      return;
    }
    
    this.isRunning = true;
    console.log('[DataCollector] 启动数据采集，频率: 1秒/次');
    
    // 使用requestAnimationFrame优化时间戳获取
    this.timer = setInterval(() => {
      requestAnimationFrame(() => {
        this.currentTimestamp = Date.now(); // 记录统一时间戳
        try {
          this.updateAllCharts();
        } catch (error) {
          console.error('[DataCollector] 更新图表时出错:', error);
        }
      });
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

// 使用示例
const dataCollector = new DataCollector(graphView);
dataCollector.start(); // 启动数据采集

// 当不再需要时停止
// dataCollector.stop();
// ===== 获取 GraphView 和数据模型 =====
var view = graphView.getView();
var dm = graphView.dm();
//滚动条不可见
graphView.setScrollBarVisible(false);
// 获取实际轨道Y坐标
var rolly1 = dm.getDataByTag('roll-y1');

// ===== 坐标映射函数（扁棒图面坐标系：逻辑坐标直接映射，不翻转）=====
function mapX(logicalX) {
    return Number(logicalX);
}

// ===== 全局变量 =====
var allSteelLines = {};
var lastPositions = {};
var animationFrames = {};
var steelLineShapesCollection = {};
let scaleFactor = 27.5; // 全局缩放比例，可动态修改

// ===== 创建钢条 shape（仅 1 条轨道）=====
function createSteelLineShapes(rollnum) {
    const lineShapes = [];

    let line = new ht.Shape();
    line.setTag(`steel-${rollnum}`);
    line.setStyle('label', String(rollnum));
    line.setStyle('label.position', "17");
    line.setStyle('label.font', "16px arial, sans-serif");
    line.setStyle('label.color', "rgb(255,255,255)");
    line.setStyle('shape.border.width', 10);
    line.setStyle('shape.border.color', 'red');
    line.setStyle('shape.type', 'polyline');
    line.setStyle('shadow2', true);
    line.setStyle('shadow2.color', "rgb(255,72,0)");
    line.setStyle('shadow2.blur', 10);
    line.setStyle('shadow2.offset.x', 0);
    line.setStyle('shadow2.offset.y', 0);
    line.setStyle('shape.repeat.image', 'symbols/青岛特钢/扁钢钢坯.json');
    line.setPoints([]);
    dm.add(line);
    lineShapes.push(line);

    return lineShapes;
}

// ===== 更新轨道上的线条显示（单轨道）=====
function updateSteelLines(rollnum, headX, tailX) {
    const lineShapes = allSteelLines[rollnum];
    if (!lineShapes) return;

    const y = rolly1.getPosition().y;
    const line = lineShapes[0];

    if (headX !== tailX) {
        line.setPoints([
            { x: headX, y: y },
            { x: tailX, y: y }
        ]);
    } else {
        line.setPoints([]);
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

// ===== 添加或更新单个钢条 =====
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

    // 后退时直接更新，不动画
    if (tailX > last.tailX) {
        updateSteelLines(rollnum, headX, tailX);
    } else {
        animateSteelLine(rollnum, last.headX, last.tailX, last.len, headX, tailX, len);
     }

    lastPositions[rollnum] = { headX, tailX, len };
}

// ===== 更新 shape 集合（方便图层控制或调试）=====
function updateSteelLineShapesCollection() {
    steelLineShapesCollection = [];

    Object.values(allSteelLines).forEach(shapeList => {
        steelLineShapesCollection.push(...shapeList);
    });
}

// ===== 批量渲染炉前钢坯：接收数据列表，逐个绘制钢条并清理已消失的钢条 =====
function renderMultipleSteels(dataList) {
    const newRollnums = new Set();
    dataList.forEach(([rollnum, start, end, length]) => {
        const rawHead = Number(end) * scaleFactor;
        const rawTail = Number(start) * scaleFactor;

        const headX = mapX(rawHead);   // ✅ 先放大再映射
        const tailX = mapX(rawTail);
        const steelLength = (Number(start) - Number(end)) * scaleFactor;

        newRollnums.add(rollnum);
        drawSteel(rollnum, headX, tailX, steelLength);
    });


    // 删除已消失的条
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

// ===== 辊道数据节点收集与初始化 =====
// willintable: 将要装钢节点 (willin-1 ~ willin-9)
// willouttable: 将要出钢节点 (willout-1 ~ willout-9)
// rollerlist: 炉内钢坯详情节点 (insteel-1 ~ insteel-9)
// rollertable: 道次数据节点 (Passes-1 ~ Passes-100)
var willintable = [];
var willouttable = [];
var rollerlist = [];
var rollertable = [];
// 辅助显示节点
var steelcode = graphView.dm().getDataByTag('steelcode');
var steeltype = graphView.dm().getDataByTag('steeltype');
var comboBox = graphView.dm().getDataByTag('comboBox');
var byData = graphView.dm().getDataByTag('ByData');
console.log(byData)
var data123 = graphView.dm().getDataByTag('data123');

// 将要装钢节点收集
for (var i = 1; i <= 9; i++) {
    var tag = 'willin-' + i;
    var node = dm.getDataByTag(tag);
    if (node) {
        willintable.push(node);
    }
}

// 将要出钢节点收集
for (var i = 1; i <= 9; i++) {
    var tag = 'willout-' + i;
    var node = dm.getDataByTag(tag);
    if (node) {
        willouttable.push(node);
    }
}

// 炉内节点收集
for (var i = 1; i <= 9; i++) {
    var tag = 'insteel-' + i;
    var node = dm.getDataByTag(tag);
    if (node) {
        rollerlist.push(node);
    }
}

// 道次节点收集
for (var i = 0; i <= 100; i++) {
    var tag = 'Passes-' + i;
    var node = dm.getDataByTag(tag);
    if (node) {
        rollertable.push(node);
    }
}
console.log(rollertable);

// 炉内钢坯属性顺序：[辊道类型1, 辊号1, 信息1, 辊道类型2, 辊号2, 信息2, 颜色编号, 是否绿色标记]
let attributes = ['rolltype1', 'rollnum1', 'massage1', 'rolltype2', 'rollnum2', 'massage2', 'rollcolor', 'isGreen'];
// 报警提醒槽位（最多6个同时显示）
const alertSlots = [null, null, null, null, null, null];
const slotCount = alertSlots.length;
// 最后一道次节点，用于出炉计时
let lastone =  graphView.dm().getDataByTag('Passes-81');

// ===== 数据变化监听（核心业务逻辑） =====
dataModel.addDataPropertyChangeListener(function (e) {
    let parent = graphView.dm().getDataByTag('整体');

    // 自动装炉/手动装炉模式切换（PLC信号 isZiDong: 0=手动, 1=自动）
    // 同时控制：自动模式节点显示文本、data123和整批炉内改计划的2d.gray和2d.selectable
    if (e.property === 'a:isZiDong') {
        let tips = e.newValue;
        let node = graphView.dm().getDataByTag('自动模式');
        let gaiPlan = graphView.dm().getDataByTag('整批炉内改计划');
        if (tips === '0') {
            // 手动装炉模式：正常可操作
            node.a('name', '手动装炉模式');
            node.s('2d.gray', true);
            if (data123) {
                data123.s('2d.gray', false);
                data123.s('2d.selectable', true);
            }
            if (gaiPlan) {
                gaiPlan.s('2d.gray', false);
                gaiPlan.s('2d.selectable', true);
            }
        }
        if (tips === '1') {
            // 自动装炉模式：灰显不可操作
            node.a('name', '自动装炉模式');
            node.s('2d.gray', false);
            if (data123) {
                data123.s('2d.gray', true);
                data123.s('2d.selectable', false);
            }
            if (gaiPlan) {
                gaiPlan.s('2d.gray', true);
                gaiPlan.s('2d.selectable', false);
            }
        }
    }

    // 自动空步投用状态切换（isKongBu: 0=未投用, 1=投用中）
    if (e.property === 'a:isKongBu') {
        let tips = e.newValue;
        let node = graphView.dm().getDataByTag('空步投用');
        if (tips === '0') {
        node.a('name', '自动空步未投用');
        node.s('2d.gray', true)
        }
        if (tips === '1') {
        node.a('name', '自动空步投用中');
        node.s('2d.gray', false)
        }
    }

    // 校磅状态切换（isCheck: 0=正常, 1=校磅中）
    if (e.property === 'a:isCheck') {
        let tips = e.newValue;
        let node = graphView.dm().getDataByTag('校磅');
        if (tips === '0') {
        node.a('name', '校磅');
        }
        if (tips === '1') {
        node.a('name', '校磅中');
        }
    }
    // HMI消息提示：将数组消息写入DisplayMode节点的ht.value
    if (e.property === 'a:isHmi') {
        let tips = e.newValue;
        let node = graphView.dm().getDataByTag('DisplayMode');
        const strArray = tips.map(num => String(num));
        node.a('ht.value', strArray);
    }
    // 入炉温度提醒：当提示文本长度>10时显示温度警告
    if (e.property === 'a:isWar') {
        let tips = e.newValue;
        let node = graphView.dm().getDataByTag('入炉温度提醒');
        console.log('📥 收到 isWar 数据：', tips);
        const length = tips[1].length;
        if (length > 10) {
        console.log(`字符长度为${length}，大于10`);
        node.s('2d.visible', true);
        } else {
        console.log(`字符长度为${length}，小于或等于10`);
        }
        console.log('字符长度为：', length);
    }

    // 钢坯化学成分识别：将S/Ni/Mn/Cr/Mo/Cu/Al/V/Nb元素值写入component节点的tip属性
    if (e.property === 'a:component') {
        console.log('📥 收到 component 数据：', e.newValue);
        let node = graphView.dm().getDataByTag('component');
        // 定义元素顺序（确保顺序固定）
        const elementOrder = ['S', 'Ni', 'Mn', 'Cr', 'Mo', 'Cu', 'Al', 'V', 'Nb'];
        // 遍历元素并设置对应tip属性
        elementOrder.forEach((element, index) => {
            const tipNumber = index + 1;
            const value = e.newValue[element] || '0.000'; // 默认值
            node.a(`tip${tipNumber}`,parseFloat(value).toFixed(2));
        });
    }

    // 单道次/双道次排列状态：将数据写入single/double节点的ht.value
    if (e.property === 'a:singlePermutation') {
        let single = graphView.dm().getDataByTag('single');
        if (single) {
            single.a('ht.value', e.newValue);
        }
    }
    if (e.property === 'a:doublePermutation') {
        let double = graphView.dm().getDataByTag('double');
        if (double) {
            double.a('ht.value', e.newValue);
        }
    }

    // 出炉计时：监听Passes-81节点的rollcolor变化（0=不可见/出炉中, 非0=可见/开始计时）
    if (e.data === lastone && e.property === 'a:rollcolor') {
            // 明确打印属性值变化，便于调试
            console.log(`2d.visible变化：${e.oldValue} → ${e.newValue}`);
            
            // 可见（true）→ 不可见（false）：启动计时
            if (e.oldValue !== '0' && e.newValue === '0') {
                startTimer();
            }
            // 不可见（false）→ 可见（true）：停止计时并重置
            else if (e.oldValue === '0' && e.newValue !== '0') {
                if (hiddenStartTime) {
                    const totalDuration = new Date() - hiddenStartTime;
                    const formattedTotal = formatDuration(totalDuration);
                    console.log(`节点可见（2d.visible = true），结束计时。总隐藏时长：${formattedTotal}`);
                }
                resetTimer();
                console.log('计时已重置，等待下一次不可见状态...');
            }
        }
    
    // 报警消息提醒：动态创建报警节点，5秒后自动消失，最多6个同时显示
    if (e.property === 'a:abb') {
        const group = e.newValue;
        console.log('📥 收到 abb 数据：', group);

        // 查找第一个空位
        const freeIndex = alertSlots.findIndex(slot => slot === null);
        if (freeIndex === -1) {
            console.warn('⚠️ 已达到最大报警数，忽略新报警');
            return;
        }

        // 创建节点
        const newNode = new ht.Node();
        newNode.setImage('symbols/青岛特钢/扁棒剪切线跟踪/报警提醒.json');
        newNode.setSize(240, 60);
        newNode.setPosition(1400, 100 + freeIndex * 80);
        newNode.a('text', group[0]);
        dataModel.add(newNode);
        newNode.setParent(parent);
        // 占位
        alertSlots[freeIndex] = newNode;

        // 5 秒后释放该槽位
        setTimeout(() => {
            dataModel.remove(newNode);
            if (alertSlots[freeIndex] === newNode) {
                alertSlots[freeIndex] = null;
            }
        }, 5000);
    }

    // 班组切换：A/B/C/D 对应 甲/乙/丙/丁班
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
    // 炉前钢坯跟踪：接收钢坯位置数据，渲染炉前钢坯动画
    if (e.property === 'a:rolltable1') {
        console.log('📥 收到 rolltable1 数据：', e.newValue);
        renderMultipleSteels(e.newValue);
    }
    // 炉后钢坯跟踪（预留，当前未启用渲染）
    if (e.property === 'a:rolltable2') {
        console.log('📥 收到 rolltable2 数据：', e.newValue);
        // renderMultipleSteels(e.newValue);
    }
    // 炉内钢坯跟踪：更新道次节点属性（辊号、颜色、绿色标记等）
    if (e.property === 'a:rolltable') {
        const targetList = e.newValue;
        console.log('新接收到的 rolltable：', targetList);
        // 遍历 rollertable 中的所有节点
        rollertable.forEach((f, index) => {
            if (index < targetList.length) { // 确保有对应数据
                let values = targetList[index]; // 取出该节点对应的数据行
                let rolltype1 = values[0]; // rolltype1
                let massage1 = values[2]; // massage1
                let rolltype2 = values[3]; // rolltype1
                let massage2 = values[5]; // massage1
                // 赋值给 rolltype1 指定的 RollPieceID
                if (rolltype1 === "1") {
                    f.a('r1.RollPieceID', massage1);
                } else if (rolltype1 === "2") {
                    f.a('r2.RollPieceID', massage1);
                } else if (rolltype1 === "3") {
                    f.a('r3.RollPieceID', massage1);
                }

                if (rolltype2 === "2") {
                    f.a('r2.RollPieceID', massage2);
                }

                // 继续赋值其他属性
                attributes.forEach((attr, i) => {
                    f.a(attr, values[i]);
                });
                let rollcolor = values[6]; // rollcolor是1-4的编号
                let isGreen = values[7];
                var lineColor = ["rgb(255,238,0)", "rgb(48,242,120)","rgb(48,242,120)","rgb(48,242,120)"];
                // rollcolor 是字符串，确保转换为数字
                let colorIndex = Number(rollcolor) - 1; // 因为数组下标是从0开始
                if(isGreen == "0"){
                if (colorIndex >= 0 && colorIndex < lineColor.length) {
                    let color = lineColor[colorIndex];
                    f.a('r1.lineColor', color);
                    f.a('r2.lineColor', color);
                    f.a('r3.lineColor', color);
                }

            }else if(isGreen == "1"){
                    f.a('r1.lineColor', "rgb(241,125,164)");
                    f.a('r2.lineColor', "rgb(241,125,164)");
                    f.a('r3.lineColor', "rgb(241,125,164)");
            }
            }
        });
    // 将要装钢数据：更新装钢表格节点 (willin-1 ~ willin-9)
    }else if (e.property === 'a:insteel') {
        const targetList = e.newValue;
        console.log('新接收到的insteel', targetList);
        const d = targetList;
                let values = [
                    d[0],
                    d[1],
                    d[2],
                    d[3],
                    d[4],
                    d[5],
                    parseFloat(d[6]).toFixed(0),
                    parseFloat(d[7]).toFixed(0),
                    d[8],
                ];
        byData.a('steelcode1' , d[9]);
        values.forEach((val, index) => {
            if (willintable[index]) {
            willintable[index].a('ht.value', val);
        }
    });
    // 将要出钢数据：更新出钢表格节点 (willout-1 ~ willout-9)
    }else if (e.property === 'a:outsteel') {
        const targetList = e.newValue;
        console.log('新接收到的outsteel', targetList);
        const d = targetList;
                let values = [
                    d[0],
                    d[1],
                    d[2],
                    d[3],
                    d[4],
                    d[5],
                    parseFloat(d[6]).toFixed(0),
                    parseFloat(d[7]).toFixed(0),
                    d[8],
                ];
        byData.a('steelcode3' , d[9]);
        values.forEach((val, index) => {
            if (willouttable[index]) {
            willouttable[index].a('ht.value', val);
        }
    });
    }

    // 监听称重报警提示文本变化：判断是否已经出现过，控制报警节点可见性
    if (e.property === 'a:text') {
        const alarmNode = graphView.dm().getDataByTag('称重报警提示');
        const confirmNode = graphView.dm().getDataByTag('称重报警确认');
        if (!alarmNode || !confirmNode || e.data !== alarmNode) return;

        const textValue = e.newValue;
        let records = [];
        try {
            records = JSON.parse(localStorage.getItem('B101-称重报警操作记录') || '[]');
        } catch (err) {}

        const isDuplicate = records.some(r => r.text === textValue);
        alarmNode.s('2d.visible', !isDuplicate);
        confirmNode.s('2d.visible', !isDuplicate);
    }
});

// ===== 辊道节点交互事件（hover弹窗 + 点击查询） =====
// 互斥状态变量：防止hover和click事件冲突
let isClicked = false;
let isPreparingClick = false;
rollertable.forEach((node, index) => {
    if (node) {
        var virtualNode = graphView.dm().getDataByTag('set'); // 弹窗节点
        let hoverTimeout, leaveTimeout;

        // 定义一个函数来处理属性的赋值
        function setVirtualNodeProperty(node, key, value) {
            if (value !== undefined && value !== null) {
                node.a(key, value);  // 使用 a() 方法赋值
                console.log(`${key} 已赋值:`, value);
            }
        }
        
        // 鼠标按下时，标记“准备点击”
        node.s('onMousedown', function () {
            isPreparingClick = true;
        });

        // 鼠标离开时，如果不是点击行为，延迟隐藏弹窗
        node.s('onLeave', function (event, data, view) {
            if (isClicked || isPreparingClick) return;
            clearTimeout(hoverTimeout);
            leaveTimeout = setTimeout(() => {
                virtualNode.s('2d.visible', false);
            }, 1000);
        });

        // 点击道次节点：显示详情弹窗并调用接口查询钢坯信息
        node.s('onClick', function (event, data, view) {
            // 防止事件冒泡到全局点击事件
            event.stopPropagation();
            
            isClicked = true;
            isPreparingClick = false;

            clearTimeout(hoverTimeout);
            clearTimeout(leaveTimeout);

            virtualNode.s('2d.visible', true);

            const point = graphView.getLogicalPoint(event);
            virtualNode.setPosition(point.x - 100, point.y - 20);

            let Line = "B101";
            let RollPieceID = "";
            if (node.a('type') == 1 || node.a('type') == 3) {
                RollPieceID = node.a('rollnum1');
                byData.a('部分选中', RollPieceID);
                if(node.a('rolltype2') == 2 && node.a('rolltype1') == 1){
                byData.a('部分选中', node.a('rollnum2'));
            }
            } else if (node.a('type') == 2) {
                RollPieceID = node.a('rollnum2');
                byData.a('部分选中', node.a('rollnum2'));
            }
            
            byData.a('steelcode2', RollPieceID);
            comboBox.a('ht.value', RollPieceID);
            const url = `http://180.10.10.12:9003/api/sdf/sltbusfurtrack/mouseleftclick?Line=${Line}&RollPieceID=${RollPieceID}`;
            requestGet(url)
                .then(res => {
                    console.log('接口完整返回：', res);

                    const item = res?.Data?.[0];
                    console.log('接口返回第一项数据:', item);

                    if (item) {
                        setVirtualNodeProperty(virtualNode, 'SG_SIGN', item.SG_SIGN);
                        setVirtualNodeProperty(virtualNode, 'HEAT_NO', item.HEAT_NO);
                        setVirtualNodeProperty(virtualNode, 'IN_MAT_LEN', item.IN_MAT_LEN);
                        setVirtualNodeProperty(virtualNode, 'IN_MAT_WIDTH', item.IN_MAT_WIDTH);
                        setVirtualNodeProperty(virtualNode, 'IN_MAT_THICK', item.IN_MAT_THICK);
                        setVirtualNodeProperty(virtualNode, 'FurnEnTemper', item.FurnEnTemper);
                        setVirtualNodeProperty(virtualNode, 'FurnEnTime', item.FurnEnTime);
                        setVirtualNodeProperty(virtualNode, 'JunTime', item.IN_OAK_TIME);
                    } else {
                        console.error('返回数据格式不正确或缺少必要字段');
                    }

                    if (Array.isArray(res.Data) && res.Data.length > 0) {
                        const d = res.Data[0];
                        let values = [
                            d.ROLL_PLAN_NO,
                            d.TOTAL_MAT_NUM,
                            d.INFURN_NUM,
                            d.SG_SIGN,
                            d.HEAT_NO,
                            d.CROSS_CODE,
                            d.IN_MAT_LEN,
                            d.FurnEnWgt,
                            d.FurnEnTemper
                        ];
                        let nodeTag = node.getTag();
                        console.log(nodeTag)
                        let number = String(nodeTag).replace("Passes-", "");
                        steelcode.a('ht.value', number);
                        let nodetype = node.a('type')
                        steeltype.a('ht.value', nodetype);
                        values.forEach((val, index) => {
                            if (rollerlist[index]) {
                                rollerlist[index].a('ht.value', val);
                            }
                        });
                    } else {
                        console.warn('接口返回Data为空数组或格式错误:', res.Data);
                    }
                })
                .catch(error => {
                    // 错误处理（封装函数已做基础处理，这里可根据需要补充）
                    console.error('处理数据时发生错误:', error);
                });
        });

        // 点击弹窗本身不关闭
        virtualNode.s('onClick', function(event) {
            event.stopPropagation();
        });
    }
});

// ===== 全局点击事件：点击空白处关闭弹窗并重置状态 =====
graphView.getView().addEventListener('click', function (e) {
    var virtualNode = graphView.dm().getDataByTag('set'); // 弹窗节点
    // 确保弹窗是可见的情况下才处理
    if (virtualNode.s('2d.visible') === true) {
        // 优化判断条件，使用实际的弹窗元素标识
        const target = e.target;
            virtualNode.s('2d.visible', false);
            isClicked = false;

    }
});

    /**
     * 热轧钢坯生产控制系统 - 右键菜单配置模块
     * 
     * 此模块负责配置和管理系统中的右键菜单功能，支持多种操作场景：
     * 1. 支持单节点和多节点选中时的差异化菜单展示
     * 2. 根据不同节点类型（辊道、道次数据、钢坯等）显示对应操作项
     * 3. 提供钢坯位置调整、状态修改、道次管理、异常处理等核心功能
     * 
     * 菜单配置说明：
     * - 菜单项通过label和action属性定义显示文本和回调逻辑
     * - 特殊菜单项可通过fordata属性标识适用场景（如fordata=5表示多选操作）
     * - 菜单可见性通过visibleFunc动态控制，支持复杂业务规则判断
     * 
     * 
     * 设计原则：
     * 1. 遵循最少暴露原则，仅显示当前操作可执行的菜单项
     * 2. 保持菜单层级扁平，重要操作优先显示
     * 3. 所有菜单项操作均通过统一接口(handleMenuClick)进行分发
     * 
     * 注意事项：
     * - 修改菜单配置后需检查visibleFunc中的过滤规则是否需要同步调整
     * - 新增节点类型时需在此注释和visibleFunc中添加对应处理逻辑
     * - 菜单项action中的字符串参数需与业务处理模块保持一致
     */
// ===== 右键菜单配置 =====
const menuItems = [
    { label: "钢坯前进",  action: () => handleMenuClick("钢坯前进") },
    { label: "钢坯后退",  action: () => handleMenuClick("钢坯后退") },
    { label: "退回计划",  action: () => handleMenuClick("退回计划") },
    { label: "钢坯剔料",  action: () => handleMenuClick("钢坯剔料") },
    { label: "颜色绿色",  action: () => handleMenuClick("颜色绿色") },
    { label: "解除绿色",  action: () => handleMenuClick("解除绿色") },
    { label: "修改道次",  action: () => handleMenuClick("修改道次") },    
    { label: "查看计划",  action: () => handleMenuClick("查看计划") },
    { label: "查看实绩",  action: () => handleMenuClick("查看实绩") },
    { label: "异常录入",  action: () => handleMenuClick("异常录入") },
    { label: "异常查看",  action: () => handleMenuClick("异常查看") },
    { label: "1道次",  action: () => handleMenuClick("1道次") },
    { label: "2道次",  action: () => handleMenuClick("2道次") },
    { label: "1-2道次",  action: () => handleMenuClick("1-2道次") },
    { label: "钢坯回炉",  action: () => handleMenuClick("钢坯回炉") },
    { label: "返回辊道",  action: () => handleMenuClick("返回辊道") },
    { label: "前移",fordata:5,  action: () => handleMenuClick("部分前移") },
    { label: "后移",fordata:5,  action: () => handleMenuClick("部分后移") },
    { label: "炉前钢坯前移",  action: () => handleMenuClick("炉前钢坯前移") },
    { label: "炉前钢坯后移",  action: () => handleMenuClick("炉前钢坯后移") },
    { label: "炉前钢坯删除",  action: () => handleMenuClick("炉前钢坯删除") },
    { label: "炉前剔除",  action: () => handleMenuClick("炉前剔除") }       
    // ...其他菜单项按需添加
];

// ===== 创建并绑定右键菜单 =====
const contextmenu = new ht.widget.ContextMenu(menuItems);

/**
 * 右键前置处理：区分单选/多选，不破坏原有多选选区
 * 规则：
 * 1. 空白右键 → 不弹出菜单
 * 2. 当前是【单选/无选中】→ 将右键点击节点设为单选选中
 * 3. 当前是【多选】→ 保留原有多选选区，不做任何修改
 */
contextmenu.beforeShow = function(e) {
    const clickNode = graphView.getDataAt(e);
    // 空白区域右键，直接拦截
    if (!clickNode) {
        return false;
    }

    const sm = graphView.sm();
    // 兼容旧版HT：通过 toSelection().size 获取选中个数
    const selectDatas = sm.toSelection();
    const selectCount = selectDatas.size();

    // 场景1：无选中 或 当前是单选 → 将右键点击节点设为单选选中
    if (selectCount <= 1) {
        sm.setSelection(clickNode);
        console.log("单选场景，更新选中为右键节点：", clickNode.getTag());
    }
    // 场景2：当前是多选 → 不改动原有选中，直接放行，保留多选逻辑

    return true;
};

contextmenu.setVisibleFunc(item => {
    const datas = graphView.sm().toSelection(); // 获取选中数据
    const count = datas.size();
    if (count === 0) return false; // 没选中，菜单不显示
    // ✅ 多选时：通过datas.get(index)遍历节点，检查_displayName是否包含"Passes"
    if (count > 1) {
        let hasPassesNode = false;
        for (let i = 0; i < count; i++) {
            const node = datas.get(i);
            if (node._displayName.includes('Passes')) {
                hasPassesNode = true;
                break;
            }
        }
        return hasPassesNode ? item.fordata === 5 : false;
    }

    // ✅ 单选时：根据节点类型显示不同菜单
    const data = datas.get(0);
    if (!data) return false;
    const menuLabelMap = {
        rollertable: ["钢坯前进", "钢坯后退", "退回计划",  "颜色绿色", "解除绿色", "钢坯剔料", "修改道次", "查看计划", "查看实绩", "异常录入", "异常查看"],
        data123: ["1道次", "2道次", "1-2道次"],
        "Passes-1": ["退回计划", "返回辊道", "修改道次", "钢坯前进", "查看计划", "查看实绩", "异常录入", "异常查看"],
        "Passes-81": [ "钢坯回炉", "钢坯后退", "钢坯删除", "查看计划", "查看实绩", "异常录入", "异常查看"],
        inRoll: ["炉前钢坯前移", "炉前钢坯后移", "炉前钢坯删除", "炉前剔除"]
    };
    if (rollertable.includes(data) && data.getTag() !== "Passes-1" && data.getTag() !== "Passes-81") {
        return menuLabelMap.rollertable.includes(item.label);
    } else if (data === data123) {
        return menuLabelMap.data123.includes(item.label);
    } else if (data.getTag() === "Passes-1") {
        return menuLabelMap["Passes-1"].includes(item.label);
    } else if (data.getTag() === "Passes-81") {
        return menuLabelMap["Passes-81"].includes(item.label);
    } else if (steelLineShapesCollection.includes(data)) {
        return menuLabelMap.inRoll.includes(item.label);
    }

    return false; // 默认不显示
});
contextmenu.addTo(view);

// ===== 菜单点击事件分发处理 =====
function handleMenuClick(menuLabel) {
    function extractSelectedNodesInfo(graphView) {
        try {
            // 验证图形视图对象结构
            if (!graphView?.sm?.()?.toSelection) {
                console.error('错误: 图形视图选择模型API不可用');
                return null;
            }
            
            const datas = graphView.sm().toSelection();
            
            // 验证选中节点数据结构
            if (!datas || !Array.isArray(datas._as)) {
                console.error('错误: 选中节点数据结构异常');
                return null;
            }
            
            // 筛选有效节点（同时检查辊号和标签有效性）
            const filteredDatas = datas._as.filter(node => {
                const attrs = node._attrObject || {};
                const hasValidRollNum = (attrs.rollnum1?.trim() !== '') || (attrs.rollnum2?.trim() !== '');
                const tag = node._tag || node._displayName || '';
                const hasValidTag = String(tag).match(/Passes-\d+/);
                return hasValidRollNum && hasValidTag;
            });
            
            // 处理无有效节点的情况
            if (filteredDatas.length === 0) {
                console.log('提示: 没有找到符合条件的行');
                return {
                    hasData: false,
                    message: '未找到有效节点'
                };
            }
            
            // 从标签中提取编号（使用正则表达式增强健壮性）
            const extractNumber = (tag) => {
                const tagStr = String(tag || '');
                const match = tagStr.match(/Passes-(\d+)/);
                return match ? parseInt(match[1]) : null;
            };
            
            // 按标签中的数字对有效节点进行排序
            const sortedNodes = [...filteredDatas].sort((a, b) => {
                const numA = extractNumber(a._tag);
                const numB = extractNumber(b._tag);
                return (numA || 0) - (numB || 0);
            });
            
            // 获取首尾行节点（基于排序后的有效节点）
            let firstRow = sortedNodes[0];
            let lastRow = sortedNodes[sortedNodes.length - 1];
            
            // 二次验证尾行数据有效性
            // 如果尾行的tag无效或者辊号无效，则向前查找有效节点
            while (lastRow && 
                (!lastRow._tag || !lastRow._attrObject || 
                    !getValidRollNum(lastRow))) {
                const lastIndex = sortedNodes.indexOf(lastRow);
                if (lastIndex <= 0) {
                    // 如果已经检查到第一个节点仍然无效，则使用第一个节点作为尾行
                    console.warn('警告: 所有有效节点中只有首行数据有效，将使用首行作为尾行');
                    lastRow = firstRow;
                    break;
                }
                lastRow = sortedNodes[lastIndex - 1];
            }
            
            // 提前定义辅助函数（确保函数提升）
            function getValidRollNum(node) {
                if (!node._attrObject) return '';
                
                const attrs = node._attrObject;
                const rollnum1 = attrs.rollnum1?.trim() || '';
                const rollnum2 = attrs.rollnum2?.trim() || '';
                
                if (!rollnum1 && !rollnum2) {
                    console.warn(`警告: 节点 ${node._tag || '未知'} 缺少有效辊号`);
                    return '';
                }
                
                return rollnum1 || rollnum2;
            };

            // 提前定义辅助函数（确保函数提升）
            function getValidRollNum1(node) {
                if (!node._attrObject) return '';
                
                const attrs = node._attrObject;
                const rollnum1 = attrs.rollnum1?.trim() || '';
                const rollnum2 = attrs.rollnum2?.trim() || '';
                
                if (!rollnum2 && !rollnum1) {
                    console.warn(`警告: 节点 ${node._tag || '未知'} 缺少有效辊号`);
                    return '';
                }
                
                return rollnum2 || rollnum1;
            };
            
            // 构建结果对象（暴露为接口参数）
            const result = {
                hasData: true,
                firstRow: {
                    tag: firstRow._tag || '',
                    number: extractNumber(firstRow._tag),
                    rollNum: getValidRollNum1(firstRow)
                },
                lastRow: {
                    tag: lastRow._tag || '',
                    number: extractNumber(lastRow._tag),
                    rollNum: getValidRollNum(lastRow)
                },
                totalNodes: filteredDatas.length
            };
            
            // 打印结果到控制台
            console.log('提取结果:', JSON.stringify(result, null, 2));
            return result;
            
        } catch (error) {
            console.error('致命错误: 提取节点信息时发生异常', error);
            return null;
        }
    }

    /**
     * 获取提取结果中的关键参数（接口参数暴露）
     * @param {ExtractionResult} result - 提取结果
     * @returns {Object} 包含接口参数的对象
     */
    function getInterfaceParameters(result) {
        if (!result || !result.hasData) {
            return {
                success: false,
                message: '无有效数据'
            };
        }
        
        return {
            success: true,
            firstNumber: result.firstRow.number,
            lastNumber: result.lastRow.number,
            firstRollNum: result.firstRow.rollNum,
            lastRollNum: result.lastRow.rollNum,
            totalNodes: result.totalNodes
        };
    }
    const result = extractSelectedNodesInfo(graphView);
    const params = getInterfaceParameters(result);
    let firstNumber,lastNumber,firstRollNum,lastRollNum;
    if (params.success) {
      firstNumber = params.firstNumber;
      lastNumber = params.lastNumber;
      firstRollNum = params.firstRollNum;
      lastRollNum = params.lastRollNum;
      console.log(`首行编号: ${params.firstNumber}`);
      console.log(`尾行编号: ${params.lastNumber}`);
      console.log(`首行辊号: ${params.firstRollNum}`);
      console.log(`尾行辊号: ${params.lastRollNum}`);
    }
    // 当前选中节点
    const data = graphView.sm().ld();
    // 炉前钢坯参数
    let steelSlabNo = data.s('label');
    // 炉内钢坯参数
    const line = data.a("Line") || "B101"; 
    var rollid = graphView.dm().getDataByTag('rollid');
    // 根据选中节点的type属性确定钢坯号（type=1/3取rollnum1, type=2取rollnum2）
    let select = data.a("type")
    let slabNo = "";
    if (select == 1 || select == 3) {
        slabNo = data.a("rollnum1");
        rollid.a('ht.value',data.a("rollnum1"));
    } else if (select == 2) {
        slabNo = data.a("rollnum2");
        rollid.a('ht.value',data.a("rollnum2"));
    }
    // ===== 菜单分支路由 =====
    switch (menuLabel) {
        case "钢坯前进":
            requestForward(line,slabNo);
            break;
        case "钢坯后退":
            requestBack(line,slabNo);
            break;
        case "退回计划":
            // 自动装炉模式下拦截退回计划操作，仅手动模式可执行
            var autoModeNode = graphView.dm().getDataByTag('自动模式');
            if (autoModeNode && autoModeNode.a('name') === '自动装炉模式') {
                showToast('手动模式才可操作退回计划');
            } else {
                requestDelete1(line,slabNo);
            }
            break;
        case "钢坯剔料":
        // 检查是否有选中的数据
        const wset = graphView.sm().ld();
            if (!wset) {
            alert("请先选择一个节点");
            return;
        }
        // 获取接口类型
        var bydata = graphView.dm().getDataByTag('ByData');
        bydata.a('diamtext1', slabNo);
        console.log(bydata);
        var window = graphView.dm().getDataByTag('再次确认');
        // 如果是右键菜单点击，可能需要从 contextmenu 事件中获取位置
        const set = wset.getPosition();
        window.setPosition(set.x - 100, set.y - 100);
        window.s('2d.visible', true);
            break;
        case "钢坯回炉":
            requestRecycle(line,slabNo);
            break;
        case "返回辊道":
            // 自动装炉模式下拦截返回辊道操作，仅手动模式可执行
            var autoModeNode = graphView.dm().getDataByTag('自动模式');
            if (autoModeNode && autoModeNode.a('name') === '自动装炉模式') {
                showToast('手动模式才可操作返回辊道');
            } else {
                requestReroll(line,slabNo);
            }
            break;
        case "颜色绿色":
            requestSetGreen(line,slabNo);
            break;
        case "解除绿色":
            requestFreeGreen(line,slabNo);
            break;
        case "修改道次":
        // 检查是否有选中的数据
        const data = graphView.sm().ld();
            if (!data) {
            alert("请先选择一个节点");
            return;
        }
    
        // 获取道次修改节点
        var rollchange = graphView.dm().getDataByTag('修改道次');
    
        // 检查节点是否存在
        if (!rollchange) {
            console.error("未找到标签为 '修改道次' 的数据项");
            alert("道次修改功能暂时不可用");
            return;
        }
    
        // 如果是右键菜单点击，可能需要从 contextmenu 事件中获取位置
        const point = data.getPosition();
        rollchange.setPosition(point.x - 100, point.y - 100);
        rollchange.s('2d.visible', true);
            break;
        case "查看计划":
            requestPlanView();
            break;
        case "查看实绩":
            requestSteelView();
            break;
        case "1道次":
            requestSetOne(line);
            break;
        case "2道次":
            requestSetTwo(line);
            break;
        case "1-2道次":
            requestSetFull(line);
            break;
        case "部分前移":
            requestOtherMove(line,firstNumber,lastNumber,firstRollNum,lastRollNum);
            break;
        case "部分后移":
            requestOtherBack(line,firstNumber,lastNumber,firstRollNum,lastRollNum);
            break;
        case "炉前钢坯前移":
            requestSomeMove(line,steelSlabNo);
            break;
        case "炉前钢坯后移":
            requestSomeBack(line,steelSlabNo);
            break;
        case "炉前钢坯删除":
            requestSomeDelete(line,steelSlabNo);
            break;
        case "炉前剔除":
            requestDeleteSteel(line,slabNo);
            break;
        default:
            console.warn("未处理的菜单项:", menuLabel);
    }
}

// ===== API接口函数（各菜单操作对应的后端API调用） =====
// 已注释的通用GET请求封装见下方

// 钢坯前进：单步前移
//     const query = new URLSearchParams(params).toString();
//     // 处理没有参数的情况，避免出现多余的问号
//     const fullUrl = query ? `${url}?${query}` : url;
    
//     // 获取token（假设存储在localStorage中）
//     const token = localStorage.getItem('token');
    
//     // 配置请求头
//     const headers = {};
//     if (token) {
//         headers['Authorization'] = `Bearer ${token}`;
//     }

//     // 返回Promise，让调用者可以处理结果
//     return fetch(fullUrl, { headers })
//         .then(response => {
//             if (!response.ok) throw new Error(`HTTP 错误! 状态码: ${response.status}`);
//             return response.json();
//         })
//         .then(data => {
//             console.log(data);
//             if (data.Message) {
//                 showToast(data.Message);
//             }
//             return data; // 返回数据给调用者
//         })
//         .catch(error => {
//             console.error('请求失败:', error);
//             showToast('请求失败，请稍后重试');
//             throw error; // 重新抛出错误，让调用者可以捕获
//         });
// }

// ✅ 实际接口：钢坯前进
function requestForward(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/singleforwardslab";
    requestGet(url, { Line: line , SlabNo: slabNo });
}

// 钢坯后退：单步后移
function requestBack(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/singlebackwardslab";
    requestGet(url, { Line: line , SlabNo: slabNo });
}

// 退回计划：删除钢坯/退回计划队列
function requestDelete1(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/delslab";
    requestGet(url, { Line: line , SlabNo: slabNo });
}

// 钢坯剔料：炉前剔除钢坯
function requestDelete(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/prefurnslabdel1";
    requestGet(url, { Line: line , SlabNo: slabNo });
}

// 钢坯回炉：退回炉内
function requestRecycle(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/slabexfurnback";
    requestGet(url, { Line: line, SlabNo: slabNo});
}

// 返回辊道：钢坯回辊道
function requestReroll(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/slabenfurnbackroll";
    requestGet(url, { Line: line, SlabNo: slabNo});
}

// 颜色绿色：标记绿色
function requestSetGreen(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/greencolor";
    requestGet(url, { Line: line, SlabNo: slabNo, Mode:1});
}

// 解除绿色：取消绿色标记
function requestFreeGreen(line,slabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/greencolor";
    requestGet(url, { Line: line, SlabNo: slabNo, Mode:0});
}

// 查看计划：打开计划页面
function requestPlanView() {
     window.open('http://180.10.10.11/#/4612662880283447089/4724822277387092528/5223466305295119648', '_blank'); // 在新标签页打开
}

// 查看实绩：打开实绩页面
function requestSteelView() {
    window.open('http://180.10.10.11/#/4612662880283447089/4724822277387092528/4676890284400059628', '_blank'); // 在新标签页打开
}

// 1道次：设定第1道次
function requestSetOne(line) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/slabenfurn";
    const inSteelCode = byData.a('steelcode1');
    requestGet(url, { Line: line, Col: 1,SlabNo: inSteelCode});
}

// 2道次：设定第2道次
function requestSetTwo(line) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/slabenfurn";
    const inSteelCode = byData.a('steelcode1');
    requestGet(url, { Line: line, Col: 2,SlabNo: inSteelCode});
}

// 1-2道次：设定全部道次
function requestSetFull(line) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/slabenfurn";
    const inSteelCode = byData.a('steelcode1');
    requestGet(url, { Line: line, Col: 3,SlabNo: inSteelCode});
}

// 部分前移：多选节点前移
function requestOtherMove(line,firstNumber,lastNumber,firstRollNum,lastRollNum) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/forwardslab2";
    requestGet(url, { Line: line, StartIndex: firstNumber, EndIndex: lastNumber, StartSlabNo: firstRollNum, EndSlabno: lastRollNum});
}

// 部分后移：多选节点后移
function requestOtherBack(line,firstNumber,lastNumber,firstRollNum,lastRollNum) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/backwardslab2";
    requestGet(url, { Line: line, StartIndex: firstNumber, EndIndex: lastNumber, StartSlabNo: firstRollNum, EndSlabno: lastRollNum});
}

// 炉前钢坯前移
function requestSomeMove(line,steelSlabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/prefurnslabforward";
    requestGet(url, { Line: line, SlabNo: steelSlabNo});
}

// 炉前钢坯后移
function requestSomeBack(line,steelSlabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/prefurnslabbackward";
    requestGet(url, { Line: line, SlabNo: steelSlabNo});
}

// 炉前钢坯删除
function requestSomeDelete(line,steelSlabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/prefurnslabdel";
    requestGet(url, { Line: line, SlabNo: steelSlabNo});
}


// 炉前剔除
function requestDeleteSteel(line,steelSlabNo) {
    const url = "http://180.10.10.12:9003/api/sdf/sltbusfurtrack/prefurnslabdel1";
    requestGet(url, { Line: line, SlabNo: steelSlabNo});
}



// ===== 全局交互事件：返回辊道按钮可用性切换 =====
// 仅当点击passes-1节点时，"返回辊道"按钮才可操作
graphView.mi(e => {
    const data = e.data;
    let back = graphView.dm().getDataByTag('返回辊道');               
    switch (e.kind) {
    case 'clickData':
       if (data.getTag() === "Passes-1"){
           back.s('2d.selectable', true);
           back.s('2d.gray', false);
       }else{
           back.s('2d.selectable', false);
           back.s('2d.gray', true);
       }
    break;
    }
});

dm.getDatas().each(node => trySetDoubleClickHandlerForNode(node));

// ===== 出炉计时模块 =====
// 通过监听Passes-81节点的rollcolor属性变化来判断钢坯是否出炉
// rollcolor='0' 表示不可见（出炉中），开始计时；恢复非'0'则停止计时
    // 计时相关变量
    let hiddenStartTime = null;  // 隐藏开始时间
    let updateTimer = null;      // 定时器引用
    // 获取数据模型和目标节点
    const timeText =  graphView.dm().getDataByTag('出炉计时');
    // 时间格式化工具
    function formatDuration(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const days = Math.floor(totalSeconds / (24 * 60 * 60));
        const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
        const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
        const seconds = totalSeconds % 60;
        timeText.s('text', `${days}天${hours}时${minutes}分${seconds}秒`)
        return `${days}天${hours}时${minutes}分${seconds}秒`;
    }

    // 实时更新隐藏时长
    function updateHiddenDuration() {
        if (hiddenStartTime) {
            const currentDuration = new Date() - hiddenStartTime;
            const formatted = formatDuration(currentDuration);
            console.log(`当前隐藏时长：${formatted}`);
        }
    }

    // 重置所有计时状态
    function resetTimer() {
        timeText.s('text', '出炉中')
        if (updateTimer) {
            clearInterval(updateTimer);
            updateTimer = null;
        }
        hiddenStartTime = null;
    }

    // 开始计时（仅在节点不可见时调用）
    function startTimer() {
        resetTimer();
        hiddenStartTime = new Date();
        console.log('节点不可见，开始计时...');
        updateTimer = setInterval(updateHiddenDuration, 1000);
        updateHiddenDuration(); // 立即更新一次
    }


    // 初始检查：节点已存在时检查当前出炉状态
    if (lastone && timeText) {
        const initialVisible = lastone.a('rollcolor');
        console.log(`初始rollcolor值：${initialVisible}`);
        
        // 若初始状态为不可见（false），直接启动计时
        if (initialVisible === '0') {
            startTimer();
        } else {
            timeText.s('text', '出炉中');
        }
    }

    // 画面初始化：根据自动模式节点的isZiDong属性，设置data123、整批炉内改计划的2d.gray和2d.selectable
    (function initAutoModeState() {
        var autoModeNode = graphView.dm().getDataByTag('自动模式');
        if (!autoModeNode) return;
        var isZiDong = autoModeNode.a('isZiDong');
        var gaiPlan = graphView.dm().getDataByTag('整批炉内改计划');
        // isZiDong: '1'=自动装炉模式(灰显不可选), '0'=手动装炉模式(正常可选)
        if (isZiDong === '1') {
            if (data123) {
                data123.s('2d.gray', true);
                data123.s('2d.selectable', false);
            }
            if (gaiPlan) {
                gaiPlan.s('2d.gray', true);
                gaiPlan.s('2d.selectable', false);
            }
        } else {
            // 手动模式或未赋值时，默认设为可操作状态
            if (data123) {
                data123.s('2d.gray', false);
                data123.s('2d.selectable', true);
            }
            if (gaiPlan) {
                gaiPlan.s('2d.gray', false);
                gaiPlan.s('2d.selectable', true);
            }
        }
    })();
// =========================
// WillInOutPopup.js — 待入炉/待出炉钢坯数据弹窗（上下堆叠布局）
// 样式、DOM、解析全由本文件自管，PopupManager 只做注册和调度
// =========================

(function _register() {
  if (typeof PopupManager === 'undefined') {
    setTimeout(_register, 100);
    return;
  }
  PopupManager.register('will-in-out', {

  // ── 字段定义 ──
  _FIELD_LABELS: {
    cardNo:      '卡号',
    sortNumber:  '排序号',
    inMatNo:     '入炉钢坯号',
    steelGrade:  '钢种',
    heatNo:      '炉号',
    inMatThick:  '厚度(mm)',
    inMatWidth:  '宽度(mm)',
    inMatLen:    '长度(mm)',
    inMatWt:     '重量(kg)',
    rollPlanNo:  '轧制计划号'
  },

  _FIELD_ORDER: [
    'cardNo','sortNumber','inMatNo','steelGrade','heatNo',
    'inMatThick','inMatWidth','inMatLen','inMatWt','rollPlanNo'
  ],

  _LEVEL_COLORS: {
    info:  'linear-gradient(135deg, #2c7be5, #00b8d4)',
    warn:  'linear-gradient(135deg, #e57320, #f0a030)',
    error: 'linear-gradient(135deg, #d32f2f, #e53935)'
  },

  // =========================
  // render
  // =========================
  render: function (rawData, closeFn) {
    var self = this;
    var ctx = this._buildContext(rawData);

    // 遮罩
    var mask = document.createElement('div');
    mask.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.15);z-index:10000;';
    mask.addEventListener('click', function (e) {
      if (e.target === mask) closeFn();
    });

    // 弹窗容器 — 宽度按是否有两组数据自适应
    var popupWidth = (ctx.hasWillIn && ctx.hasWillOut) ? '780px' : '480px';
    var el = document.createElement('div');
    el.style.cssText =
      'position:absolute;top:50%;left:50%;' +
      'transform:translate(-50%,-50%) scale(0.9);' +
      'width:' + popupWidth + ';background:#fff;border-radius:6px;' +
      'box-shadow:0 6px 20px rgba(0,0,0,0.2);' +
      'opacity:0;transition:all .2s ease;' +
      'font-family:"Microsoft YaHei","PingFang SC",sans-serif;overflow:hidden;';

    el.innerHTML = self._buildHTML(ctx);

    // 注入样式
    var styleEl = document.createElement('style');
    styleEl.textContent =
      '.wi-table{width:100%;border-collapse:collapse;font-size:13px;color:#333;}' +
      '.wi-table-label{padding:6px 10px;border:1px solid #e8e8e8;background:#fafafa;color:#666;white-space:nowrap;width:32%;}' +
      '.wi-table-value{padding:6px 10px;border:1px solid #e8e8e8;color:#222;font-weight:500;}';
    el.appendChild(styleEl);

    var closeBtn = el.querySelector('.wi-close-btn');
    if (closeBtn) closeBtn.onclick = closeFn;

    mask.appendChild(el);
    document.body.appendChild(mask);

    requestAnimationFrame(function () {
      el.style.transform = 'translate(-50%, -50%) scale(1)';
      el.style.opacity = '1';
    });

    return {
      close: function () {
        el.style.transform = 'translate(-50%, -50%) scale(0.9)';
        el.style.opacity = '0';
        setTimeout(function () {
          if (mask.parentNode) mask.remove();
        }, 200);
      },
      update: function (newRawData) {
        var newCtx = self._buildContext(newRawData);
        self._updateDOM(el, newCtx);
      }
    };
  },

  // =========================
  // buildContext
  // =========================
  _buildContext: function (rawData) {
    var inData  = rawData.willIn  || null;
    var outData = rawData.willOut || null;

    var inTime  = (inData  && inData.msgTime)  || '';
    var outTime = (outData && outData.msgTime) || '';

    return {
      title:        '加热炉钢坯跟踪',
      hasWillIn:    !!inData,
      hasWillOut:   !!outData,
      inFurnace:    (inData  && inData.furnaceCode) || '-',
      outFurnace:   (outData && outData.furnaceCode) || '-',
      inTimestamp:  inTime,
      outTimestamp: outTime,
      inPayload:    (inData  && inData.data)  || {},
      outPayload:   (outData && outData.data) || {}
    };
  },

  // =========================
  // buildPanelHTML：生成一个数据面板
  // =========================
  _buildPanelHTML: function (subTitle, level, furnaceCode, timestamp, data) {
    var titleBg = this._LEVEL_COLORS[level] || this._LEVEL_COLORS.info;
    var rows = '';
    var fieldOrder = this._FIELD_ORDER;
    var labels = this._FIELD_LABELS;
    for (var j = 0; j < fieldOrder.length; j++) {
      var key = fieldOrder[j];
      var val = (data[key] != null) ? data[key] : '-';
      rows +=
        '<tr>' +
          '<td class="wi-table-label">' + (labels[key] || key) + '</td>' +
          '<td class="wi-table-value">' + val + '</td>' +
        '</tr>';
    }
    return (
      '<div class="wi-panel" style="flex:1;min-width:0;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden;">' +
        '<div class="wi-panel-header" style="' +
          'height:34px;line-height:34px;padding:0 12px;background:' + titleBg +
          ';color:#fff;font-weight:600;font-size:14px;display:flex;justify-content:space-between;align-items:center;">' +
          '<span>' + subTitle + '</span>' +
          '<span style="font-size:12px;font-weight:400;opacity:0.85;">' +
            '炉号：' + furnaceCode + (timestamp ? ' ｜ ' + timestamp : '') +
          '</span>' +
        '</div>' +
        '<table class="wi-table"><tbody>' + rows + '</tbody></table>' +
      '</div>'
    );
  },

  // =========================
  // buildHTML
  // =========================
  _buildHTML: function (ctx) {
    var hasBoth = ctx.hasWillIn && ctx.hasWillOut;

    // 构建面板区域
    var panelsHTML = '';
    if (ctx.hasWillIn) {
      panelsHTML += this._buildPanelHTML(
        '待入炉', 'info', ctx.inFurnace, ctx.inTimestamp, ctx.inPayload
      );
    }
    if (hasBoth) {
      panelsHTML += '<div class="wi-panel-gap" style="width:14px;flex-shrink:0;"></div>';
    }
    if (ctx.hasWillOut) {
      panelsHTML += this._buildPanelHTML(
        '待出炉', 'warn', ctx.outFurnace, ctx.outTimestamp, ctx.outPayload
      );
    }

    // 标题渐变色：两者都有则用 info，只有出炉用 warn
    var titleBg = ctx.hasWillOut && !ctx.hasWillIn
      ? this._LEVEL_COLORS.warn
      : this._LEVEL_COLORS.info;

    // 取最新时间戳
    var latestTime = ctx.outTimestamp || ctx.inTimestamp || '';

    return (
      '<div class="wi-title" style="' +
        'height:42px;line-height:42px;padding:0 16px;background:' + titleBg +
        ';color:#fff;font-weight:600;font-size:16px;display:flex;justify-content:space-between;align-items:center;">' +
        '<span>' + ctx.title + '</span>' +
        '<span class="wi-title-time" style="font-size:12px;font-weight:400;opacity:0.85;">' + latestTime + '</span>' +
      '</div>' +
      // 面板区
      '<div class="wi-body" style="display:flex;padding:16px;align-items:flex-start;">' + panelsHTML + '</div>' +
      // 关闭按钮
      '<div style="display:flex;justify-content:center;padding:0 0 20px;">' +
        '<div class="wi-close-btn" style="' +
          'width:100px;height:36px;line-height:36px;text-align:center;' +
          'background:#2c7be5;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;' +
        '">关闭</div>' +
      '</div>'
    );
  },

  // =========================
  // updateDOM：局部刷新
  // =========================
  _updateDOM: function (el, ctx) {
    var titleBg = ctx.hasWillOut && !ctx.hasWillIn
      ? this._LEVEL_COLORS.warn
      : this._LEVEL_COLORS.info;

    // 标题
    var titleBar = el.querySelector('.wi-title');
    if (titleBar) {
      titleBar.style.background = titleBg;
      var spans = titleBar.querySelectorAll('span');
      if (spans[0]) spans[0].textContent = ctx.title;
      if (spans[1]) spans[1].textContent = ctx.outTimestamp || ctx.inTimestamp || '';
    }

    // 面板 — 按 .wi-panel 顺序更新
    var panels = el.querySelectorAll('.wi-panel');
    var datasets = [];
    if (ctx.hasWillIn)  datasets.push({ payload: ctx.inPayload, furnace: ctx.inFurnace, time: ctx.inTimestamp, label: '待入炉' });
    if (ctx.hasWillOut) datasets.push({ payload: ctx.outPayload, furnace: ctx.outFurnace, time: ctx.outTimestamp, label: '待出炉' });

    var fieldOrder = this._FIELD_ORDER;
    for (var p = 0; p < panels.length && p < datasets.length; p++) {
      var d = datasets[p];

      // 面板头部
      var header = panels[p].querySelector('.wi-panel-header');
      if (header) {
        var hSpans = header.querySelectorAll('span');
        if (hSpans[0]) hSpans[0].textContent = d.label;
        if (hSpans[1]) hSpans[1].textContent = '炉号：' + d.furnace + (d.time ? ' ｜ ' + d.time : '');
      }

      // 面板表格
      var vals = panels[p].querySelectorAll('.wi-table-value');
      for (var j = 0; j < fieldOrder.length && j < vals.length; j++) {
        vals[j].textContent = (d.payload[fieldOrder[j]] != null) ? d.payload[fieldOrder[j]] : '-';
      }
    }
  }

  });
})();


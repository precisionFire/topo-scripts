// =========================
// RecognitionDialog.js — 炉号识别不一致报警弹窗
// 样式、DOM、解析、去重全由本文件自管，PopupManager 只做注册和调度（类型 'recognition'）
// 外部调用：PopupManager.show('recognition', rawData)
// 缓存机制与 ConflictDialog 一致：localStorage 缓存 + 点击确认一次后不再显示
// 当前仅中棒线加热炉画面使用
//
// 多炉号合并显示：A1/A2 任一炉先报警即弹窗，另一炉后报警则追加面板一并显示（不互相顶掉）
//
// 【版本记录】
//   v1.5  2026-08-27  支持 A1/A2 多炉号合并显示：后完成的炉子追加面板，确认时各炉分别存缓存
//   v1.4  2026-08-27  去重逻辑移入 render/update 内部（返回 null 取消显示），PopupManager 恢复纯管理
//   v1.3  2026-08-27  纯注册形态（与 WillInOutPopup 一致）
//   v1.2  2026-08-27  统一由 PopupManager 管理，render 独立构建 DOM
//   v1.1  2026-08-27  缓存 key 与缓存数据加入产线编码（中棒=B1），便于多产线拓展
// =========================

(function _register() {
  if (typeof PopupManager === 'undefined') {
    setTimeout(_register, 100);
    return;
  }

  var MAX_CACHE = 5;

  // 产线编码：中棒线 = B1。缓存 key 前缀，多产线并存时互不干扰，后续拓展只改此处
  var LINE_CODE = 'B1';

  // 内存去重集合：防止同一报警在确认前被反复触发弹窗
  var _shownSet = {};

  // =========================
  // 报警指纹（localStorage 和内存共用同一套去重key）
  // =========================
  function fingerprint(data) {
    return (data.furnaceCode || '') + '|' + (data.cardNo || '') + '|' + (data.inMatNo || '') + '|' + (data.trackHeatNo || '') + '|' + (data.systemHeatNo || '');
  }

  // =========================
  // localStorage 缓存工具
  // =========================
  function getCacheKey(furnaceCode) {
    return 'recognition_cache_' + LINE_CODE + '_' + (furnaceCode || 'unknown');
  }

  function loadCache(furnaceCode) {
    try {
      var raw = localStorage.getItem(getCacheKey(furnaceCode));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveToCache(furnaceCode, data) {
    var cache = loadCache(furnaceCode);
    // 缓存数据打上产线标记，便于识别数据来源产线
    var record = Object.assign({}, data, { lineCode: LINE_CODE });
    cache.unshift(record);
    if (cache.length > MAX_CACHE) {
      cache = cache.slice(0, MAX_CACHE);
    }
    try {
      localStorage.setItem(getCacheKey(furnaceCode), JSON.stringify(cache));
    } catch (e) {}
  }

  // =========================
  // 业务层去重判断（本组件内部逻辑，PopupManager 不参与）
  // =========================
  function isDuplicate(data) {
    var fp = fingerprint(data);
    // 内存去重（即时拦截同一事件多次触发）
    if (_shownSet[fp]) return true;
    // localStorage 去重（跨会话/跨页面）
    var cache = loadCache(data.furnaceCode);
    for (var i = 0; i < cache.length; i++) {
      if (fingerprint(cache[i]) === fp) return true;
    }
    return false;
  }

  function shouldShow(rawData) {
    if (!rawData) return false;
    // 已显示过或已确认过的报警不重复弹窗
    if (isDuplicate(rawData)) {
      return false;
    }
    return true;
  }

  // =========================
  // 面板行（表格行）
  // =========================
  function row(label, value, highlight) {
    return '<tr>' +
      '<td style="width:36%;padding:8px 12px;border:1px solid #e8e8e8;background:#fafafa;color:#888;">' + label + '</td>' +
      '<td style="padding:8px 12px;border:1px solid #e8e8e8;' + (highlight ? 'color:#e74c3c;font-weight:600;' : '') + '">' + value + '</td>' +
    '</tr>';
  }

  // =========================
  // 面板区 HTML（按炉号逐个生成，炉间留间隙）
  // =========================
  function buildPanelsHTML(records) {
    var html = '';
    var keys = Object.keys(records);
    for (var i = 0; i < keys.length; i++) {
      var r = records[keys[i]];
      var fmt = function (v) { return v != null && v !== '' ? String(v) : '-'; };
      if (i > 0) {
        html += '<div style="width:14px;flex-shrink:0;"></div>';
      }
      html +=
        '<div style="flex:1;min-width:0;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden;">' +
          '<div style="height:34px;line-height:34px;padding:0 12px;background:#e74c3c;color:#fff;font-weight:600;font-size:14px;display:flex;justify-content:space-between;align-items:center;">' +
            '<span>' + fmt(r.furnaceCode) + '炉</span>' +
            '<span style="font-size:12px;font-weight:400;opacity:0.85;">' + fmt(r.msgTime) + '</span>' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;font-size:13px;color:#333;"><tbody>' +
            row('卡号', fmt(r.cardNo)) +
            row('钢坯号', fmt(r.inMatNo)) +
            row('跟踪炉号', fmt(r.trackHeatNo)) +
            row('炉前识别炉号', fmt(r.systemHeatNo), true) +
          '</tbody></table>' +
        '</div>';
    }
    return html;
  }

  // =========================
  // render：构建弹窗 DOM（由 PopupManager 调用）
  //   返回 null 表示业务层判断本次不显示
  //   返回 { update, close }
  // =========================
  function render(rawData, closeFn) {
    // ── 业务层去重：不通过则不显示（返回 null 由 PopupManager 忽略）──
    if (!shouldShow(rawData)) return null;
    // 内存标记，阻断后续同指纹的调用（update 也据此保持现有弹窗）
    _shownSet[fingerprint(rawData)] = true;

    // 各炉记录集合：key = furnaceCode，value = 该炉最新一条报警
    var records = {};
    records[rawData.furnaceCode] = rawData;

    // ===== 遮罩层 =====
    const mask = document.createElement('div');
    mask.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.1);
      z-index: 10000;
    `;

    // ===== 弹窗 =====
    const el = document.createElement('div');
    el.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      width: 460px;
      background: #fff;
      border-radius: 6px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
      opacity: 0;
      transition: all .2s ease;
      font-family: sans-serif;
      overflow: hidden;
    `;

    el.innerHTML = `
      <!-- 标题栏 -->
      <div class="dialog-title" style="
        height: 40px;
        line-height: 40px;
        padding: 0 16px;
        background: #e74c3c;
        color: #fff;
        font-weight: 500;
        font-size: 16px;
      ">炉号识别不一致</div>

      <!-- 基本信息行 -->
      <div style="
        display: flex;
        align-items: center;
        gap: 24px;
        padding: 16px 20px 12px;
        background: #f8f9fa;
        border-bottom: 1px solid #eee;
        font-size: 13px;
        color: #666;
      ">
        <span><b>炉号：</b><span class="rg-furnaces"></span></span>
        <span style="flex:1;text-align:right;color:#999;" class="rg-time"></span>
      </div>

      <!-- 报警面板区（多炉并排） -->
      <div style="padding: 16px 20px;">
        <div class="rg-body" style="display:flex;align-items:flex-start;"></div>

        <!-- 报警说明 -->
        <div style="
          margin-top: 12px;
          padding: 10px 12px;
          background: #fdf0ef;
          border: 1px solid #f5c6c0;
          border-radius: 4px;
          font-size: 12px;
          color: #a94442;
          line-height: 1.6;
        ">
          炉前识别炉号与跟踪炉号不一致，请核实钢坯信息。
        </div>
      </div>

      <!-- 底部按钮 -->
      <div style="
        display:flex;
        justify-content:center;
        gap:16px;
        padding:8px 0 20px;
      ">
        <div class="recognition-confirm" style="
          width: 100px;
          height: 36px;
          line-height: 36px;
          text-align: center;
          background: #e74c3c;
          color: #fff;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        ">确认</div>
      </div>
    `;

    mask.appendChild(el);
    document.body.appendChild(mask);

    // ===== 记录可刷新节点 =====
    var dom = {
      furnaces: el.querySelector('.rg-furnaces'),
      time:     el.querySelector('.rg-time'),
      body:     el.querySelector('.rg-body')
    };

    // ===== 内容填充/刷新 =====
    function refresh() {
      var keys = Object.keys(records);
      // 基本信息行：炉号集合 + 最新报警时间
      dom.furnaces.textContent = keys.join('、') || '-';
      var latestTime = '';
      for (var i = 0; i < keys.length; i++) {
        if (records[keys[i]].msgTime) latestTime = records[keys[i]].msgTime;
      }
      dom.time.textContent = latestTime || '-';
      // 面板区重建
      dom.body.innerHTML = buildPanelsHTML(records);
      // 单炉 460px，双炉 780px
      el.style.width = keys.length > 1 ? '780px' : '460px';
    }
    refresh();

    // ===== 按钮事件 =====
    el.querySelector('.recognition-confirm').onclick = closeFn;

    // ===== 点击遮罩关闭 =====
    mask.addEventListener('click', function (e) {
      if (e.target === mask) closeFn();
    });

    // 入场动画
    requestAnimationFrame(function () {
      el.style.transform = 'translate(-50%, -50%) scale(1)';
      el.style.opacity = '1';
    });

    return {
      /**
       * update：新数据到达时调用（PopupManager 单例下不会关闭现有弹窗）
       * 去重：重复指纹忽略（保持现有弹窗）；新指纹则按炉号并入/刷新面板
       */
      update: function (newRawData) {
        if (!newRawData) return;
        var fp = fingerprint(newRawData);
        // 同指纹（同炉同钢坯同炉号）已显示过，忽略
        if (_shownSet[fp]) return;
        if (isDuplicate(newRawData)) return;
        _shownSet[fp] = true;
        // 记录该炉最新报警（新炉子追加，已有炉子替换）
        records[newRawData.furnaceCode] = newRawData;
        refresh();
      },
      close: function () {
        // 点击确认/关闭时，各炉分别缓存到 localStorage
        for (var k in records) {
          if (records.hasOwnProperty(k)) {
            saveToCache(k, records[k]);
          }
        }
        el.style.transform = 'translate(-50%, -50%) scale(0.9)';
        el.style.opacity = '0';
        setTimeout(function () {
          if (mask.parentNode) mask.remove();
        }, 200);
      }
    };
  }

  // =========================
  // 注册到 PopupManager
  // =========================
  PopupManager.register('recognition', {
    render: render
  });
})();

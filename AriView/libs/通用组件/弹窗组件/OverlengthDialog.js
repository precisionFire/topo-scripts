// =========================
// OverlengthDialog.js — 钢坯长度超限报警弹窗
// 样式、DOM、解析、去重全由本文件自管，PopupManager 只做注册和调度（类型 'overlength'）
// 外部调用：PopupManager.show('overlength', rawData)
//
// rawData 结构（由中棒线加热炉.js renderFurnaceInsideLayer 提供）:
//   {
//     furnaceCode: 'A1' | 'A2',                          // 炉号
//     msgTime: '2026-09-03 14:00:00',                    // 数据到达时间（可空）
//     items: [ { inMatNo, pos, lengthMm }, ... ]          // 该炉当前所有 >10000mm 的超长钢坯
//   }
//
// 触发/去重规则（与 ConflictDialog/RecognitionDialog 一致，按"炉号|钢坯号"指纹）:
//   快照中出现未确认过的超长钢坯才弹窗；确认后同钢坯号不再重复弹（跨会话由 localStorage 拦截）
//   同钢坯在炉内跨道次移动不算新报警（指纹不含道次）
// 多炉合并显示：A1/A2 任一炉先报警即弹窗，另一炉后报警则追加面板一并显示（不互相顶掉）
//
// 当前仅中棒线加热炉画面使用
//
// 【版本记录】
//   v1.0  2026-09-03  初版：炉内钢坯长度 >10000mm 报警，显示超长总数与具体道次
// =========================

(function _register() {
  if (typeof PopupManager === 'undefined') {
    setTimeout(_register, 100);
    return;
  }

  // 超长钢坯可能多根并存，缓存容量取大些（每炉记录最近确认的钢坯号）
  var MAX_CACHE = 20;

  // 产线编码：中棒线 = B1。缓存 key 前缀，多产线并存时互不干扰，后续拓展只改此处
  var LINE_CODE = 'B1';

  // 内存去重集合：防止同一超长钢坯在确认前被反复触发弹窗
  var _shownSet = {};

  // =========================
  // 单根超长钢坯指纹（localStorage 和内存共用同一套去重 key）
  //   只按 炉号|钢坯号：同钢坯跨道次移动不算新报警
  // =========================
  function fingerprint(rec) {
    return (rec.furnaceCode || '') + '|' + (rec.inMatNo || '');
  }

  // =========================
  // localStorage 缓存工具
  // =========================
  function getCacheKey(furnaceCode) {
    return 'overlength_cache_' + LINE_CODE + '_' + (furnaceCode || 'unknown');
  }

  function loadCache(furnaceCode) {
    try {
      var raw = localStorage.getItem(getCacheKey(furnaceCode));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveToCache(furnaceCode, rec) {
    var cache = loadCache(furnaceCode);
    // 缓存数据打上产线标记与确认时间，便于识别数据来源
    var record = Object.assign({}, rec, { lineCode: LINE_CODE, confirmedAt: new Date().toLocaleString() });
    // 同钢坯重复确认时先移除旧记录，保证去重生效
    var fp = fingerprint(record);
    for (var i = 0; i < cache.length; i++) {
      if (fingerprint(cache[i]) === fp) {
        cache.splice(i, 1);
        break;
      }
    }
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
  //   true  = 已显示过或已确认过，不弹
  // =========================
  function isDuplicate(rec) {
    if (!rec || !rec.inMatNo) return true; // 无钢坯号不触发
    var fp = fingerprint(rec);
    // 内存去重（即时拦截同一钢坯反复触发）
    if (_shownSet[fp]) return true;
    // localStorage 去重（跨会话/跨页面）
    var cache = loadCache(rec.furnaceCode);
    for (var i = 0; i < cache.length; i++) {
      if (fingerprint(cache[i]) === fp) return true;
    }
    return false;
  }

  // 快照中是否含"未显示过/未确认过"的新超长钢坯
  function hasNewItem(rawData) {
    var items = (rawData && rawData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (!isDuplicate(items[i])) return true;
    }
    return false;
  }

  // 把快照中全部超长钢坯标记进内存（阻断确认前的重复触发）
  function markShown(rawData) {
    var items = (rawData && rawData.items) || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && it.inMatNo) _shownSet[fingerprint(it)] = true;
    }
  }

  // =========================
  // 面板区 HTML（按炉号逐个生成，炉间留间隙）
  //   每个炉一个面板：头部显示 炉号 + 该炉超长根数；表格列：道次 / 钢坯号 / 长度(mm)
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
      // 按道次(pos)升序排列明细
      var items = (r.items || []).slice().sort(function (a, b) {
        return (a.pos != null ? Number(a.pos) : 0) - (b.pos != null ? Number(b.pos) : 0);
      });
      var rows = '';
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        rows +=
          '<tr>' +
            '<td style="padding:7px 10px;border:1px solid #e8e8e8;text-align:center;color:#666;">' + fmt(it.pos) + '</td>' +
            '<td style="padding:7px 10px;border:1px solid #e8e8e8;">' + fmt(it.inMatNo) + '</td>' +
            '<td style="padding:7px 10px;border:1px solid #e8e8e8;text-align:right;color:#e74c3c;font-weight:600;">' + fmt(it.lengthMm) + '</td>' +
          '</tr>';
      }
      if (!rows) {
        rows = '<tr><td colspan="3" style="padding:10px;border:1px solid #e8e8e8;color:#999;text-align:center;">-</td></tr>';
      }
      html +=
        '<div style="flex:1;min-width:0;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden;">' +
          '<div style="height:34px;line-height:34px;padding:0 12px;background:#e74c3c;color:#fff;font-weight:600;font-size:14px;display:flex;justify-content:space-between;align-items:center;">' +
            '<span>' + fmt(r.furnaceCode) + '炉 · 超长 ' + items.length + ' 根</span>' +
            '<span style="font-size:12px;font-weight:400;opacity:0.85;">' + fmt(r.msgTime) + '</span>' +
          '</div>' +
          '<div style="max-height:260px;overflow:auto;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:13px;color:#333;">' +
              '<thead>' +
                '<tr style="background:#f5f5f5;color:#555;">' +
                  '<th style="padding:7px 10px;border:1px solid #e8e8e8;width:56px;">道次</th>' +
                  '<th style="padding:7px 10px;border:1px solid #e8e8e8;">钢坯号</th>' +
                  '<th style="padding:7px 10px;border:1px solid #e8e8e8;width:90px;">长度(mm)</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
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
    // ── 业务层去重：快照中无"未确认过"的新超长钢坯则不显示（返回 null 由 PopupManager 忽略）──
    if (!hasNewItem(rawData)) return null;
    // 内存标记本次快照全部超长钢坯（阻断确认前的重复触发）
    markShown(rawData);

    // 各炉记录集合：key = furnaceCode，value = 该炉最新快照
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
      width: 480px;
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
      ">钢坯长度超限</div>

      <!-- 基本信息行 -->
      <div style="
        display: flex;
        align-items: center;
        gap: 24px;
        padding: 14px 20px 12px;
        background: #f8f9fa;
        border-bottom: 1px solid #eee;
        font-size: 13px;
        color: #666;
      ">
        <span><b>炉号：</b><span class="ol-furnaces"></span></span>
        <span><b>超长总数：</b><span class="ol-total" style="color:#e74c3c;font-weight:600;"></span></span>
        <span style="flex:1;text-align:right;color:#999;" class="ol-time"></span>
      </div>

      <!-- 报警面板区（多炉并排，每炉列出超长明细） -->
      <div style="padding: 16px 20px;">
        <div class="ol-body" style="display:flex;align-items:flex-start;"></div>

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
          检测到炉内钢坯长度超过 10000mm，请核实钢坯信息后处理。
        </div>
      </div>

      <!-- 底部按钮 -->
      <div style="
        display:flex;
        justify-content:center;
        gap:16px;
        padding:8px 0 20px;
      ">
        <div class="overlength-confirm" style="
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
      furnaces: el.querySelector('.ol-furnaces'),
      total:    el.querySelector('.ol-total'),
      time:     el.querySelector('.ol-time'),
      body:     el.querySelector('.ol-body')
    };

    // ===== 内容填充/刷新 =====
    function refresh() {
      var keys = Object.keys(records);
      // 基本信息行：炉号集合 + 超长总数 + 最新时间
      dom.furnaces.textContent = keys.join('、') || '-';
      var total = 0;
      var latestTime = '';
      for (var i = 0; i < keys.length; i++) {
        total += (records[keys[i]].items || []).length;
        if (records[keys[i]].msgTime) latestTime = records[keys[i]].msgTime;
      }
      dom.total.textContent = String(total) + ' 根';
      dom.time.textContent = latestTime || '-';
      // 面板区重建
      dom.body.innerHTML = buildPanelsHTML(records);
      // 单炉 480px，双炉 800px
      el.style.width = keys.length > 1 ? '800px' : '480px';
    }
    refresh();

    // ===== 按钮事件 =====
    el.querySelector('.overlength-confirm').onclick = closeFn;

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
       * 去重：快照中无新增超长钢坯 → 忽略（保持现有弹窗）；有新增 → 按炉并入/刷新面板
       */
      update: function (newRawData) {
        if (!hasNewItem(newRawData)) return;
        markShown(newRawData);
        // 记录该炉最新快照（新炉子追加，已有炉子替换）
        records[newRawData.furnaceCode] = newRawData;
        refresh();
      },
      close: function () {
        // 点击确认/关闭时，将各炉已展示的超长钢坯逐根缓存到 localStorage
        for (var k in records) {
          if (!records.hasOwnProperty(k)) continue;
          var its = (records[k].items) || [];
          for (var i = 0; i < its.length; i++) {
            if (its[i] && its[i].inMatNo) saveToCache(k, its[i]);
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
  PopupManager.register('overlength', {
    render: render
  });
})();

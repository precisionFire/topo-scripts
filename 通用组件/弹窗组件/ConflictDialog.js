// =========================
// ConflictDialog.js — 炉内位置校准冲突弹窗
// 样式、DOM、解析、去重全由本文件自管，PopupManager 只做注册和调度（类型 'conflict'）
// 外部调用：PopupManager.show('conflict', rawData)
//
// 【版本记录】
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

  // 内存去重集合：防止同一冲突在确认前被反复触发弹窗
  var _shownSet = {};

  // =========================
  // 冲突指纹（localStorage 和内存共用同一套去重key）
  // =========================
  function fingerprint(data) {
    return (data.furnaceCode || '') + '|' + (data.position != null ? data.position : '') + '|' + (data.incomingCardNo || '') + '|' + (data.incomingSlabNo || '');
  }

  // =========================
  // localStorage 缓存工具
  // =========================
  function getCacheKey(furnaceCode) {
    return 'conflict_cache_' + LINE_CODE + '_' + (furnaceCode || 'unknown');
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
    // incomingCardNo 与 occupiedCardNo 相同时，不触发报警
    if (rawData.incomingCardNo === rawData.occupiedCardNo) {
      return false;
    }
    // 已显示过或已确认过的冲突不重复弹窗
    if (isDuplicate(rawData)) {
      return false;
    }
    return true;
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

    var d = rawData || {};

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
        background: #1e90ff;
        color: #fff;
        font-weight: 500;
        font-size: 16px;
      ">炉内位置冲突</div>

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
        <span><b>炉号：</b><span class="cf-furnace"></span></span>
        <span><b>位置：</b><span class="cf-position"></span></span>
        <span style="flex:1;text-align:right;color:#999;" class="cf-time"></span>
      </div>

      <!-- 冲突对比表格 -->
      <div style="padding: 16px 20px;">
        <table style="
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          color: #333;
        ">
          <thead>
            <tr style="background:#fafafa;">
              <td style="padding:8px 12px;border:1px solid #e8e8e8;font-weight:600;width:30%;"></td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;font-weight:600;">入炉钢坯</td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;font-weight:600;">已占用钢坯</td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;color:#888;">卡号</td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;" class="cf-incoming-card"></td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;" class="cf-occupied-card"></td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;color:#888;">钢坯号</td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;" class="cf-incoming-slab"></td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;" class="cf-occupied-slab"></td>
            </tr>
          </tbody>
        </table>

        <!-- 冲突说明 -->
        <div style="
          margin-top: 12px;
          padding: 10px 12px;
          background: #f5f5f5;
          border: 1px solid #e8e8e8;
          border-radius: 4px;
          font-size: 12px;
          color: #666;
          line-height: 1.6;
        " class="cf-message">
        </div>
      </div>

      <!-- 底部按钮 -->
      <div style="
        display:flex;
        justify-content:center;
        gap:16px;
        padding:8px 0 20px;
      ">
        <div class="conflict-confirm" style="
          width: 100px;
          height: 36px;
          line-height: 36px;
          text-align: center;
          background: #1e90ff;
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
      furnace:       el.querySelector('.cf-furnace'),
      position:      el.querySelector('.cf-position'),
      time:          el.querySelector('.cf-time'),
      incomingCard:  el.querySelector('.cf-incoming-card'),
      incomingSlab:  el.querySelector('.cf-incoming-slab'),
      occupiedCard:  el.querySelector('.cf-occupied-card'),
      occupiedSlab:  el.querySelector('.cf-occupied-slab'),
      message:       el.querySelector('.cf-message')
    };

    // ===== 内容填充/刷新 =====
    function refresh(data) {
      d = data;
      var fmt = function (v) { return v != null && v !== '' ? String(v) : '-'; };
      dom.furnace.textContent = fmt(d.furnaceCode);
      dom.position.textContent = fmt(d.position);
      dom.time.textContent = fmt(d.msgTime);
      dom.incomingCard.textContent = fmt(d.incomingCardNo);
      dom.incomingSlab.textContent = fmt(d.incomingSlabNo);
      dom.occupiedCard.textContent = fmt(d.occupiedCardNo);
      dom.occupiedSlab.textContent = fmt(d.occupiedSlabNo);
      dom.message.textContent = d.message || '炉内位置被另一根钢坯占用';
    }
    refresh(d);

    // ===== 按钮事件 =====
    el.querySelector('.conflict-confirm').onclick = closeFn;

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
       * 业务层去重：重复指纹忽略（保持现有弹窗）；新指纹则刷新内容
       */
      update: function (newRawData) {
        if (!shouldShow(newRawData)) return;
        _shownSet[fingerprint(newRawData)] = true;
        refresh(newRawData);
      },
      close: function () {
        // 点击确认/关闭时缓存到 localStorage
        saveToCache(d.furnaceCode, d);
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
  PopupManager.register('conflict', {
    render: render
  });
})();

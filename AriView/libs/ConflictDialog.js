// =========================
// ConflictDialog.js — 炉内位置校准冲突弹窗
// 基于 DialogView 改造，去掉 API 调用层，专注冲突信息展示
// =========================

const ConflictDialog = (() => {

  var MAX_CACHE = 5;

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
    return 'conflict_cache_' + (furnaceCode || 'unknown');
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
    cache.unshift(data);
    if (cache.length > MAX_CACHE) {
      cache = cache.slice(0, MAX_CACHE);
    }
    try {
      localStorage.setItem(getCacheKey(furnaceCode), JSON.stringify(cache));
    } catch (e) {}
  }

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

  // =========================
  // View（DOM + Mask）
  // =========================
  class View {
    constructor(data, onClose) {
      this.data = data;
      this.onClose = onClose;
      this.create();
    }

    create() {
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

      // 解析数据
      var d = this.data;
      var furnace = d.furnaceCode || '-';
      var position = d.position != null ? d.position : '-';
      var msgTime = d.msgTime || '-';
      var incomingCard = d.incomingCardNo || '-';
      var incomingSlab = d.incomingSlabNo || '-';
      var occupiedCard = d.occupiedCardNo || '-';
      var occupiedSlab = d.occupiedSlabNo || '-';
      var message = d.message || '炉内位置被另一根钢坯占用';

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
          <span><b>炉号：</b>${furnace}</span>
          <span><b>位置：</b>${position}</span>
          <span style="flex:1;text-align:right;color:#999;">${msgTime}</span>
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
                <td style="padding:8px 12px;border:1px solid #e8e8e8;">${incomingCard}</td>
                <td style="padding:8px 12px;border:1px solid #e8e8e8;">${occupiedCard}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;border:1px solid #e8e8e8;color:#888;">钢坯号</td>
                <td style="padding:8px 12px;border:1px solid #e8e8e8;">${incomingSlab}</td>
                <td style="padding:8px 12px;border:1px solid #e8e8e8;">${occupiedSlab}</td>
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
          ">
            ${message}
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

      // ===== 按钮事件 =====
      el.querySelector('.conflict-confirm').onclick = () => this.close();

      // ===== 点击遮罩关闭 =====
      mask.addEventListener('click', (e) => {
        if (e.target === mask) this.close();
      });

      this.mask = mask;
      this.el = el;

      // 入场动画
      this.animOpen();
    }

    animOpen() {
      requestAnimationFrame(() => {
        this.el.style.transform = 'translate(-50%, -50%) scale(1)';
        this.el.style.opacity = '1';
      });
    }

    animClose() {
      this.el.style.transform = 'translate(-50%, -50%) scale(0.9)';
      this.el.style.opacity = '0';
    }

    close() {
      // 点击确认时缓存到 localStorage
      saveToCache(this.data.furnaceCode, this.data);
      this.animClose();
      setTimeout(() => {
        this.mask.remove();
        if (typeof this.onClose === 'function') this.onClose();
      }, 200);
    }
  }

  // =========================
  // 对外API
  // =========================
  return {
    /**
     * 显示炉内位置冲突弹窗
     * @param {Object} conflictData  - 冲突数据对象（来自 ABNORMAL 事件的 data 字段）
     * @param {Function} onClose     - 关闭回调（可选）
     */
    show: function (conflictData, onClose) {
      // incomingCardNo 与 occupiedCardNo 相同时，不触发报警
      if (conflictData.incomingCardNo === conflictData.occupiedCardNo) {
        return null;
      }
      // 已缓存过的冲突不重复弹窗
      if (isDuplicate(conflictData)) {
        return null;
      }
      // 内存标记，阻断后续同指纹的调用
      _shownSet[fingerprint(conflictData)] = true;
      return new View(conflictData, onClose);
    }
  };

})();

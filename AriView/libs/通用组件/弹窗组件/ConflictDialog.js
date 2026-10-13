// =========================
// ConflictDialog.js — 入炉位置校准身份变更弹窗
// 样式、DOM、解析、去重全由本文件自管，PopupManager 只做注册和调度（类型 'conflict'）
// 外部调用：PopupManager.show('conflict', rawData)
//
// 【版本记录】
//   v1.12 2026-10-12  音频路径多级兜底：编辑器(ht-studio)预览脚本注入导致 document.currentScript 不可用，改为 currentScript → 脚本列表 → libs/ 反推 → 资源根 libs/ 回退
//   v1.11 2026-10-12  语音报警由 TTS 改为预录音频 mp3（furnace1.mp3/furnace2.mp3，与本 JS 同目录），规避精简系统无语音引擎/离线联网失败问题
//   v1.10 2026-10-10  语音报警（TTS）移入本组件：复用 shouldShow 去重（弹一次=播一次），文案带炉号/位置具体字段
//   v1.9  2026-10-10  修复缓存写入时机：只有点「确认」才写缓存，遮罩点击/程序关闭不再写缓存（原先 close 无条件写，导致点遮罩也计入去重）
//   v1.8  2026-10-10  报警字段切换为前后端协定新字段：previousCardNo/previousSlabNo（校准前）vs calibratedCardNo/calibratedSlabNo（校准后），移除旧字段 incoming/occupied，不兼容旧版本
//   v1.7  2026-09-23  回退 v1.6：保留同卡号冲突硬规则（同卡号判断是必要业务功能，不应直接删除）
//   v1.6  2026-09-23  [已回退] 移除"同卡号冲突已过滤"硬规则：现场认为同卡号也是冲突需要报警
//   v1.5  2026-09-23  shouldShow 各 return false 分支加 console.warn，定位"不弹窗"根因（同卡号 vs 重复推送 vs 内存/缓存命中）
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
    return (data.furnaceCode || '') + '|' + (data.position != null ? data.position : '') + '|' + (data.previousCardNo || '') + '|' + (data.previousSlabNo || '');
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
    if (!rawData) {
      // console.warn('[CONFLICT] shouldShow=false: rawData 为空');
      return false;
    }
    // previousCardNo 与 calibratedCardNo 相同时，不触发报警（身份未变更）
    if (rawData.previousCardNo === rawData.calibratedCardNo) {
      // console.warn('[CONFLICT] shouldShow=false: 卡号未变更 previousCardNo=calibratedCardNo=' + rawData.previousCardNo);
      return false;
    }
    // 已显示过或已确认过的冲突不重复弹窗
    var fp = fingerprint(rawData);
    if (isDuplicate(rawData)) {
      var inMemory = !!_shownSet[fp];
      var inCache = !inMemory && loadCache(rawData.furnaceCode).some(function (r) { return fingerprint(r) === fp; });
      // console.warn('[CONFLICT] shouldShow=false: 重复冲突已去重 fingerprint=' + fp + ' inMemory=' + inMemory + ' inCache=' + inCache);
      return false;
    }
    // console.log('[CONFLICT] shouldShow=true: ' + fp);
    return true;
  }

  // =========================
  // 语音报警（预录音频 mp3）：shouldShow 通过后触发，复用弹窗去重（弹一次 = 播一次）
  // 音频文件与本 JS 同目录：furnace1.mp3（A1）、furnace2.mp3（A2），不依赖系统 TTS 语音引擎，也不需联网
  // =========================
  var ABNORMAL_ALARM_REPEAT = 3;   // 报警语音重复播放次数

  // 音频基础路径：优先取当前脚本所在目录（音频与 ConflictDialog.js 放一起）。
  // 注意：ht-studio 编辑器预览时脚本由内部机制注入，document.currentScript 往往不可用，
  // 故补充多级兜底；最终回退到资源根下的 libs/（编辑器环境 libs 即在资源根下）。
  var ALARM_AUDIO_BASE = '';
  (function resolveAudioBase() {
    function dirOf(url) { return url.substring(0, url.lastIndexOf('/') + 1); }
    try {
      // 1) 常规：本脚本由 <script src> 加载
      var cs = document.currentScript;
      if (cs && cs.src) { ALARM_AUDIO_BASE = dirOf(cs.src); return; }

      var scripts = document.getElementsByTagName('script');
      var i, src, m;
      // 2) 兜底：脚本列表中已存在本文件
      for (i = 0; i < scripts.length; i++) {
        src = scripts[i] && scripts[i].src;
        if (src && /(^|\/)ConflictDialog\.js(\?|#|$)/.test(src)) {
          ALARM_AUDIO_BASE = dirOf(src); return;
        }
      }
      // 3) 兜底：编辑器预览丢失 currentScript，从同批加载的 libs/ 脚本反推资源目录
      for (i = 0; i < scripts.length; i++) {
        src = scripts[i] && scripts[i].src;
        m = src && src.match(/^(.*?\/libs\/)/);
        if (m) { ALARM_AUDIO_BASE = m[1]; return; }
      }
    } catch (e) {}
    // 4) 最终兜底：音频与本文件同在资源根下的 libs/
    if (!ALARM_AUDIO_BASE) ALARM_AUDIO_BASE = 'libs/';
  })();

  // 炉号 → 音频文件：A1 → furnace1.mp3，A2 → furnace2.mp3，其余默认 furnace1.mp3
  function alarmAudioUrl(furnaceCode) {
    var m = /(\d+)/.exec(String(furnaceCode || ''));
    var file = (m && m[1] === '2') ? 'furnace2.mp3' : 'furnace1.mp3';
    return ALARM_AUDIO_BASE + encodeURIComponent(file);
  }

  // 自动播放策略解锁：Chrome/WebView 要求页面有过用户交互后才能发声。
  // 页面刷新后 user activation 归零；解锁前的报警挂起，等首次点击/按键/触摸后补播。
  var _audioUnlocked = false;
  var _pendingAlarm = null;
  (function primeAudio() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    function unlock() {
      _audioUnlocked = true;
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
      if (_pendingAlarm) {
        var fn = _pendingAlarm;
        _pendingAlarm = null;
        try { fn(); } catch (e) {}
      }
    }
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);
    document.addEventListener('touchstart', unlock);
  })();

  /**
   * 语音报警（预录音频）：播放对应炉号的 mp3 共 times 遍
   * @param {Object} data - 冲突数据（取其 furnaceCode 决定 1炉/2炉）
   * @param {number} times - 重复遍数
   */
  function speakAlarm(data, times) {
    var src = alarmAudioUrl(data && data.furnaceCode);
    if (!src) return;
    times = times || 1;

    function doSpeak() {
      var count = 0;
      function playOnce() {
        if (count >= times) return;
        count++;
        var a = new Audio(src);
        a.preload = 'auto';
        a.addEventListener('ended', playOnce);       // 播完一遍 → 重头播下一遍
        a.addEventListener('error', function () {
          // 音频加载失败：静默降级，不影响弹窗
        });
        var p;
        try { p = a.play(); } catch (e) { p = null; }
        if (p && typeof p.catch === 'function') {
          p.catch(function () {
            // 仍被自动播放策略拦截（正常已在 unlock 后）：丢弃本次，避免死循环
          });
        }
      }
      playOnce();
    }

    if (_audioUnlocked) {
      doSpeak();
    } else {
      _pendingAlarm = doSpeak;   // 未解锁：挂起，首次交互后补播
    }
  }

  // =========================
  // render：构建弹窗 DOM（由 PopupManager 调用）
  //   返回 null 表示业务层判断本次不显示
  //   返回 { update, close }
  // =========================
  function render(rawData, closeFn) {
    // console.log('[CONFLICT] render() 被调用, rawData=' + JSON.stringify(rawData));
    // ── 业务层去重：不通过则不显示（返回 null 由 PopupManager 忽略）──
    if (!shouldShow(rawData)) return null;
    // 内存标记，阻断后续同指纹的调用（update 也据此保持现有弹窗）
    _shownSet[fingerprint(rawData)] = true;
    // 语音报警：确定要弹窗才播（复用 shouldShow 去重，弹一次 = 播一次）
    speakAlarm(rawData, ABNORMAL_ALARM_REPEAT);

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
      ">入炉位置身份变更</div>

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
              <td style="padding:8px 12px;border:1px solid #e8e8e8;font-weight:600;">校准前（原计划卡号）</td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;font-weight:600;">校准后（手动录入卡号）</td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;color:#888;">卡号</td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;" class="cf-previous-card"></td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;" class="cf-calibrated-card"></td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;color:#888;">钢坯号</td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;" class="cf-previous-slab"></td>
              <td style="padding:8px 12px;border:1px solid #e8e8e8;" class="cf-calibrated-slab"></td>
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
      previousCard:   el.querySelector('.cf-previous-card'),
      previousSlab:   el.querySelector('.cf-previous-slab'),
      calibratedCard: el.querySelector('.cf-calibrated-card'),
      calibratedSlab: el.querySelector('.cf-calibrated-slab'),
      message:       el.querySelector('.cf-message')
    };

    // ===== 内容填充/刷新 =====
    function refresh(data) {
      d = data;
      var fmt = function (v) { return v != null && v !== '' ? String(v) : '-'; };
      dom.furnace.textContent = fmt(d.furnaceCode);
      dom.position.textContent = fmt(d.position);
      dom.time.textContent = fmt(d.msgTime);
      dom.previousCard.textContent = fmt(d.previousCardNo);
      dom.previousSlab.textContent = fmt(d.previousSlabNo);
      dom.calibratedCard.textContent = fmt(d.calibratedCardNo);
      dom.calibratedSlab.textContent = fmt(d.calibratedSlabNo);
      dom.message.textContent = d.message || '炉内钢坯原计划卡号与手动录入卡号不一致';
    }
    refresh(d);

    // ===== 按钮事件 =====
    // 只有点「确认」才写缓存（视为操作员已处理）；遮罩点击/程序关闭只关闭、不写缓存
    el.querySelector('.conflict-confirm').onclick = function () {
      saveToCache(d.furnaceCode, d);
      closeFn();
    };

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
        // 新指纹 = 新报警，同步播报
        speakAlarm(newRawData, ABNORMAL_ALARM_REPEAT);
        refresh(newRawData);
      },
      close: function () {
        // 只负责关闭动画与移除 DOM；缓存写入已移到「确认」按钮点击处
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

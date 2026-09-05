// =========================
// HistoricalTrendPopup.js — 历史数据趋势弹窗（PopupManager 注册类型：history-trend）
// 职责边界：
//   只负责弹窗容器（遮罩 + 标题栏 + iframe），iframe 加载内容页
//   custom/HistoricalDataDialog/newDataDialog.html（tag 解析、历史数据请求、MQTT 实时、日期选择均在其内部）
// 业务数据请求/实时订阅等逻辑全部留在内容页，本文件不掺业务。
//
// 宿主页面双击点位节点时调用：
//   PopupManager.show('history-trend', { tag: <完整点位路径>, tagid: <点位ID>, name: <点位名称> })
//
// 【版本记录】
//   v1.0  2026-09-02  新增：替换 index.html 内联的 openHistoricalDialog/openModalWithIframe；
//                     复用 iframe 容器弹窗方案（做法 A），内容页 newDataDialog.html 不改动
//   v1.1  2026-09-03  去掉标题栏：标题/Tab/关闭按钮全部移入 iframe 内部页，外壳只保留 iframe 容器
// =========================

(function _register() {
  if (typeof PopupManager === 'undefined') {
    setTimeout(_register, 100);
    return;
  }

  var DIALOG_PATH = '/static/AriView/custom/HistoricalDataDialog/newDataDialog.html';

  // 构造内容页 iframe 地址（与原 openHistoricalDialog 的 URL 规则保持一致）
  function buildIframeUrl(tag, name, tagid) {
    return window.location.origin + DIALOG_PATH +
      '?tag='   + encodeURI(encodeURI(tag)) +
      '&name='  + encodeURI(encodeURI(name  || '')) +
      '&tagid=' + encodeURI(encodeURI(tagid || ''));
  }

  PopupManager.register('history-trend', {

    render: function (rawData, closeFn) {
      var self = this;
      var tag = rawData && rawData.tag;
      if (!tag) return null; // 无有效点位：忽略，不建弹窗

      // ── 遮罩（点击遮罩关闭）──
      var mask = document.createElement('div');
      mask.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.15);z-index:10000;';
      mask.addEventListener('click', function (e) {
        if (e.target === mask) closeFn();
      });

      // ── 弹窗容器 ──
      var el = document.createElement('div');
      el.style.cssText =
        'position:absolute;top:50%;left:50%;' +
        'transform:translate(-50%,-50%) scale(0.9);' +
        'width:1120px;max-width:96vw;background:#fff;border-radius:6px;' +
        'box-shadow:0 6px 20px rgba(0,0,0,0.2);' +
        'font-family:"Microsoft YaHei","PingFang SC",sans-serif;' +
        'opacity:0;transition:all .2s ease;overflow:hidden;';

      // 标题栏已移至 iframe 内部页（newDataDialog.html），外壳只保留 iframe 容器
      el.innerHTML =
        '<iframe style="width:100%;height:660px;border:none;display:block;background:#f0f2f5;border-radius:6px;" ' +
        'src="' + buildIframeUrl(rawData.tag, rawData.name, rawData.tagid) + '"></iframe>';

      mask.appendChild(el);
      document.body.appendChild(mask);

      requestAnimationFrame(function () {
        el.style.transform = 'translate(-50%, -50%) scale(1)';
        el.style.opacity = '1';
      });

      // 当前展示点位，供 update 去重（同点位重复双击不整页重载）
      self._lastTag = rawData.tag;

      return {
        close: function () {
          el.style.transform = 'translate(-50%, -50%) scale(0.9)';
          el.style.opacity = '0';
          setTimeout(function () {
            if (mask.parentNode) mask.remove();
          }, 200);
        },
        update: function (newRawData) {
          if (!newRawData || !newRawData.tag) return;
          if (newRawData.tag === self._lastTag) return; // 同点位：保持现状
          self._lastTag = newRawData.tag;
          var iframe = el.querySelector('iframe');
          if (iframe) {
            iframe.src = buildIframeUrl(newRawData.tag, newRawData.name, newRawData.tagid);
          }
        }
      };
    }
  });
})();

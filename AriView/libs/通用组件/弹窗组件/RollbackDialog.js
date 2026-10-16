// =========================
// RollbackDialog.js — 钢坯回退弹窗（手工操作表单）
// 样式、DOM、表单逻辑全由本文件自管，PopupManager 只做注册和调度（类型 'rollback'）
// 外部调用：PopupManager.show('rollback', rawData)
//
// rawData 结构（均为预填值，可只传部分字段）:
//   {
//     cardNo:  'H8xxxx',        // 卡号（可空）
//     inMatNo: 'xxxx'           // 钢坯号（可空）
//   }
//
// 表单说明（按需求图 2026-10-15）:
//   卡号 / 钢坯号：文本输入
//   切分段数：下拉 1~6
//   回退位置：单选 1#炉 / 2#炉 / 均热炉
//   抗位 / 眼位 / 排布方式：仅选择「均热炉」时显示；抗位、排布方式为下拉，
//     选项参考「均热炉入炉方式选择」（当前仓库无该实现，选项在下方常量占位，待对齐后替换）
//
// 【版本记录】
//   v1.0  2026-10-15  初版：钢坯回退表单弹窗，确定提交接口地址待定（见 ROLLBACK_API）
// =========================

(function _register() {
  if (typeof PopupManager === 'undefined') {
    setTimeout(_register, 100);
    return;
  }

  // =========================
  // 可配置项（待与「均热炉入炉方式选择」对齐后替换）
  // =========================

  // 回退提交接口（POST，JSON）。接口地址待定，未配置时点击确定只做前端校验并打印 payload
  var ROLLBACK_API = '';

  // 抗位下拉选项（占位）
  var PIT_OPTIONS = ['1', '2', '3', '4', '5', '6'];

  // 排布方式下拉选项（占位）
  var LAYOUT_OPTIONS = ['单排', '双排'];

  // 回退位置单选值（与系统炉号编码保持一致：A1/A2/均热炉）
  var POSITION_OPTIONS = [
    { label: '1#炉', value: 'A1' },
    { label: '2#炉', value: 'A2' },
    { label: '均热炉', value: 'SOAK' }
  ];

  // 切分段数 1~6
  var CUT_COUNT_OPTIONS = ['1', '2', '3', '4', '5', '6'];

  // =========================
  // 工具
  // =========================

  function buildOptions(list, selected) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var v = String(list[i]);
      html += '<option value="' + v + '"' + (v === String(selected || '') ? ' selected' : '') + '>' + v + '</option>';
    }
    return html;
  }

  // =========================
  // render：构建弹窗 DOM（由 PopupManager 调用）
  //   手工操作弹窗，无去重逻辑，每次 show 都重建表单
  //   返回 { update, close }
  // =========================
  function render(rawData, closeFn) {
    var prefill = rawData || {};

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
      width: 560px;
      background: #fff;
      border-radius: 6px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
      opacity: 0;
      transition: all .2s ease;
      font-family: sans-serif;
      overflow: hidden;
    `;

    // 回退位置单选组
    var positionHTML = '';
    for (var i = 0; i < POSITION_OPTIONS.length; i++) {
      var opt = POSITION_OPTIONS[i];
      positionHTML +=
        '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin-right:28px;font-size:14px;color:#333;">' +
          '<input type="radio" name="rb-position" value="' + opt.value + '"' +
            (i === 0 ? ' checked' : '') +
            ' style="width:15px;height:15px;cursor:pointer;">' + opt.label +
        '</label>';
    }

    el.innerHTML = `
      <!-- 标题栏 -->
      <div style="
        height: 40px;
        line-height: 40px;
        text-align: center;
        background: #4a7ebb;
        color: #fff;
        font-weight: 500;
        font-size: 16px;
      ">钢坯回退</div>

      <!-- 表单区 -->
      <div style="padding: 20px 28px 8px;">
        <!-- 卡号 / 钢坯号 -->
        <div style="display:flex;align-items:center;gap:24px;margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <span style="font-size:14px;color:#333;white-space:nowrap;">卡号</span>
            <input class="rb-cardNo" type="text" autocomplete="off" style="
              flex:1;min-width:0;height:30px;padding:0 8px;
              border:1px solid #4a7ebb;border-radius:3px;font-size:14px;outline:none;
            ">
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <span style="font-size:14px;color:#333;white-space:nowrap;">钢坯号</span>
            <input class="rb-inMatNo" type="text" autocomplete="off" style="
              flex:1;min-width:0;height:30px;padding:0 8px;
              border:1px solid #4a7ebb;border-radius:3px;font-size:14px;outline:none;
            ">
          </div>
        </div>

        <!-- 切分段数 -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          <span style="font-size:14px;color:#333;white-space:nowrap;">切分段数</span>
          <select class="rb-cutCount" style="
            width:110px;height:30px;padding:0 6px;
            border:1px solid #4a7ebb;border-radius:3px;font-size:14px;outline:none;background:#fff;
          "></select>
        </div>

        <!-- 回退位置 -->
        <div style="margin-bottom:16px;">
          <div style="font-size:14px;color:#333;margin-bottom:10px;">回退位置：</div>
          <div style="display:flex;align-items:center;padding-left:4px;">${positionHTML}</div>
        </div>

        <!-- 均热炉附加项（仅选中「均热炉」时显示） -->
        <div class="rb-soak-section" style="display:none;border-top:1px dashed #ddd;padding-top:14px;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:8px;flex:1;">
              <span style="font-size:14px;color:#333;white-space:nowrap;">坑位</span>
              <select class="rb-pitNo" style="
                flex:1;min-width:0;height:30px;padding:0 6px;
                border:1px solid #4a7ebb;border-radius:3px;font-size:14px;outline:none;background:#fff;
              "></select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex:1;">
              <span style="font-size:14px;color:#333;white-space:nowrap;">眼位</span>
              <input class="rb-eyeNo" type="text" autocomplete="off" style="
                flex:1;min-width:0;height:30px;padding:0 8px;
                border:1px solid #4a7ebb;border-radius:3px;font-size:14px;outline:none;
              ">
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex:1;">
              <span style="font-size:14px;color:#333;white-space:nowrap;">排布方式</span>
              <select class="rb-layout" style="
                flex:1;min-width:0;height:30px;padding:0 6px;
                border:1px solid #4a7ebb;border-radius:3px;font-size:14px;outline:none;background:#fff;
              "></select>
            </div>
          </div>
        </div>

        <!-- 校验提示 -->
        <div class="rb-error" style="
          display:none;margin:0 0 8px;padding:6px 10px;
          background:#fdf0ef;border:1px solid #f5c6c0;border-radius:4px;
          font-size:12px;color:#a94442;line-height:1.5;
        "></div>
      </div>

      <!-- 底部按钮 -->
      <div style="display:flex;justify-content:flex-end;gap:16px;padding:8px 28px 20px;">
        <div class="rb-ok" style="
          width:96px;height:34px;line-height:34px;text-align:center;
          background:#4a7ebb;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;
        ">确定</div>
        <div class="rb-cancel" style="
          width:96px;height:34px;line-height:34px;text-align:center;
          background:#fff;color:#555;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:14px;
        ">取消</div>
      </div>
    `;

    mask.appendChild(el);
    document.body.appendChild(mask);

    // ===== 记录节点 =====
    var dom = {
      cardNo:   el.querySelector('.rb-cardNo'),
      inMatNo:  el.querySelector('.rb-inMatNo'),
      cutCount: el.querySelector('.rb-cutCount'),
      radios:   el.querySelectorAll('input[name="rb-position"]'),
      soakSection: el.querySelector('.rb-soak-section'),
      pitNo:    el.querySelector('.rb-pitNo'),
      eyeNo:    el.querySelector('.rb-eyeNo'),
      layout:   el.querySelector('.rb-layout'),
      error:    el.querySelector('.rb-error'),
      ok:       el.querySelector('.rb-ok'),
      cancel:   el.querySelector('.rb-cancel')
    };

    // ===== 下拉选项填充（占位常量） =====
    dom.cutCount.innerHTML = buildOptions(CUT_COUNT_OPTIONS, '1');
    dom.pitNo.innerHTML = buildOptions(PIT_OPTIONS);
    dom.layout.innerHTML = buildOptions(LAYOUT_OPTIONS);

    // ===== 预填 =====
    if (prefill.cardNo) dom.cardNo.value = prefill.cardNo;
    if (prefill.inMatNo) dom.inMatNo.value = prefill.inMatNo;

    // ===== 回退位置切换：均热炉才显示抗位/眼位/排布方式 =====
    function refreshSoakSection() {
      var pos = getSelectedPosition();
      dom.soakSection.style.display = (pos === 'SOAK') ? 'block' : 'none';
    }
    function getSelectedPosition() {
      for (var i = 0; i < dom.radios.length; i++) {
        if (dom.radios[i].checked) return dom.radios[i].value;
      }
      return '';
    }
    for (var r = 0; r < dom.radios.length; r++) {
      dom.radios[r].addEventListener('change', refreshSoakSection);
    }
    refreshSoakSection();

    // ===== 错误提示 =====
    function showError(msg) {
      dom.error.textContent = msg;
      dom.error.style.display = 'block';
    }
    function clearError() {
      dom.error.style.display = 'none';
    }
    dom.cardNo.addEventListener('input', clearError);
    dom.inMatNo.addEventListener('input', clearError);

    // ===== 确定：校验 → 组装 payload → 提交 =====
    var submitting = false;
    dom.ok.onclick = function () {
      clearError();
      var cardNo = dom.cardNo.value.trim();
      var inMatNo = dom.inMatNo.value.trim();
      if (!cardNo) { showError('请填写卡号'); return; }
      if (!inMatNo) { showError('请填写钢坯号'); return; }

      var pos = getSelectedPosition();
      var payload = {
        cardNo: cardNo,
        inMatNo: inMatNo,
        cutCount: dom.cutCount.value,
        rollbackPos: pos
      };
      // 仅均热炉回退时附带抗位/眼位/排布方式
      if (pos === 'SOAK') {
        payload.pitNo = dom.pitNo.value;
        payload.eyeNo = dom.eyeNo.value.trim();
        payload.layout = dom.layout.value;
      }

      if (!ROLLBACK_API) {
        // 接口地址未配置：先只做前端校验，payload 打印供联调
        console.warn('[RollbackDialog] ROLLBACK_API 未配置，本次仅输出 payload：', payload);
        closeFn();
        return;
      }

      if (submitting) return;
      submitting = true;
      fetch(ROLLBACK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function () {
          closeFn();
        })
        .catch(function (err) {
          console.error('[RollbackDialog] 回退提交失败：', err);
          showError('回退提交失败，请重试');
        })
        .finally(function () {
          submitting = false;
        });
    };

    // ===== 取消 / 遮罩关闭 =====
    dom.cancel.onclick = closeFn;
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
       * update：再次 show 时刷新预填值（不重建弹窗，保留用户已填内容）
       */
      update: function (newRawData) {
        var d = newRawData || {};
        if (d.cardNo) dom.cardNo.value = d.cardNo;
        if (d.inMatNo) dom.inMatNo.value = d.inMatNo;
      },
      close: function () {
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
  PopupManager.register('rollback', {
    render: render
  });
})();

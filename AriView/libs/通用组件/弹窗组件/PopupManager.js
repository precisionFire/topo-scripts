// =========================
// PopupManager.js — 弹窗统一调度器（纯管理，不含样式和DOM）
// =========================
// 职责：
//   1. 注册弹窗类型
//   2. 转发原始数据给业务弹窗
//   3. 同类型单例 + 生命周期管理
//
// 不负责：DOM创建、样式、动画、模板 — 全由业务弹窗自行实现
//
// 调用方式：
//   PopupManager.show('will-in-out', rawData)
//   PopupManager.close('will-in-out')
//   PopupManager.closeAll()
//
// 新增弹窗步骤：
//   1. 编写 render(rawData, closeFn) 函数，return { close }
//   2. 调用 PopupManager.register('my-type', { render })
//
// 【版本记录】
//   v1.2  2026-08-27  移除 show() 的 preShow 钩子（v1.1 已废弃）：
//                     去重等业务判断归各业务弹窗在 render/update 内自行处理，管理器保持纯管理
// =========================

const PopupManager = (() => {

  // =========================
  // 内部状态
  // =========================

  var _registry  = {};       // type → handler { render }
  var _instances = {};       // type → { close, update? }

  // =========================
  // 工具：PopupContext（可选约定，弹窗自行决定是否使用）
  // =========================

  /**
   * 创建标准上下文对象（推荐约定，非强制）
   * @param {string} type    - 弹窗类型
   * @param {Object} meta    - { title, level, timestamp, tags }
   * @param {*}      payload - 业务数据
   * @param {Object} actions - { onConfirm, onClose }
   */
  function createContext(type, meta, payload, actions) {
    return {
      type:    type,
      meta:    meta    || {},
      payload: payload || {},
      actions: actions || {}
    };
  }

  // =========================
  // 核心 API
  // =========================

  /**
   * 注册弹窗类型
   *
   * @param {string}   type    - 类型标识，如 'will-in-out'
   * @param {Object}   handler
   * @param {Function} handler.render - (rawData, closeFn) → { close: Function, update?: Function }
   *          - closeFn:    管理器提供的关闭函数，弹窗内部触发关闭时调用
   *          - close:      管理器调用此函数销毁弹窗（动画→remove）
   *          - update:     可选，新数据到达时调用 update(rawData) 局部刷新
   */
  function register(type, handler) {
    if (!type || !handler || typeof handler.render !== 'function') return;
    _registry[type] = handler;
  }

  /**
   * 显示弹窗
   *
   * @param {string} type    - 弹窗类型
   * @param {*}      rawData - 原始数据，直接透传给 handler.render
   * @param {Object} opts    - 预留 { onClose }
   * @returns {Object|null}  - 实例引用
   */
  function show(type, rawData, opts) {
    if (!type || !rawData) return null;

    var handler = _registry[type];
    if (!handler) {
      console.warn('[PopupManager] 弹窗类型 "' + type + '" 未注册，请确保对应的弹窗文件已加载');
      return null;
    }

    var opts = opts || {};

    // ── 已有同类型实例？优先更新 ──
    var existing = _instances[type];
    if (existing) {
      if (typeof existing.update === 'function') {
        existing.update(rawData);
        return existing;
      }
      // 无 update → 关闭旧的，重建新的
      _closeInstance(type);
    }

    // ── 创建新实例 ──
    function closeSelf() {
      _closeInstance(type);
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    var result = handler.render(rawData, closeSelf);
    if (!result) return null;

    var instance = {
      close:  result.close,
      update: result.update || null
    };

    _instances[type] = instance;
    return instance;
  }

  /**
   * 关闭指定类型弹窗
   */
  function close(type) {
    if (!type) return;
    _closeInstance(type);
  }

  /**
   * 关闭所有弹窗
   */
  function closeAll() {
    Object.keys(_instances).forEach(function (t) {
      _closeInstance(t);
    });
  }

  function _closeInstance(type) {
    var inst = _instances[type];
    if (!inst) return;
    if (typeof inst.close === 'function') {
      try { inst.close(); } catch (e) {}
    }
    delete _instances[type];
  }

  // =========================
  // 导出
  // =========================
  return {
    createContext: createContext,
    register:      register,
    show:          show,
    close:         close,
    closeAll:      closeAll
  };

})();

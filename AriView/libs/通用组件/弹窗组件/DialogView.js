// =========================
// DialogView.js（最终工业版）
// =========================

const DialogSystem = (() => {

  // =========================
  // 状态机
  // ====================View=====
  const State = {
    IDLE: 'idle',
    OPENING: 'opening',
    ACTIVE: 'active',
    LOADING: 'loading',
    SUCCESS: 'success',
    ERROR: 'error',
    CLOSING: 'closing',
    DESTROY: 'destroy'
  };

  // =========================
  // Manager（单例）
  // =========================
  class Manager {
    constructor() {
      this.queue = [];
      this.active = null;
      this.zIndex = 1000;
    }

    open(config) {
      const dialog = new Dialog(config, this);
      this.queue.push(dialog);
      this.next();
      return dialog;
    }

    next() {
      if (this.active) return;
      const d = this.queue.shift();
      if (!d) return;

      this.active = d;
      d.start();
    }

    clearActive() {
      this.active = null;
      this.next();
    }
  }

  const manager = new Manager();

  // =========================
  // Dialog 实例
  // =========================
  class Dialog {
    constructor(config, manager) {
      this.manager = manager;
      this.state = State.IDLE;

      this.config = Object.assign({
        title: "提示",
        content: "",
        apiType: "get",
        url: "",
        params: {},
        requestFn: null,
        onSuccess: null,
        onFail: null
      }, config);

      this.view = new View(this);
      this.effect = new Effect(this);
      this.anim = new Anim(this);
    }

    setState(s) {
      this.state = s;
      this.runState(s);
    }

    runState(s) {
      switch(s) {
        case State.OPENING:
          this.anim.open();
          break;

        case State.ACTIVE:
          break;

        case State.LOADING:
          this.view.setLoading(true);
          this.effect.run();
          break;

        case State.SUCCESS:
          this.view.setLoading(false);
          this.view.setSuccess();
          this.config.onSuccess?.(this.effect.ctx.result);
          setTimeout(() => this.close(), 800);
          break;

        case State.ERROR:
          this.view.setLoading(false);
          this.view.setError();
          this.config.onFail?.(this.effect.ctx.error);
          break;

        case State.CLOSING:
          this.anim.close();
          break;

        case State.DESTROY:
          this.view.destroy();
          this.manager.clearActive();
          break;
      }
    }

    start() {
      this.setState(State.OPENING);
    }

    confirm() {
      this.setState(State.LOADING);
    }

    close() {
      this.setState(State.CLOSING);
    }
  }

  // =========================
  // View（DOM + Mask）
  // =========================
  class View {
    constructor(dialog) {
      this.dialog = dialog;
      this.create();
    }

    create() {
      // ===== 遮罩层 =====
      const mask = document.createElement('div');
      mask.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.35);
        z-index: ${this.dialog.manager.zIndex++};
      `;

      // ===== 弹窗 =====
      const el = document.createElement('div');
      el.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.9);
        width: 420px;
        background: #fff;
        border-radius: 6px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.2);
        opacity: 0;
        transition: all .2s ease;
        font-family: sans-serif;
      `;

      el.innerHTML = `
        <div class="dialog-title" style="
          height: 40px;
          line-height: 40px;
          padding: 0 16px;
          background: #1e90ff;
          color: #fff;
          font-weight: 500;
          font-size: 16px;
        "></div>

        <div class="dialog-content" style="
          padding: 24px;
          text-align: center;
          font-size: 14px;
          color: #333;
        "></div>

        <div style="
          display:flex;
          justify-content:center;
          gap:20px;
          padding:16px 0 20px;
        ">
          <div class="ok" style="
            width: 100px;
            height: 36px;
            line-height: 36px;
            text-align: center;
            background: #1e90ff;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          "></div>
          <div class="cancel" style="
            width: 100px;
            height: 36px;
            line-height: 36px;
            text-align: center;
            background: #fff;
            color: #1e90ff;
            border: 1px solid #1e90ff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          "></div>
        </div>
      `;

      // 显式设置文字（兼容 ariView Canvas 渲染）
      el.querySelector('.dialog-title').textContent = this.dialog.config.title;
      el.querySelector('.dialog-content').textContent = this.dialog.config.content;
      el.querySelector('.ok').textContent = '确认';
      el.querySelector('.cancel').textContent = '取消';

      mask.appendChild(el);
      document.body.appendChild(mask);

      // ===== 按钮事件 =====
      const ok = el.querySelector('.ok');
      const cancel = el.querySelector('.cancel');

      ok.onclick = () => this.dialog.confirm();
      cancel.onclick = () => this.dialog.close();

      // ===== 点击遮罩关闭（可选）=====
      mask.onclick = e => {
        if (e.target === mask) {
          this.dialog.close();
        }
      };

      this.mask = mask;
      this.el = el;
    }

    setLoading(flag) {
      this.el.style.pointerEvents = flag ? 'none' : 'auto';
      this.el.style.opacity = flag ? 0.7 : 1;
    }

    setSuccess() {
      this.el.style.border = "2px solid #52c41a";
    }

    setError() {
      this.el.style.border = "2px solid red";
    }

    destroy() {
      this.mask.remove();
    }
  }

  // =========================
  // Effect（API）
  // =========================
  class Effect {
    constructor(dialog) {
      this.dialog = dialog;
      this.ctx = {};
    }

    async run() {
      const { url, params, apiType, requestFn } = this.dialog.config;

      try {
        let res;
        if (typeof requestFn === 'function') {
          res = await requestFn(url, params);
        } else if (apiType === 'post') {
          res = await requestPost(url, params);
        } else {
          res = await requestGet(url, params);
        }

        this.ctx.result = res;
        this.dialog.setState(State.SUCCESS);

      } catch (err) {
        this.ctx.error = err;
        this.dialog.setState(State.ERROR);
      }
    }
  }

  // =========================
  // 动画层
  // =========================
  class Anim {
    constructor(dialog) {
      this.dialog = dialog;
    }

    open() {
      const el = this.dialog.view.el;

      requestAnimationFrame(() => {
        el.style.transform = 'translate(-50%, -50%) scale(1)';
        el.style.opacity = 1;

        setTimeout(() => {
          this.dialog.setState(State.ACTIVE);
        }, 200);
      });
    }

    close() {
      const el = this.dialog.view.el;

      el.style.transform = 'translate(-50%, -50%) scale(0.9)';
      el.style.opacity = 0;

      setTimeout(() => {
        this.dialog.setState(State.DESTROY);
      }, 200);
    }
  }

  // =========================
  // 对外API
  // =========================
  return {
    open: config => manager.open(config)
  };

})();
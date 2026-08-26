// =========================
// 第一步：全局配置（图扑官方htconfig）
// 统一所有Dialog的默认样式，彻底替换绿色
// =========================
htconfig = {
  Color: {
    // 标题栏背景（渐变蓝，和toast统一）
    titleBackground: "linear-gradient(45deg, #1e90ff, #87cefa)",
    // 标题栏图标颜色
    titleIconBackground: "#fff",
    // 按钮栏背景色
    headerBackground: "#f7fbff"
  },
  Default: {
    // 对话框标题文字颜色
    dialogTitleLabelColor: "#fff",
    // 对话框标题字体
    dialogTitleLabelFont: "14px Microsoft Yahei",
    // 按钮默认背景色（替换绿色）
    dialogButtonBackground: "#1e90ff",
    // 按钮按下时背景色
    dialogButtonSelectBackground: "#1c86ee",
    // 按钮文字颜色
    dialogButtonLabelColor: "#fff",
    // 按钮栏背景色（和Color.headerBackground一致）
    dialogHeaderBackground: "#f7fbff",
    // 内容区域文字字体
    dialogContentLabelFont: "14px Microsoft Yahei",
    // 标题栏高度
    widgetTitleHeight: 36,
    // 按钮间距（解决重叠核心！图扑官方参数）
    dialogButtonMargin: 10,
    // 按钮内边距
    dialogButtonPadding: "6px 20px",
    // 按钮圆角（图扑官方支持）
    dialogButtonBorderRadius: 6
  }
};

// =========================
// 第二步：封装弹窗函数（纯图扑官方API）
// =========================
function showApiDialog(options = {}) {
  // 1. 创建图扑Dialog实例（官方构造方法）
  const dialog = new ht.widget.Dialog();

  // 2. 默认配置（全部为图扑官方参数）
  const defaultConfig = {
    title: "操作确认",
    width: 420,
    height: 240,
    content: "确定执行该操作？",
    // 官方交互配置
    draggable: true,
    closable: true,
    maximizable: false,
    resizeMode: "none",
    position: "center",
    buttonsAlign: "center",
    contentPadding: 20,
    borderWidth: 0,
    // 样式配置（覆盖全局htconfig，支持单弹窗差异化）
    titleBackground: htconfig.Color.titleBackground,
    titleColor: htconfig.Default.dialogTitleLabelColor,
    headerBackground: htconfig.Color.headerBackground,
    // 接口相关配置
    apiType: "get",
    url: "",
    params: {},
    beforeSubmit: null,
    onSuccess: null,
    onFail: null
  };

  // 3. 合并用户自定义配置
  const config = { ...defaultConfig, ...options };

  // 4. 配置Dialog（纯图扑官方setConfig API）
  dialog.setConfig({
    title: config.title,
    width: config.width,
    height: config.height,
    content: config.content,
    draggable: config.draggable,
    closable: config.closable,
    maximizable: config.maximizable,
    resizeMode: config.resizeMode,
    position: config.position,
    buttonsAlign: config.buttonsAlign,
    contentPadding: config.contentPadding,
    borderWidth: config.borderWidth,
    titleBackground: config.titleBackground,
    titleColor: config.titleColor,
    headerBackground: config.headerBackground,

    // 按钮配置（纯官方API，自定义取消按钮样式）
    buttons: [
      {
        label: "确认",
        // 确认按钮：使用全局配置的蓝色样式
        background: htconfig.Default.dialogButtonBackground,
        selectBackground: htconfig.Default.dialogButtonSelectBackground,
        labelColor: htconfig.Default.dialogButtonLabelColor,
        margin: htconfig.Default.dialogButtonMargin,
        padding: htconfig.Default.dialogButtonPadding,
        borderRadius: htconfig.Default.dialogButtonBorderRadius,
        action: async (btn, e) => {
          if (config.beforeSubmit && config.beforeSubmit() === false) return;
          try {
            let res;
            switch (config.apiType.toLowerCase()) {
              case "post": res = await requestPost(config.url, config.params); break;
              case "put": res = await requestPut(config.url, config.params); break;
              default: res = await requestGet(config.url, config.params); break;
            }
            config.onSuccess?.(res);
            dialog.hide();
          } catch (err) {
            config.onFail?.(err);
          }
        }
      },
      {
        label: "取消",
        // 取消按钮：差异化样式（图扑官方支持单按钮配置）
        background: "#e8f4ff",
        selectBackground: "#d1e9ff",
        labelColor: "#1e90ff",
        border: "1px solid #1e90ff",
        margin: htconfig.Default.dialogButtonMargin,
        padding: htconfig.Default.dialogButtonPadding,
        borderRadius: htconfig.Default.dialogButtonBorderRadius,
        action: () => dialog.hide()
      }
    ]
  });

  // 5. 修复事件绑定（图扑官方事件API）
  const originalShow = dialog.show;
  dialog.show = function(parentDOM) {
    originalShow.call(this, parentDOM);
    // 图扑官方事件绑定（适配源码）
    if (this.bindingHandleWindowResize) {
      window.addEventListener('resize', this.bindingHandleWindowResize);
    }
  };

  const originalHide = dialog.hide;
  dialog.hide = function() {
    originalHide.call(this);
    if (this.bindingHandleWindowResize) {
      window.removeEventListener('resize', this.bindingHandleWindowResize);
    }
  };

  // 6. 显示弹窗（图扑官方方法）
  dialog.show();
  return dialog;
}
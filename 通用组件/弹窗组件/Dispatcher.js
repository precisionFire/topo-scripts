// 点击插件池
const nodeClickPlugins = []

// 注册插件
export function registerNodeClickPlugin(plugin) {
  nodeClickPlugins.push(plugin)
}

export function runNodeClickPlugins(ctx) {
    // console.log('🔥 runNodeClickPlugins ENTER', ctx);

    nodeClickPlugins.forEach((plugin, index) => {
        // console.log('🔥 executing plugin', index);

        try {
            plugin(ctx);
        } catch (err) {
            console.error('Dispatcher error:', err);
        }
    });
}

window.appBridge = {
    runNodeClickPlugins
}

// console.log('🔥 nodeClick.js loaded');
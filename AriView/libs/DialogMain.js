import './DialogCore.js'
import './Dispatcher.js'
// console.log('🔥 main.js loaded');
import { registerNodeClickPlugin } from './Dispatcher.js'
import { parseSteelInfo, showSteelPopup, calcPopupPosition} from './DialogCore.js'

// // ===== 插件1：钢坯弹窗 =====
// registerNodeClickPlugin(({ node, event, furnaceKey }) => {

//     const data = parseSteelInfo(node.a('info'))

//     const point = graphView.getLogicalPoint(event)

//     showSteelPopup(data, point.x, point.y)

// })

// 收集节点几何信息（长宽/中心坐标/角度），转为画布视口坐标，用于弹窗智能定位
// 返回: { width, height, cx, cy, rotation } | null
// 坐标转换说明：本环境无 graphView.tp()，改用"点击点标定法"：
//   点击点视口坐标 = (clientX/clientY - rect) 已知，
//   点击点逻辑坐标 = graphView.getLogicalPoint(event)（HT 标准 API），
//   由二者推出 vp = zoom * lp + offset，再换算节点中心视口坐标。
function collectNodeGeometry(node, event, clickViewX, clickViewY) {
    if (!node) return null;
    try {
        // 节点中心的逻辑坐标（优先绝对坐标，兼容父节点挂载）
        const absPos = (typeof node.getAbsolutePosition === 'function')
            ? node.getAbsolutePosition()
            : node.getPosition();

        // 缩放（HT 标准 API getZoom；兼容 zoomFactor）
        const zoom = (typeof graphView.getZoom === 'function'
            ? graphView.getZoom()
            : (graphView.zoomFactor ? graphView.zoomFactor() : 1)) || 1

        let vx, vy
        if (typeof graphView.tp === 'function') {
            // 有 tp 就用它（HT 新版）
            const pt = graphView.tp(absPos.x, absPos.y)
            vx = pt.x
            vy = pt.y
        } else {
            // 点击点标定法：vp = zoom * lp + offset
            let clickLogic = null
            try {
                if (typeof graphView.getLogicalPoint === 'function' && event) {
                    clickLogic = graphView.getLogicalPoint(event)
                }
            } catch (e2) {}
            if (clickLogic && Number.isFinite(clickLogic.x) && Number.isFinite(clickViewX)) {
                const offX = clickViewX - zoom * clickLogic.x
                const offY = clickViewY - zoom * clickLogic.y
                vx = zoom * absPos.x + offX
                vy = zoom * absPos.y + offY
            } else {
                // 兜底：假定 zoom=1、pan=0，逻辑坐标即视口坐标
                vx = absPos.x
                vy = absPos.y
            }
        }

        const w = node.getWidth()
        const h = node.getHeight()
        const rot = node.getRotation() || 0
        console.log('[节点几何-原始]', {
            logicPos: { x: absPos.x, y: absPos.y },
            rawWidth: w,
            rawHeight: h,
            zoom,
            vp: { x: vx, y: vy },
            rotationRad: rot,
            rotationDeg: rot * 180 / Math.PI
        })
        return {
            width: w * zoom,
            height: h * zoom,
            cx: vx,
            cy: vy,
            rotation: rot           // 弧度
        };
    } catch (e) {
        console.warn('[collectNodeGeometry] 失败', e)
        return null;
    }
}

registerNodeClickPlugin(({ node, event, furnaceKey }) => {
    // ===== 版本标记：确认新版 DialogMain.js 已被加载 =====
    console.log('[DialogMain-版本] 新版插件已加载，node tag =', (node && node.getTag) ? node.getTag() : node)

    const data = parseSteelInfo(node.a('info'));
    const pos = node.a('pos');
    const inMatNo = node.a('inMatNo');
    const view = graphView.getView()
    const rect = view.getBoundingClientRect()

    const e = event.event || event

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // 节点几何（长宽/坐标/角度）→ 决定弹窗左右/上下显示方位
    const nodeGeom = collectNodeGeometry(node, e, x, y)

    showSteelPopup(data, x, y, rect, pos, inMatNo, nodeGeom)   // ✅ 把 rect 传下去

})
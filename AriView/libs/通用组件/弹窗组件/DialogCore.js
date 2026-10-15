export function parseSteelInfo(infoStr) {
  const obj = {}

  if (!infoStr) return obj

  infoStr.split(',').forEach(item => {
    const [key, value] = item.split(':')
    if (key) {
      obj[key.trim()] = value ? value.trim() : ''
    }
  })

  return obj
}

export function showSteelPopup(data, x, y, rect, pos, inMatNo, nodeGeom) {
  console.log(data)
  const old = document.getElementById('steel-popup')
  if (old) old.remove()

  const popup = document.createElement('div')

  // console.log('🔥 POPUP CREATED', popup)

  popup.id = 'steel-popup'

popup.innerHTML = `
  <style>
    /* 给整个弹窗统一设置固定字体、大小、行高 */
    .popup-content {
      font-family: "Microsoft YaHei", Arial, sans-serif;
      font-size: 14px; /* 固定大小，你可以改成 12px/13px/15px */
      line-height: 1;
      color: #ffffff;
    }
    /* 标题单独样式 */
    .popup-content .title {
      font-size: 16px; /* 标题固定大小 */
      font-weight: bold;
      margin-bottom: 8px;
      color: #ffffff;
    }
    /* 内容行间距 */
    .popup-content div:not(.title) {
      margin: 4px 0;
    }
  </style>

  <div class="popup-content">
    <div class="title">钢坯信息</div>
    <div>卡号：${data.cardNo || '-'}</div>
    <div>当前道次：${pos || '-'}</div>
    <div>钢坯号：${inMatNo || '-'}</div>
    <div>炉号：${data.heatNo || '-'}</div>
    <div>钢种：${data.steelGrade || '-'}</div>
    <div>厚度：${data.inMatThick || '-'}</div>
    <div>长度：${data.inMatLen || '-'}</div>
  </div>
`;

  // ===== 固定宽度，高度完全自适应 =====
  popup.style.width = '260px'
  popup.style.boxSizing = 'border-box'

  // ===== 视觉 =====
  popup.style.position = 'absolute'
  popup.style.left = '0px'
  popup.style.top = '0px'
  popup.style.zIndex = 999999
  popup.style.background = '#1e90ff'
  popup.style.color = '#fff'
  popup.style.padding = '8px 12px'
  popup.style.border = '1px solid #5abcc5'
  popup.style.borderRadius = '4px'
  popup.style.overflow = 'visible'
  popup.style.visibility = 'hidden' // 先隐藏，测量真实尺寸后再定位

  document.body.appendChild(popup)

  // ===== 用弹窗真实尺寸定位，保证与节点左右/上下错开、不重合 =====
  const popupW = popup.offsetWidth
  const popupH = popup.offsetHeight
  const { left, top } = calcPopupPosition(x, y, rect, nodeGeom, popupW, popupH)
  popup.style.left = rect.left + left + 'px'
  popup.style.top = rect.top + top + 'px'
  popup.style.visibility = 'visible'

  // ===== 调试：打印节点 AABB 与弹窗 AABB，检查是否相交 =====
  try {
    if (nodeGeom && Number.isFinite(nodeGeom.cx)) {
      const box = getRotatedBox(nodeGeom)
      const pr = popup.getBoundingClientRect()
      // 节点 AABB 也换算成视口坐标（画布 rect 的左上角）
      const nodeAbs = {
        left: rect.left + box.minX,
        top: rect.top + box.minY,
        right: rect.left + box.maxX,
        bottom: rect.top + box.maxY,
        width: box.maxX - box.minX,
        height: box.maxY - box.minY
      }
      const popupAbs = { left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom, width: pr.width, height: pr.height }
      const intersect =
        popupAbs.left < nodeAbs.right &&
        popupAbs.right > nodeAbs.left &&
        popupAbs.top < nodeAbs.bottom &&
        popupAbs.bottom > nodeAbs.top
      console.log('[弹窗定位-调试]', {
        canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        click: { x, y },
        nodeAABB: nodeAbs,
        popupAABB: popupAbs,
        相交: intersect,
        弹窗内部left: left,
        弹窗内部top: top
      })
    } else {
      console.log('[弹窗定位-调试] nodeGeom 为空，退回旧逻辑', nodeGeom)
    }
  } catch (err) {
    console.warn('[弹窗定位-调试] 打印失败', err)
  }
}

/**
 * 数值裁剪
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

/**
 * 计算旋转后的包围盒（AABB）
 * @param {{ width:number, height:number, cx:number, cy:number, rotation:number }} geom - 节点几何（画布屏幕坐标）
 */
function getRotatedBox(geom) {
  const w = geom.width
  const h = geom.height
  const cx = geom.cx
  const cy = geom.cy
  const rad = geom.rotation || 0
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = w / 2
  const hh = h / 2

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
  corners.forEach(([px, py]) => {
    const rx = cx + px * cos - py * sin
    const ry = cy + px * sin + py * cos
    if (rx < minX) minX = rx
    if (rx > maxX) maxX = rx
    if (ry < minY) minY = ry
    if (ry > maxY) maxY = ry
  })

  return { minX, maxX, minY, maxY }
}

/**
 * 判断"把弹窗放到该方向时，弹窗矩形与节点 AABB 是否完全无交集"
 * 并且允许弹窗整体仍位于画布内（必要时允许贴边但绝不与节点相交）。
 * 返回 true 表示该方向放得下（不与节点相交）。
 *
 * 关键约束：
 *   - left/right 方向 → 弹窗垂直居中，需要弹窗垂直跨度与节点 AABB 无交集（否则会盖节点）
 *   - top/bottom 方向 → 弹窗水平居中，需要弹窗水平跨度与节点 AABB 无交集
 */
function canPlaceInDirection(dir, box, canvasWidth, canvasHeight, popupW, popupH, padding) {
  // 弹窗在 dir 方向的矩形
  let popupLeft, popupRight, popupTop, popupBottom
  switch (dir) {
    case 'left':
      // 弹窗贴节点左侧，垂直居中
      popupRight = box.minX - padding
      popupLeft = popupRight - popupW
      popupTop = (box.minY + box.maxY) / 2 - popupH / 2
      popupBottom = popupTop + popupH
      break
    case 'right':
      // 弹窗贴节点右侧，垂直居中
      popupLeft = box.maxX + padding
      popupRight = popupLeft + popupW
      popupTop = (box.minY + box.maxY) / 2 - popupH / 2
      popupBottom = popupTop + popupH
      break
    case 'top':
      // 弹窗贴节点上方，水平居中
      popupBottom = box.minY - padding
      popupTop = popupBottom - popupH
      popupLeft = (box.minX + box.maxX) / 2 - popupW / 2
      popupRight = popupLeft + popupW
      break
    case 'bottom':
      // 弹窗贴节点下方，水平居中
      popupTop = box.maxY + padding
      popupBottom = popupTop + popupH
      popupLeft = (box.minX + box.maxX) / 2 - popupW / 2
      popupRight = popupLeft + popupW
      break
  }

  // 弹窗必须仍位于画布内
  if (popupLeft < padding) return false
  if (popupRight > canvasWidth - padding) return false
  if (popupTop < padding) return false
  if (popupBottom > canvasHeight - padding) return false

  // 弹窗矩形与节点 AABB 不相交
  const intersect =
    popupRight > box.minX &&
    popupLeft < box.maxX &&
    popupBottom > box.minY &&
    popupTop < box.maxY

  return !intersect
}

/**
 * 判定弹窗放置方向
 * - 按"点击点落在节点哪一侧"决定偏好方向（左/右、上/下）
 * - 长轴水平 → 优先左右；长轴垂直 → 优先上下
 * - 偏好方向放不下（与节点相交或超出画布）→ 依次尝试反方向 / 另一组方向
 * - 全部放不下 → 选"相交面积最小"的方向（宁可轻微出界，也不正压节点）
 */
function decideDirection(box, canvasWidth, canvasHeight, clickX, clickY, longAxisHorizontal, popupW, popupH, padding) {
  const boxCx = (box.minX + box.maxX) / 2
  const boxCy = (box.minY + box.maxY) / 2

  const clickLeft = clickX < boxCx
  const clickTop = clickY < boxCy

  const hPreferred = clickLeft ? 'right' : 'left'
  const hOpposite = hPreferred === 'right' ? 'left' : 'right'
  const vPreferred = clickTop ? 'bottom' : 'top'
  const vOpposite = vPreferred === 'bottom' ? 'top' : 'bottom'

  const order = longAxisHorizontal
    ? [hPreferred, hOpposite, vPreferred, vOpposite]
    : [vPreferred, vOpposite, hPreferred, hOpposite]

  // ===== 调试：打印每个方向判定结果 =====
  console.log('[弹窗定位-方向判定]', {
    box,
    canvas: { width: canvasWidth, height: canvasHeight },
    click: { clickX, clickY },
    longAxisHorizontal,
    order,
    can: {
      left: canPlaceInDirection('left', box, canvasWidth, canvasHeight, popupW, popupH, padding),
      right: canPlaceInDirection('right', box, canvasWidth, canvasHeight, popupW, popupH, padding),
      top: canPlaceInDirection('top', box, canvasWidth, canvasHeight, popupW, popupH, padding),
      bottom: canPlaceInDirection('bottom', box, canvasWidth, canvasHeight, popupW, popupH, padding),
    },
    popupSize: { popupW, popupH },
    padding
  })

  for (const dir of order) {
    if (canPlaceInDirection(dir, box, canvasWidth, canvasHeight, popupW, popupH, padding)) {
      console.log('[弹窗定位-选定方向]', dir)
      return dir
    }
  }

  // 全部放不下 → 计算每个方向"弹窗与节点的相交面积"，选最小的方向放置
  let best = hPreferred
  let bestArea = Infinity
  for (const dir of [hPreferred, hOpposite, vPreferred, vOpposite]) {
    const area = intersectAreaInDirection(dir, box, popupW, popupH)
    if (area < bestArea) {
      bestArea = area
      best = dir
    }
  }
  return best
}

/**
 * 计算弹窗放在 dir 方向（垂直/水平居中节点）时，与节点 AABB 的相交面积
 * 用于"全部放不下时"选相交最小的方向
 */
function intersectAreaInDirection(dir, box, popupW, popupH) {
  let pLeft, pRight, pTop, pBottom
  switch (dir) {
    case 'left':
      pRight = box.minX
      pLeft = pRight - popupW
      pTop = (box.minY + box.maxY) / 2 - popupH / 2
      pBottom = pTop + popupH
      break
    case 'right':
      pLeft = box.maxX
      pRight = pLeft + popupW
      pTop = (box.minY + box.maxY) / 2 - popupH / 2
      pBottom = pTop + popupH
      break
    case 'top':
      pBottom = box.minY
      pTop = pBottom - popupH
      pLeft = (box.minX + box.maxX) / 2 - popupW / 2
      pRight = pLeft + popupW
      break
    case 'bottom':
      pTop = box.maxY
      pBottom = pTop + popupH
      pLeft = (box.minX + box.maxX) / 2 - popupW / 2
      pRight = pLeft + popupW
      break
  }
  const overlapW = Math.max(0, Math.min(pRight, box.maxX) - Math.max(pLeft, box.minX))
  const overlapH = Math.max(0, Math.min(pBottom, box.maxY) - Math.max(pTop, box.minY))
  return overlapW * overlapH
}

/**
 * 计算弹窗位置
 * 传入节点几何信息（宽/高/中心坐标/角度）与弹窗真实尺寸时，依据节点智能判定：
 *   弹窗整体置于节点的左右侧或上下侧，**与节点矩形完全不相交**。
 * 不传节点几何时退回旧行为：居中于点击点 + 边界裁剪。
 *
 * @param {number} x - 点击点在画布内的 X（CSS px）
 * @param {number} y - 点击点在画布内的 Y（CSS px）
 * @param {DOMRect} rect - 画布容器 getBoundingClientRect()
 * @param {{ width:number, height:number, cx:number, cy:number, rotation:number }|null} nodeGeom - 节点几何（画布屏幕坐标）
 * @param {number} [popupWidth=260] - 弹窗真实宽度
 * @param {number} [popupHeight=200] - 弹窗真实高度
 */
export function calcPopupPosition(x, y, rect, nodeGeom, popupWidth, popupHeight) {
  popupWidth = popupWidth || 260
  popupHeight = popupHeight || 200
  const padding = 10

  const canvasWidth = rect.width
  const canvasHeight = rect.height

  // 兜底：无节点几何 → 居中于点击点并裁剪
  if (!nodeGeom || !Number.isFinite(nodeGeom.width) || !Number.isFinite(nodeGeom.cx)) {
    let left = x - popupWidth / 2
    let top = y - popupHeight / 2
    left = clamp(left, padding, canvasWidth - popupWidth - padding)
    top = clamp(top, padding, canvasHeight - popupHeight - padding)
    return { left, top }
  }

  const safeX = Number.isFinite(x) ? x : canvasWidth / 2
  const safeY = Number.isFinite(y) ? y : canvasHeight / 2

  // 节点旋转后包围盒
  const box = getRotatedBox(nodeGeom)

  // 节点长轴方向：长轴水平 → 左右优先；长轴垂直 → 上下优先
  const rad = nodeGeom.rotation || 0
  const longAxisHorizontal = Math.abs(Math.cos(rad)) >= Math.abs(Math.sin(rad))

  // 判定方向（要求弹窗矩形与节点 AABB 完全不相交）
  const direction = decideDirection(
    box, canvasWidth, canvasHeight, safeX, safeY, longAxisHorizontal,
    popupWidth, popupHeight, padding
  )

  const boxCx = (box.minX + box.maxX) / 2
  const boxCy = (box.minY + box.maxY) / 2

  let left
  let top

  switch (direction) {
    case 'left':
      // 弹窗整体在节点左侧，垂直居中于节点（垂直方向与节点无重叠）
      left = box.minX - padding - popupWidth
      top = boxCy - popupHeight / 2
      break
    case 'right':
      left = box.maxX + padding
      top = boxCy - popupHeight / 2
      break
    case 'top':
      // 弹窗整体在节点上方，水平居中于节点（水平方向与节点无重叠）
      left = boxCx - popupWidth / 2
      top = box.minY - padding - popupHeight
      break
    case 'bottom':
      left = boxCx - popupWidth / 2
      top = box.maxY + padding
      break
  }

  // 画布边界裁剪：仅在保证仍不与节点相交的前提下收紧
  // 如果裁剪会导致与节点相交，则宁可不裁剪（允许弹窗轻微出界）
  if (left < padding) left = padding
  if (left + popupWidth > canvasWidth - padding) left = canvasWidth - padding - popupWidth
  if (top < padding) top = padding
  if (top + popupHeight > canvasHeight - padding) top = canvasHeight - padding - popupHeight

  return { left, top }
}
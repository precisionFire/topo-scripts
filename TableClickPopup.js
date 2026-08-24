// =========================
// TableClickPopup.js — 表格点击弹窗工具
// 在你的点击事件内部调用：
//   showWillPopup()   → 同时展示待入炉 + 待出炉
// =========================

function showWillPopup() {
  if (typeof PopupManager === 'undefined') return;
  var interim = dataModel.getDataByTag('InterimData');
  if (!interim) return;

  var willInData  = interim.a('A2-willin');
  var willOutData = interim.a('A2-willout');

  // 至少有一组数据才弹窗
  if (!willInData && !willOutData) return;

  PopupManager.show('will-in-out', {
    willIn:  willInData  || null,
    willOut: willOutData || null
  });
}

showWillPopup();
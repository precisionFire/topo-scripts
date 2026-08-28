/*
  李露龙 主页JS
  20230408
*/
var devs;//导航

window.onload = function () {
  //导航、标题控制
  //DevCtl();
  //时钟
  //setInterval(TimeShow, 100);

  //定时切换，效果不太好
  // var i = 2;
  // setInterval(function () {
  //   document.getElementById('btn' + i + '').click();
  //   i++;
  //   if (i > devs.length) {
  //     i = 1;
  //   }
  // }, 5000)
  //初始页
  //document.getElementById('main').src = devs[0].href;
}
function switchScreen(path, name) {

  document.getElementById('headtitle').innerText = name;
  document.getElementById('main').src = 'storage/智能调度.html?tag=displays/' + path + name + '.json';
}
//单全屏
function fullScreen() {
  var element = document.documentElement;
  if (!document.fullscreenElement) {
    if (document.mozFullScreenEnabled) {
      return Promise.reject(new Error("全屏模式被禁用"));
    }
    let result = null;
    if (element.requestFullscreen) {
      result = element.requestFullscreen();
    } else if (element.mozRequestFullScreen) {
      result = element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
      result = element.msRequestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      result = element.webkitRequestFullScreen();
    }
    return result || Promise.reject(new Error("不支持全屏"));
  }
}
//实现全屏、退出全屏 切换
function toggleFullScreen() {
  // documentElement 属性以一个元素对象返回一个文档的文档元素
  var element = document.documentElement;
  if (!document.fullscreenElement) {
    if (document.mozFullScreenEnabled) {
      return Promise.reject(new Error("全屏模式被禁用"));
    }
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.mozRequestFullScreen) {
      element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullScreen();
    } else {
      Promise.reject(new Error("不支持全屏"));
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

//导航、标题控制
function DevCtl() {
  //清楚导航内容
  var div = document.getElementById("devbuttons");
  div.innerHTML = "";
  //获取导航模块并配置
  devs = [
    { name: '综合看板', title: 'Images/icon_tip_meiqizhinendiaodu.png', href: 'storage/综合看板.html' }
  ];
  var content = '', i = 1;
  devs.forEach(dev => {
    if (i == 1) {//默认第一个选中
      content += '<a id="btn' + i + '" onclick="BtnBG(' + i + ')" href="javascript:void(document.getElementById(\'main\').src=\'' + dev.href + '\',document.getElementById(\'headtitle\').src=\'' + dev.title + '\')" class="btn" style="background: url(Images/icon_top_bg_2.png);">' + dev.name + '</a>\t';

    } else {
      content += '<a id="btn' + i + '" onclick="BtnBG(' + i + ')" href="javascript:void(document.getElementById(\'main\').src=\'' + dev.href + '\',document.getElementById(\'headtitle\').src=\'' + dev.title + '\')" class="btn">' + dev.name + '</a>\t';
    }
    i++;
  });
  div.innerHTML = content;
}

function BtnBG(no) {
  for (let index = 0; index < devs.length; index++) {
    document.getElementById('btn' + (index + 1) + '').onmousemove = "";
    document.getElementById('btn' + (index + 1) + '').onmouseleave = "";
    document.getElementById('btn' + (index + 1) + '').style.background = 'url(Images/icon_top_bg_1.png)';
    if (no == (index + 1)) {
      document.getElementById('btn' + no + '').style.background = 'url(Images/icon_top_bg_2.png)';
    } else {
      document.getElementById('btn' + (index + 1) + '').onmousemove = function () { document.getElementById('btn' + (index + 1) + '').style.background = 'url(Images/icon_top_bg_2.png)'; };
      document.getElementById('btn' + (index + 1) + '').onmouseleave = function () { document.getElementById('btn' + (index + 1) + '').style.background = 'url(Images/icon_top_bg_1.png)'; };
    }
  }
}
//时钟
function TimeShow() {
  var week = new Array("日", "一", "二", "三", "四", "五", "六");
  var time = new Date(); //获得当前时间
  document.getElementById("date").innerText = time.getFullYear() + "/" + (time.getMonth() + 1) + "/" + time.getDate();
  document.getElementById("time").innerText = time.getHours() + ":" + time.getMinutes() + ":" + time.getSeconds();
  document.getElementById("week").innerText = "星期" + week[time.getDay()];
}

var _ListSubscribe = {
  "TextTag/MQTT/Today": "",
  "TextTag/MQTT/Time": "",
  "TextTag/MQTT/DayOfTheWeek": ""
}
function setData(t) {
  if (t.destinationName == "TextTag/MQTT/Today")
    document.getElementById("date").innerText = t.payloadString;
  if (t.destinationName == "TextTag/MQTT/Time")
    document.getElementById("time").innerText = t.payloadString;
  if (t.destinationName == "TextTag/MQTT/DayOfTheWeek")
    document.getElementById("week").innerText = t.payloadString;
}
//获取当前实时数据
function getRealtimeData() {
  var t = "testmq" + getRandomString(5),
    a = !1,
    e = !1;

  function i() {
    if (a = !0, console.log("连接服务器成功"), !e) {
      for (var t in _ListSubscribe) client.subscribe(t);
      e = !0
    }
    window.onbeforeunload = function () {
      for (var t in _ListSubscribe) client.unsubscribe(t)
    }
  }

  function n() {
    a || client.connect({
      onSuccess: i,
      cleanSession: !1,
      useSSL: !1,
      keepAliveInterval: 30,
      timeout: 10
    })
  }
  client = new Paho.MQTT.Client("172.15.87.112", 8083, t), n(), setInterval(n, 8e3), client.onConnectionLost = function (t) {
    0 !== t.errorCode && (console.log("连接已断开"), a = !1)
  }, client.onMessageArrived = function (t) {
    try {
      var a = t.destinationName;
      a in _ListSubscribe && (_ListSubscribe[a] = t.payloadString), setData(t)
    } catch (t) {
      console.log("ERROR1:" + t), console.log(a + ":" + value)
    }
  }
}


function getRandomString(t) {
  var s = "abacdefghjklmnopqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ0123456789",
    a = s.length - 1,
    e = "";
  t = t || 15;
  for (var i, n = 0; n < t; n++) i = (i = function (t, a, e, i) {
    var n = Math.floor(Math.random() * (a - t + 1) + t);
    return n = 0 == e && s.length - 10 <= n ? i(t, a, e, i) : n
  })(0, a, n, i), e += s[i];
  return e
}

getRealtimeData();
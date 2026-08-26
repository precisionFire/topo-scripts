

//mqtt服务器地址
var mqttHost = "172.15.87.112";
//端口号 
var port = 8083;
//客户机订阅标识 
var clientId = "testmq" + getRandomString(5);

var IsConnected = false;
var initialflag = false;
//创建对象 
client = new Paho.MQTT.Client(mqttHost, port, clientId);
ReConnect();
setInterval(ReConnect, 8000);
// 连接成功就订阅主题 
function onConnect() {
    if (!initialflag) {
        client.subscribe('JSONTag/MQDD/Chart1/Line1'); //订阅主题
        initialflag = true;
    }
    //发送消息
    window.onbeforeunload = function () {
        for (var name in _ListSubscribe) {
            client.unsubscribe(name);
        }
    };
}

client.onConnectionLost = onConnectionLost; //注册连接断开处理事件
client.onMessageArrived = onMessageArrived; //注册消息接收处理事件

function onConnectionLost(responseObject) {
    if (responseObject.errorCode !== 0) {
        IsConnected = false;
    }
}

// 连接成功就订阅主题 
function ReConnect() {
    if (!IsConnected) {
        client.connect({
            //连接服务器成功后执行的函数 
            onSuccess: onConnect,
            cleanSession: false,
            useSSL: false, // 心跳 
            keepAliveInterval: 30,
            timeout: 5,
            //userName:"ss", 
            //password:"xxx", 
        });
    }
}

function onMessageArrived(message) {
    /*     {
    "topic":"echart1",
    "data": {
          "data":[0.75, 0.65],
        }
  } */

    // var ResData = jQuery.parseJSON(message.payloadString);
    // option1.series[0].data = ResData.data;
    // // 使用刚指定的配置项和数据显示图表。
    // myChart.setOption(option1);
    // eval("echarts_" + ResData.topic + "('echart" + ResData.topic + "',ResData.data);")
}
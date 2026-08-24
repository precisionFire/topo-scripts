var _ListSubscribe = {},
    _ListCal = {},
    BindCom = {};

function BindDataToPage(t) {
    null != t.ListSubscribe && (_ListSubscribe = t.ListSubscribe),
    null != t.ListCal && (_ListCal = t.ListCal),
    t.each(function(t) {
        var i = t.getDataBindings();
        if (i) {
            for (var a in i.a) {
                var e = {
                    data: t,
                    db: s = i.a[a],
                    name: a,
                    protype: "a"
                };
                s.id.startsWith("Local:") || (s.id.startsWith("NumTag") ? _ListSubscribe[s.id] = 0 : s.id.startsWith("JSONTag") ? _ListSubscribe[s.id] = {} : (s.id.startsWith("TextTag")|| s.id.startsWith("TEXTTag")|| s.id.startsWith("TexTag")) && (_ListSubscribe[s.id] = "")),
                BindCom[s.id] || (BindCom[s.id] = []),
                BindCom[s.id].push(e)
            }
            for (var a in i.s) {
                e = {
                    data: t,
                    db: s = i.s[a],
                    name: a,
                    protype: "s"
                };
                s.id.startsWith("Local:") || (s.id.startsWith("NumTag") ? _ListSubscribe[s.id] = 0 : s.id.startsWith("JSONTag") ? _ListSubscribe[s.id] = {} : (s.id.startsWith("TextTag")|| s.id.startsWith("TEXTTag")|| s.id.startsWith("TexTag")) && (_ListSubscribe[s.id] = "")),
                BindCom[s.id] || (BindCom[s.id] = []),
                BindCom[s.id].push(e)
            }
            for (var a in i.p) {
                var s, e = {
                    data: t,
                    db: s = i.p[a],
                    name: a,
                    protype: "s"
                };
                s.id.startsWith("Local:") || (s.id.startsWith("NumTag") ? _ListSubscribe[s.id] = 0 : s.id.startsWith("JSONTag") ? _ListSubscribe[s.id] = {} : (s.id.startsWith("TextTag")|| s.id.startsWith("TEXTTag")|| s.id.startsWith("TexTag")) && (_ListSubscribe[s.id] = "")),
                BindCom[s.id] || (BindCom[s.id] = []),
                BindCom[s.id].push(e)
            }
        }
    }),
    Subscribe(),
    setInterval(CalTags, 1e3);
}

function Subscribe() {
    var t = "testmq" + getRandomString(5),
        i = !1,
        a = !1;

    function e() {
        i = !0;
        console.log("连接服务器成功");
        if (!a) {
            for (var t in _ListSubscribe)
                client.subscribe(t);
            a = !0;
        }
        window.onbeforeunload = function() {
            for (var t in _ListSubscribe)
                client.unsubscribe(t);
        };
    }

    function s() {
        if (!i) {
            client.connect({
                onSuccess: e,
                cleanSession: !1,
                useSSL: true,
                keepAliveInterval: 30,
                timeout: 10
            });
        }
    }

    client = new Paho.MQTT.Client("bar.dayesteel.com.cn", 443, t);
    s();
    setInterval(s, 8e3);

    client.onConnectionLost = function(t) {
        if (t.errorCode !== 0) {
            console.log("连接已断开");
            i = !1;
        }
    };

    client.onMessageArrived = function(t) {
        var topic = t.destinationName;
        var payload = "";

        try {
            // 尝试使用 payloadString 解析
            payload = t.payloadString;
        } catch (err) {
            // fallback：尝试 TextDecoder 解码字节流
            try {
                payload = new TextDecoder("utf-8", { fatal: false }).decode(t.payloadBytes);
            } catch (decodeErr) {
                console.error("ERROR1: payload 解码失败", decodeErr);
                console.log("原始字节:", Array.from(t.payloadBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
                return;
            }
        }

        try {
            if (topic in _ListSubscribe) _ListSubscribe[topic] = payload;
            BindDtop(topic, payload);
        } catch (finalErr) {
            console.log("ERROR1:" + finalErr);
            console.log(topic + ":" + payload);
        }
    };
}

function BindDtop(i, a) {
    try {
        if (i in BindCom) {
            (i.startsWith("JSONTag") || i.startsWith("TexTag")) && (a = JSON.parse(a));
            for (var t = 0; t <= BindCom[i].length; t++) {
                var e = BindCom[i][t];
                if (e)
                    switch (e.protype) {
                        case "a":
                            e.db.func ? e.data.a(e.name, e.db.func(a)) : e.data.a(e.name, a);
                            break;
                        case "s":
                            e.db.func ? e.data.s(e.name, e.db.func(a)) : e.data.s(e.name, a);
                            break;
                        default:
                            e.db.func ? e.data[ht.Default.setter(e.name)](e.db.func(a)) : e.data[ht.Default.setter(e.name)](a)
                    }
            }
        }
    } catch (t) {
        console.log("ERROR:" + t),
        console.log(i + ":" + a)
    }
}

function CalTags() {
    for (var itemBind in _ListCal)
        try {
            for (var das = [], i = 0; i < _ListCal[itemBind].datas.length; i++) {
                const element = _ListCal[itemBind].datas[i];
                element in _ListSubscribe ? das.push(_ListSubscribe[element]) : element in _ListCal ? das.push(_ListCal[element].value) : das.push(0);
            }
            var value = eval(_ListCal[itemBind].formate.format(das));
            _ListCal[itemBind].value = value;
            BindDtop(itemBind, value);
        } catch (error) {
            console.log("ERROR2:" + error),
            console.log(itemBind + ":" + value)
        }
}

function getRandomString(t) {
    var n = "abacdefghjklmnopqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ0123456789",
        i = n.length - 1,
        a = "";
    t = t || 15;
    for (var e, s = 0; s < t; s++)
        e = (e = function(t, i, a, e) {
            var s = Math.floor(Math.random() * (i - t + 1) + t);
            return s = 0 == a && n.length - 10 <= s ? e(t, i, a, e) : s
        })(0, i, s, e),
        a += n[e];
    return a;
}

String.prototype.format = function(t) {
    if (0 == t.length)
        return this;
    for (var i = this, a = 0; a < t.length; a++)
        i = i.replace(new RegExp("\\{" + a + "\\}", "g"), t[a]);
    return i;
};

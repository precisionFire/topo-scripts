$(function () {
    var key = GetQueryString("key");
    if (key == 1) {
        $.messager.alert("系统提示：", "初次登陆，请修改密码！");
    }
    //注销登录
    $("#logout").click(function () {
        $.messager.confirm("系统提示：", "您将退出系统！", function (btn) {
            if (btn) {
                ClearSession();
            } else {
                $.messager.show({
                    title: '系统提示：',
                    msg: '取消退出！',
                    timeout: 3000,
                    height: 100,
                    showType: 'slide'
                });
            }
        });
    })
})
//修改密码
function ChangePWD() {
    var username = $("#userName").val();
    var passwordold = $("#Oldpsd").val();
    var passwordnew = $("#psd").val();
    var passwordchk = $("#psd1").val();
    if (!username || !passwordold || !passwordnew || !passwordchk) {
        $.messager.alert("系统提示", "请将信息填写完整！");
        return;
    }
    if (passwordnew != passwordchk) {
        $.messager.alert("系统提示", "两次密码不一致！");
        return;
    }
    if (true) {

    }
    $.messager.prompt('信息验证', '请输入贵公司全称：', function (r) {
        $.messager.progress({ title: "请稍后..." });
        if (r) {
            var data = { type: 2, username: username, password: passwordold, passwordnew: passwordchk, supplyname: r };
            $.post("../ashx/Login/Login.ashx", data,
                function (result) {
                    console.log(result);
                    $.messager.progress("close");
                    if (result.State == 1) {
                        $.messager.show({
                            title: '系统提示：',
                            msg: result.Message,
                            timeout: 3000,
                            height: 100,
                            showType: 'slide'
                        });
                    }
                    else {
                        $.messager.alert("系统提示", result.Message);
                    }
                    $("#submit").val("登  录");
                }, "json");
        }
        else if (r == "" || r == undefined) {
            $.messager.progress("close");
            $.messager.alert("系统提示", "请输入供应商名称以便校验！");
        }
    });

}

//清除session
function ClearSession() {
    var data = { type: 3 };
    $.get("../ASHX/Index/Index.ashx", data,
        function (result) {
            console.log(result);
            if (result) {
                window.location.href = (result.Message);
            }
        }, "json");
}
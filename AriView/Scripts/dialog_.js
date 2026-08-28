window.Modal = class Modal {
    constructor(options) {
        // 默认：标题，内容，关闭按钮，取消按钮，确定按钮，取消文本，确定文本，取消方法，确定方法。合并数据对象
        this.options = Object.assign(
            {
                title: 'XXX历史数据',
                tag: '',
                pageUrl: '',
                content: '',
                showMaximize: true,
                showPlus: true,
                showDown: true,
                showClose: true,
                showCancel: true,
                showConfirm: true,
                cancenText: '×',
                confirmText: '确定',
                onCancel: () => {
                    this.closeModal()
                },
                onConfirm: () => {
                    this.confirmModal()
                },
                onMaximize: () => {
                    this.maxBox()
                },
                onPlus: () => {
                    this.plusBox()
                },
                onDown: () => {
                    this.downBox()
                }
            },
            options
        )
    }

    init() {
       /* let modalBgDom = document.createElement('div')
        modalBgDom.className = 'modal_bg'
        modalBgDom.id = 'modal_bg'
        let modalBoxDom = document.createElement('div')
        modalBoxDom.className = 'modal_box'
        modalBoxDom.id = "modal_box"
        modalBoxDom.draggable = true
        let modalHeadDom = document.createElement('div')
        modalHeadDom.className = 'modal_head'
        modalHeadDom.innerText = this.options.title;
        modalHeadDom.style = 'text-align:center;font-size:16px;'
        this.createHead(modalHeadDom)
        let modalContentDom = document.createElement('div')
        modalContentDom.className = 'modal_content'
        let iframe = document.createElement('iframe');
        // iframe.src = '../custom/HistoricalDataDialog/DataDialog.html?tag=' + this.tag + '&name=' + encodeURI(encodeURI(this.title))
        iframe.src = this.options.pageUrl;

        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.frameBorder = '0';

        modalContentDom.appendChild(iframe);

        // let modalFootDom = document.createElement('div')
        // modalFootDom.className ='modal_foot'
        // this.cerateFoor(modalFootDom)
        modalBoxDom.appendChild(modalHeadDom)
        modalBoxDom.appendChild(modalContentDom)
        // modalBoxDom.appendChild(modalFootDom)
        modalBgDom.appendChild(modalBoxDom)
        document.body.appendChild(modalBgDom)

        // fetch(this.options.pageUrl).then(res => res.text()).then(html => {
        //     modalContentDom.innerHTML = html;
        // })
	*/

    }
    createHead(modalHeadDom) {
        if (this.options.showClose) {
            let closeDom = document.createElement('div')
            closeDom.className = 'modal_close'
            closeDom.title = '关闭'
            closeDom.onclick = this.options.onCancel
            closeDom.innerHTML = '×'
            modalHeadDom.appendChild(closeDom)
        }
        if (this.options.showMaximize) {
            let maxDom = document.createElement('div')
            maxDom.className = 'modal_buttonr'
            maxDom.title = '最大化'
            maxDom.onclick = this.options.onMaximize
            maxDom.innerHTML = '□'
            modalHeadDom.appendChild(maxDom)
        }
        if (this.options.showPlus) {
            let plusDom = document.createElement('div')
            plusDom.className = 'modal_buttonl'
            plusDom.title = '放大窗口'
            plusDom.onclick = this.options.onPlus
            plusDom.innerHTML = '+'
            modalHeadDom.appendChild(plusDom)
        }
        if (this.options.showDown) {
            let downDom = document.createElement('div')
            downDom.className = 'modal_buttonl'
            downDom.title = '缩小窗口'
            downDom.onclick = this.options.onDown
            downDom.innerHTML = '-'
            modalHeadDom.appendChild(downDom)
        }
    }
    // createContent(modalContentDom){
    //     modalContentDom.innerHTML = this.pageUrl;
    // }

    // 暂不启用  但保留
    // cerateFoor(modalFootDom){
    //     if(this.options.showCancel){
    //         let cancelDom = document.createElement('div')
    //         cancelDom.className ='modal_btn modal_cancel'
    //         cancelDom.innerText = this.options.cancenText
    //         cancelDom.onclick = this.options.onCancel
    //         modalFootDom.appendChild(cancelDom)
    //     }
    //     // if(this.options.showConfirm){
    //     //     let confirmDom = document.createElement('div')
    //     //     confirmDom.className ='modal_btn modal_confirm'
    //     //     confirmDom.innerText = this.options.confirmText
    //     //     confirmDom.onclick = this.options.onConfirm
    //     //     modalFootDom.appendChild(confirmDom)
    //     // }
    // }
    closeModal() {
        document.body.removeChild(document.getElementsByClassName('modal_bg')[0])
    }
    confirmModal() {
        document.body.removeChild(document.getElementsByClassName('modal_bg')[0])
    }
    maxBox() {
        let theBox = document.getElementById('modal_box');
        let theBg = document.getElementById('modal_bg');
        theBox.style.left = '10px'
        theBox.style.top = '5px'
        theBox.style.width = theBg.offsetWidth - 20 + 'px'
        theBox.style.height = theBg.offsetHeight - 10 + 'px'
    }
    plusBox() {
        let theBox = document.getElementById('modal_box');
        let theBg = document.getElementById('modal_bg');
        theBox.style.left = '10px'
        theBox.style.top = '5px'
        theBox.style.width = (theBox.offsetWidth * 1.05) < theBg.offsetWidth ? (theBox.offsetWidth * 1.05) + 'px' : (theBg.offsetWidth - 20) + 'px'
        theBox.style.height = (theBox.offsetHeight * 1.05) < theBg.offsetHeight ? (theBox.offsetHeight * 1.05) + 'px' : (theBg.offsetHeight - 10) + 'px'
    }
    downBox() {
        let theBox = document.getElementById('modal_box');
        let theBg = document.getElementById('modal_bg');
        theBox.style.left = '10px'
        theBox.style.top = '5px'
        theBox.style.width = (theBox.offsetWidth * 0.95) > 1000 ? (theBox.offsetWidth * 0.95) + 'px' : 1000 + 'px'
        theBox.style.height = (theBox.offsetHeight * 0.95) > 500 ? (theBox.offsetHeight * 0.95) + 'px' : 500 + 'px'
    }

    registerEvent() {
        let theBox = document.getElementById('modal_box');
        const origin = { x: 0, y: 0 };
        // 拖动开始
        document.addEventListener("dragstart", function (event) {
            console.log(event.type, event);
            const target = event.target;

            if (target.id !== theBox.id) {
                return;
            }
            document.querySelectorAll('iframe').forEach(e => e.classList.add('__pointer-events-none'));
            // 记录被拖动的元素的起始坐标
            origin.x = event.clientX;
            origin.y = event.clientY;

            console.log("Origin:", origin.x, origin.y);

            target.style.opacity = 0.8;
        }, false);

        // 拖动结束
        document.addEventListener("dragend", function (event) {
            console.log(event.type, event);
            const target = event.target;

            if (target.id !== theBox.id) {
                return;
            }

            target.style.opacity = "";

            // 计算拖动结束之后，元素的终点坐标与起始坐标的偏移
            const offsetX = event.clientX - origin.x;
            const offsetY = event.clientY - origin.y;

            console.log("Offset:", offsetX, offsetY);

            // 修改元素的位置
            target.style.setProperty("top", `${target.offsetTop + offsetY}px`);
            target.style.setProperty("left", target.offsetLeft + offsetX + "px");
            document.querySelectorAll('iframe').forEach(e => e.classList.remove('__pointer-events-none'));
        }, false);

        document.addEventListener("dragover", function (event) {
            event.preventDefault();
        }, false);
    }
}

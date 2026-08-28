function openHistoricalDialog(tag, name) {
	alert(11)
    if (false) {
        let tag_ = "NumTag/WeightInFurFlat/扁钢称重/Flat_ Furnace_Weight1"
        let url = window.location.origin + '/custom/HistoricalDataDialog/DataDialog.html?tag=' + encodeURI(encodeURI(tag_)) + '&name=' + encodeURI(encodeURI(name)) + 'time=' + Date.now();
        // let url = window.location.origin + '/custom/HistoricalDataDialog/test.html?tag=' + encodeURI(encodeURI(tag_)) + '&name=' + encodeURI(encodeURI(name)) + 'time=' + Date.now();
        const modal = new window.Modal({ title: name, pageUrl: url, tag: tag })
        modal.init()
        modal.registerEvent()
    } else {
		alert(123)
        const dialogTitle = name || "历史趋势";
        let tag_ = "NumTag/WeightInFurFlat/扁钢称重/Flat_ Furnace_Weight1"
        const url = `${window.location.origin}/custom/HistoricalDataDialog/DataDialog.html?tag=${encodeURI(encodeURI(tag_))}&name=${encodeURI(name)}`;
        openModalWithIframe(url, dialogTitle);

        function openModalWithIframe(url, title) {
            // 检查是否已存在模态框，存在则重用
            if (document.getElementById('myModal')) {
                document.getElementById('iframe').src = url;
                document.getElementById('myModalLabel').textContent = title;
                const modal = new bootstrap.Modal(document.getElementById('myModal'));
                updateDateTime(); // 立即更新时间
                modal.show();
                return;
            }

            // 创建模态框HTML
            const modalHTML = `
          <div class="modal fade" id="myModal" tabindex="-1" aria-labelledby="myModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-xl">
              <div class="modal-content">
                <div class="modal-header" style="padding: 0.3rem 1rem;">
                  <h5 class="modal-title" id="myModalLabel">${title}</h5>
                  <span id="datetime" class="ms-3" style="font-size:16px;">--:--</span>
                 <!-- <button type="button" class="btn btn-sm btn-outline-secondary ms-2" id="fullscreenBtn">
                    <i class="bi bi-arrows-fullscreen"></i>
                  </button> -->
                  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭" style="font-size: 1rem;"></button>
                </div>
                <div class="modal-body" style="height:600px;padding-top: 0;padding-bottom:0;">
                  <iframe id="iframe" src="${url}" width="100%" height="100%" frameborder="0"></iframe>
                </div>
               <!-- <div id="resizer" style="width: 15px; height: 15px; position: absolute; right: 0; bottom: 0; cursor: se-resize;"></div> -->
              </div>
            </div>
          </div>
        `;

            // 添加模态框到DOM
            const container = document.createElement('div');
            container.innerHTML = modalHTML;
            document.body.appendChild(container);

            // 显示模态框
            const modal = new bootstrap.Modal(document.getElementById('myModal'));
            modal.show();

            // 初始化拖拽和调整大小功能
            modal._element.addEventListener('shown.bs.modal', () => {
                // initializeModalControls('myModal');
                updateDateTime(); // 立即更新一次时间
                startTimeUpdater(); // 开始时间更新
            });
        }
    }

    // 初始化模态框的所有控制功能
    function initializeModalControls(modalId) {
        makeModalDraggable(modalId);
        setupFullscreenToggle(modalId);
    }

    // 使模态框可拖动
    function makeModalDraggable(modalId) {
        const modal = document.getElementById(modalId);
        const dialog = modal.querySelector('.modal-dialog');
        const header = modal.querySelector('.modal-header');
        const resizer = modal.querySelector('#resizer');

        let isDragging = false, isResizing = false;
        let offsetX, offsetY, startX, startY, startWidth, startHeight;

        // 拖拽功能
        header.style.cursor = 'move';
        header.onmousedown = function (e) {
            if (e.target.closest('button')) return; // 忽略按钮上的拖动

            e.preventDefault();
            isDragging = true;

            // 获取对话框的当前位置和尺寸
            const rect = dialog.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            // 固定对话框位置以便拖动
            dialog.style.margin = '0';
            dialog.style.position = 'fixed';
            dialog.style.maxWidth = 'none';
            dialog.style.width = `${rect.width}px`;
            dialog.style.height = `${rect.height}px`;
            dialog.style.left = `${rect.left}px`;
            dialog.style.top = `${rect.top}px`;

            // 拖动处理
            function moveHandler(e) {
                if (!isDragging) return;

                let left = e.clientX - offsetX;
                let top = e.clientY - offsetY;

                // 限制在视口范围内
                left = Math.max(0, Math.min(window.innerWidth - dialog.offsetWidth, left));
                top = Math.max(0, Math.min(window.innerHeight - dialog.offsetHeight, top));

                dialog.style.left = `${left}px`;
                dialog.style.top = `${top}px`;
            }

            // 释放鼠标时解除拖动
            function upHandler() {
                isDragging = false;
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);
            }

            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        };

        // 调整大小功能
        resizer.onmousedown = function (e) {
            e.preventDefault();
            isResizing = true;

            const rect = dialog.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startWidth = rect.width;
            startHeight = rect.height;

            function resizeHandler(e) {
                if (!isResizing) return;

                const newWidth = startWidth + (e.clientX - startX);
                const newHeight = startHeight + (e.clientY - startY);

                dialog.style.width = `${Math.max(400, newWidth)}px`;
                dialog.style.height = `${Math.max(300, newHeight)}px`;
            }

            function resizeUpHandler() {
                isResizing = false;
                document.removeEventListener('mousemove', resizeHandler);
                document.removeEventListener('mouseup', resizeUpHandler);
            }

            document.addEventListener('mousemove', resizeHandler);
            document.addEventListener('mouseup', resizeUpHandler);
        };
    }

    // 设置全屏切换功能
    function setupFullscreenToggle(modalId) {
        const modal = document.getElementById(modalId);
        const dialog = modal.querySelector('.modal-dialog');

        document.getElementById('fullscreenBtn').addEventListener('click', () => {
            const icon = document.querySelector('#fullscreenBtn i');

            // 保存当前位置和尺寸信息
            const rect = dialog.getBoundingClientRect();
            const wasFullscreen = dialog.classList.contains('fullscreen-mode');

            if (!wasFullscreen) {
                // 进入全屏模式 - 保存当前位置以便恢复
                dialog.dataset.originalWidth = rect.width;
                dialog.dataset.originalHeight = rect.height;
                dialog.dataset.originalLeft = rect.left;
                dialog.dataset.originalTop = rect.top;

                // 设置为全屏并居中
                dialog.classList.add('fullscreen-mode');
                dialog.style.margin = '0';
                dialog.style.position = 'fixed';
                dialog.style.width = '90vw';
                dialog.style.height = '90vh';
                dialog.style.left = '5vw';  // 左边 5% 视口宽度
                dialog.style.top = '5vh';   // 顶部 5% 视口高度

                // 更新图标
                icon.className = 'bi bi-fullscreen-exit';
            } else {
                // 退出全屏模式 - 恢复到原始位置和尺寸
                dialog.classList.remove('fullscreen-mode');

                if (dialog.dataset.originalWidth) {
                    dialog.style.width = `${dialog.dataset.originalWidth}px`;
                    dialog.style.height = `${dialog.dataset.originalHeight}px`;

                    // 只有当有原始位置时才恢复位置
                    if (dialog.dataset.originalLeft) {
                        dialog.style.left = `${dialog.dataset.originalLeft}px`;
                        dialog.style.top = `${dialog.dataset.originalTop}px`;
                    }
                }

                // 更新图标
                icon.className = 'bi bi-arrows-fullscreen';
            }
        });
    }

    // 更新时间显示
    function updateDateTime() {
        const week = ["日", "一", "二", "三", "四", "五", "六"];
        const time = new Date();
        const datetimeElement = document.getElementById("datetime");

        if (datetimeElement) {
            datetimeElement.innerText = `${time.getFullYear()}/${time.getMonth() + 1}/${time.getDate()} ${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')} 星期${week[time.getDay()]}`;
        }
    }

    // 启动时间更新器
    function startTimeUpdater() {
        updateDateTime(); // 立即更新一次
        // 设置定时更新
        const timeUpdateInterval = setInterval(() => {
            // 检查元素是否还存在，不存在则停止更新
            if (!document.getElementById("datetime")) {
                clearInterval(timeUpdateInterval);
                return;
            }
            updateDateTime();
        }, 1000);
    }

    // 添加 CSS 样式
    (function addStyles() {
        if (document.getElementById('modal-custom-styles')) return;

        const style = document.createElement('style');
        style.id = 'modal-custom-styles';
        style.textContent = `
      .fullscreen-mode {
        width: 90vw !important;
        height: 90vh !important;
        max-height: 90vh !important;
        z-index: 1055 !important;
      }
      
      .modal-dialog {
        transition: width 0.3s, height 0.3s, left 0.3s, top 0.3s !important;
      }
      
      #resizer {
        background-color: rgba(200, 200, 200, 0.3);
        border-radius: 50%;
        width: 16px;
        height: 16px;
      }
      
      #resizer:hover {
        background-color: rgba(150, 150, 150, 0.5);
      }
    `;
        document.head.appendChild(style);
    })();
}
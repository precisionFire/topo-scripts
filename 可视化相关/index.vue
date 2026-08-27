<template>
  <div class="app-container">
    <!--<el-button @click="test" v-if="false">测试</el-button>-->
    <div>
      <i-frame ref="myFrame" :src="url" id="iframe"></i-frame>
    </div>
  </div>
  <el-dialog title="弹窗" v-model="openDialog" :teleported="false">
    <div>弹窗内容</div>
  </el-dialog>

  <modalView
    v-model="openViewFile"
    :width="1500"
    :height="900"
    title="文件预览"
    :isShowFooter="false"
    @onConfirm="openViewFile = false"
    @onCancel="openViewFile = false"
  >
    <vue-office-pdf :src="remoteFileUrl" @rendered="renderedHandler" @error="errorHandler" />
    <!--<ExcelPage :fileUrl="remoteFileUrl" />-->
  </modalView>

  <HistoryDataModal
    v-if="openHistoryDataModal"
    v-model="openHistoryDataModal"
    :width="1500"
    title="曲线趋势"
  ></HistoryDataModal>
</template>

<script setup>
import { onBeforeMount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
const route = useRoute();

import iFrame from '@/components/iFrame/index.vue';
import ExcelPage from '@/views/vDemo/excel/index.vue';
import { getpresignedurl } from '@/api/file';
import VueOfficePdf from '@vue-office/pdf';
import { ElMessage } from 'element-plus';

import HistoryDataModal from '@/components/HistoryDataModal';

const drawingPath = '/static/AriView/storage/index.html?tag=';

const url = ref(null);

const openDialog = ref(false);

const remoteFileUrl = ref(null);

const fileUrl = ref(null);

const openViewFile = ref(false);

const openHistoryDataModal = ref(false);

// function test() {
//   openHistoryDataModal.value = true;
// }

// const url = ref('/static/AriView1/storage/index.html?tag=displays/可视化看板/网关状态P1.json')

onBeforeMount(() => {
  const params = route?.meta?.param1;
  console.log(`${drawingPath}${params}`);
  const token = localStorage.getItem('Admin-Token');
  url.value = `${drawingPath}${params}&token=${encodeURIComponent(token)}`;
});

// 与子页面传递数据
// function sendMessage() {
//   let fdata = { type: 'init', value: 'Hello from parent!' }; // 传递数据
//   let iframe = document.getElementById('iframe');
//   if (iframe && iframe.contentWindow) {
//     iframe.contentWindow.postMessage(fdata, '*');
//   }
// }

onMounted(() => {
  window.addEventListener('message', getMsgForChild);
});

const renderedHandler = () => {
  console.log('渲染完成');
};

const errorHandler = () => {
  console.log('渲染失败');
};

// 接收子页面数据
const getMsgForChild = async e => {
  if (e.data.type === 'fileview') {
    const { Data } = e.data.data;
    console.error(Data);
    if (!Data) {
      ElMessage.warning('暂无数据！');
      return;
    }
    fileUrl.value = Data;
    await viewProcessCard();
    openViewFile.value = true;
  }
  if (e.data.type === 'finalthree') {
    // ElMessage.warning('最后三支！');
    openHistoryDataModal.value = true;
  }
};

// 查看文件
function viewProcessCard() {
  getFileUrl({ bucketName: 'processsheet', objecturl: fileUrl.value });
}

// 获取服务器文件
async function getFileUrl(params) {
  const res = await getpresignedurl(params);
  if (res.Code && res.Code === 200) {
    if (!res.Data) return;
    remoteFileUrl.value = res.Data;
  }
}
</script>

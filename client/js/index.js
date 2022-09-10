'use strict';
import ws from './websocket.js';
import pc from './webRtc.js';
import { storage } from './helper.js';

window.addEventListener("DOMContentLoaded", init);

let MESSAGE_TYPE; // Message type
const proxyData = new Proxy({ info: {}, messages: [] }, { set: handleProxyData });

async function init() {
  proxyData.info = storage.get('info') || {};

  MESSAGE_TYPE = await (await fetch('http://localhost:8000/type', { method: 'POST' })).json();
  ws.init({ message: handleWsMessage }, MESSAGE_TYPE);
  pc.init({ ws }, MESSAGE_TYPE);
  handleEventRegister();
}

// 註冊事件
function handleEventRegister() {
  const openMediaBtn = document.querySelector('#openMediaBtn'),
    sendOfferBtn = document.querySelector('#sendOfferBtn'),
    joinRoomBtn = document.querySelector('#joinBtn'),
    getInfoBtn = document.querySelector('#getInfoBtn'),
    leaveBtn = document.querySelector('#leaveBtn'),
    inputText = document.querySelector('#inputText');

  openMediaBtn.addEventListener("click", pc.handleOpenUserMedia);
  sendOfferBtn.addEventListener("click", pc.handleSendOffer);
  joinRoomBtn.addEventListener("click", handleJoinRoom);
  getInfoBtn.addEventListener("click", handleUserInfo);
  leaveBtn.addEventListener("click", handleLeaveRoom);
  inputText.addEventListener("keyup", handleRoomSendMessage);
}

// 加入聊天室
function handleJoinRoom() {
  const info = {
    name: document.getElementById('name').value,
    role: document.getElementById('roles').value,
    roomId: document.getElementById('room-id').value,
  }

  storage.set('info', info);
  proxyData.info = info;
  ws.sendMessage({
    type: MESSAGE_TYPE.JOIN_ROOM,
    payload: info,
  });
}

// 發送聊天室訊息
function handleRoomSendMessage(evt) {
  if (!proxyData.info.roomId || evt.shiftKey) return;

  if (evt.key === 'Enter' || evt.keycode === 13) {
    ws.sendMessage({
      type: MESSAGE_TYPE.SEND_MESSAGE,
      payload: { message: evt.target.value },
    });
    evt.target.value = '';
  };
};

// 取得使用者資訊
function handleUserInfo() {
  ws.sendMessage({ type: MESSAGE_TYPE.INFO });
};

// 離開聊天室
function handleLeaveRoom() {
  storage.clear();
  proxyData.info = {};
  ws.leaveRoom();
};

// Proxy dataObj to view
function handleProxyData(obj, key, val, _receive) {
  if (key === 'info') {
    const chatProfile = document.getElementById('chatProfile');
    const chatArea = document.getElementById('chatArea');

    if (val.roomId) {
      chatProfile.classList.add('hidden');
      chatArea.classList.remove('hidden');
    } else {
      chatProfile.classList.remove('hidden');
      chatArea.classList.add('hidden');
    }
    obj[key] = val;
  }

  if (key === 'messages') {
    const chatWrapper = document.getElementById('chatMessageWrapper');
    const renderMessageStr = (message) => {
      return `
        <li class="text-left mx-3 my-2 p-2 rounded border-2 border-cyan-500">
          <div class="flex">
            <div class="mr-2">name</div>
            <div>${new Date().toLocaleString()}</div>
          </div>
          <div>${message}</div>
        </li>
      `;
    }
    if (typeof val === 'string') {
      obj[key].push(val);

      chatWrapper.insertAdjacentHTML('beforeend', renderMessageStr(val));
    }
    if (Array.isArray(val)) {
      obj[key] = val;
      const fragment = document.createDocumentFragment();

      obj[key].forEach(message => {
        const tmpDiv = document.createElement('div');
        tmpDiv.innerHTML = renderMessageStr(message);
        fragment.appendChild(tmpDiv.firstElementChild);
      })

      chatWrapper.appendChild(fragment);
    }
  }
  // console.log(`🚀 ~ handleProxyData ~ obj`, obj);
  // console.log(`🚀 ~ handleProxyData ~ val`, val);
  // console.log(`🚀 ~ handleProxyData ~ key`, key);
  return true;
}

// 接收 websocket message
async function handleWsMessage(evt) {
  const resp = JSON.parse(evt.data);
  // if (resp.code !== 200 && !resp.timestamp) {
  //   return console.error(`UnExpect error!!! code: ${resp.code}`)
  // }

  switch (resp.type) {
    // 接收訊息
    case MESSAGE_TYPE.MESSAGE: {
      console.log('RECEIVE_MESSAGE => \n', resp.message);
      proxyData.messages = resp.message;
      break;
    };

    // 接收Response
    case MESSAGE_TYPE.RESPONSE: {
      console.log('RECEIVE_RESPONSE => \n', resp);
      break;
    };

    // 接收 WebRtc Offer, 傳送 answer
    case MESSAGE_TYPE.RECEIVE_OFFER: {
      // step1: Receive offer -> setRemoteDesc(offer)
      await pc.handleRemoteDescription(resp.data.offer);
      // step2: Init media
      await pc.handleOpenUserMedia();
      // step3: Create answer -> send answer and setLocalDesc(answer); 
      await pc.handleSendAnswer();
      console.log('RECEIVE_OFFER => \n', resp.data.offer);
      break;
    };

    // 接收 WebRtc Answer
    case MESSAGE_TYPE.RECEIVE_ANSWER: {
      // step1: Receive answer -> setRemoteDesc(answer)
      await pc.handleRemoteDescription(resp.data.answer);
      console.log('RECEIVE_ANSWER => \n', resp.data.answer);
      break;
    };

    // 接收 WebRtc candidate，並加入到 WebRtc candidate 候選人中
    case MESSAGE_TYPE.RECEIVE_CANDIDATE: {
      pc.handleAppendNewCandidate(resp.data.candidate);
      console.log('RECEIVE_CANDIDATE => \n', resp.data.candidate);
      break;
    };

    // 儲存使用者資訊(id, name, role, roomId)
    case MESSAGE_TYPE.INFO: {
      console.log('RECEIVE_INFO => \n', resp.data);
      proxyData.info = resp.data;
      break;
    };

    default: return;
  }
};

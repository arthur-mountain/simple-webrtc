'use strict';
import ws from './websocket.js';
import pc from './webRtc.js';

window.addEventListener("DOMContentLoaded", init);

let MESSAGE_TYPE; // Message type
const proxyData = new Proxy({ info: null, messages: [] }, { set: handleProxyData });

// @TODO: pc.createRtcConnect 會建立多個 peer connect for multiple room.
async function init() {
  MESSAGE_TYPE = await (await fetch('http://localhost:8000/type', { method: 'POST' })).json();
  ws.init({ message: handleWsMessage, }, MESSAGE_TYPE);
  pc.init({ ws, }, MESSAGE_TYPE);
  handleEventRegister();
  // @TODO: 應該在 proxy info 裡進行 ws.joinRoom, 不過會遇到 ws 尚未連接完畢就 send message 的錯誤
  proxyData.info = storage.get('info');
}

// 註冊事件
function handleEventRegister() {
  const mediaBtn = document.querySelector('#mediaBtn'),
    joinRoomBtn = document.querySelector('#joinBtn'),
    getInfoBtn = document.querySelector('#getInfoBtn'),
    leaveBtn = document.querySelector('#leaveBtn'),
    inputText = document.querySelector('#inputText'),
    toggleChatWin = document.querySelector('#toggleChatWin');

  mediaBtn.addEventListener("click", pc.handleOpenUserMedia);
  joinRoomBtn.addEventListener("click", handleJoinRoom);
  getInfoBtn.addEventListener("click", handlePersonal);
  toggleChatWin.addEventListener("click", handleToggleChatWin);
  leaveBtn.addEventListener("click", handleLeaveRoom);
  inputText.addEventListener("keyup", handleRoomSendMessage);
}

// 開啟視訊
function handleOpenMedia(e) {
  let updatedText;

  if (e.target.textContent === "open video") {
    pc.handleOpenUserMedia();
    updatedText = "close video"
  } else {
    pc.handleWebRtcCleanUp();
    updatedText = "open video"
  }

  e.target.textContent = updatedText;
}

// 開關聊天窗
function handleToggleChatWin(e) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelector("#chatWin").classList.toggle("hidden");
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
  ws.joinRoom(info);
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
function handlePersonal() {
  ws.sendMessage({ type: MESSAGE_TYPE.RESPONSE_PERSONAL });
};

// 離開聊天室
function handleLeaveRoom() {
  storage.clear();
  proxyData.info = null;
  proxyData.messages = [];
  pc.handleWebRtcCleanUp();
  ws.leaveRoom();
};

// Proxy dataObj to view
function handleProxyData(obj, key, val, _receive) {
  if (key === 'info') {
    const chatProfile = document.getElementById('chatProfile');
    const chatArea = document.getElementById('chatArea');

    if (val && val.roomId) {
      chatProfile.classList.add('hidden');
      chatArea.classList.remove('hidden');
      pc.setUserInfo(obj[key] = val);
    } else {
      chatProfile.classList.remove('hidden');
      chatArea.classList.add('hidden');
    }

    return true;
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
    // 單筆訊息
    if (typeof val === 'string') {
      obj[key].push(val);

      chatWrapper.insertAdjacentHTML('beforeend', renderMessageStr(val));
    }
    // 多筆訊息(讀取歷史訊息...etc)
    if (Array.isArray(val) && val.length) {
      const fragment = document.createDocumentFragment();
      val.forEach(message => {
        const tmpDiv = document.createElement('div');
        tmpDiv.innerHTML = renderMessageStr(message);
        fragment.appendChild(tmpDiv.firstElementChild);
      });

      obj[key] = val;
      chatWrapper.appendChild(fragment);
    }

    return true;
  }
  // console.log(`🚀 ~ handleProxyData ~ obj`, obj);
  // console.log(`🚀 ~ handleProxyData ~ val`, val);
  // console.log(`🚀 ~ handleProxyData ~ key`, key);
  return false; // will print error when set unknown key to proxy object
}

// 接收 websocket message
async function handleWsMessage(evt) {
  const resp = JSON.parse(evt.data);

  // self to self => s to s(sts)
  // others to self => o to s(ots)
  // self to other => t to o(sto)
  switch (resp.type) {
    // 接收訊息(ots)
    case MESSAGE_TYPE.MESSAGE: {
      proxyData.messages = resp.message;
      log("RECEIVE_MESSAGE", resp.message);
      break;
    };

    // Response(sts)
    case MESSAGE_TYPE.RESPONSE:
    case MESSAGE_TYPE.RESPONSE_PERSONAL:
    case MESSAGE_TYPE.RESPONSE_ROOM_USERS:
    case MESSAGE_TYPE.RESPONSE_ERROR: {
      handleResponse(resp);
      break;
    };

    // 加入聊天室(ots)
    case MESSAGE_TYPE.ROOM_JOIN: {
      log("SOME ONE JOIN ROOM", resp);
      break;
    };

    // webRtc(ots)
    case MESSAGE_TYPE.WEB_RTC:
    case MESSAGE_TYPE.WEB_RTC_OPENED:
    case MESSAGE_TYPE.WEB_RTC_RECEIVE_OFFER:
    case MESSAGE_TYPE.WEB_RTC_RECEIVE_ANSWER:
    case MESSAGE_TYPE.WEB_RTC_RECEIVE_CANDIDATE: {
      pc.handleWebRtcMessage(resp);
      break;
    };

    // 有人離開聊天室(system)
    case MESSAGE_TYPE.SYSTEM_DISCONNECT: {
      pc.handleWebRtcDeleteById(resp.data.id);
      log("RECEIVE_DISCONNECT", resp);
      break;
    };

    default: {
      console.error("UnHandle ws message", resp);
    }
  }
};

function handleResponse(resp) {
  switch (resp.type) {
    // 儲存使用者資訊(id, name, role, roomId)(ots)
    case MESSAGE_TYPE.RESPONSE_PERSONAL: {
      proxyData.info = resp.data;
      log("RECEIVE_PERSONAL", resp.data);
      break;
    };

    default: {
      if (resp.code === "S200") { // ignore error, just log data
        log("IGNORE THIS RECEIVE_RESPONSE", resp);
      } else {
        console.error("UnHandle response sub type", resp);
      }
    }
  }
}

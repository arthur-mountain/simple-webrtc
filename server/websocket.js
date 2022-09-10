// import fs from 'fs';
import express from 'express';
import { v5 as uuidv5 } from 'uuid';
import WebSocket, { WebSocketServer, } from 'ws';
import EVENT_TYPE from './eventType.js';

const wss = new WebSocketServer({
  server: express().listen(8001, () => {
    console.log(`Server starting with port:8081...`);
  }),
  perMessageDeflate: {
    concurrencyLimit: 12, // Limits zlib concurrency for perf.
  }
});
// Room info
wss.rooms = {};

// Connect
wss.on('connection', (ws, req) => {
  console.log("WebSocket connected \n");
  handleConnected(ws, req);
  // Open
  ws.on('open', () => { console.log('WebSocket opened'); });
  // Close
  ws.on('close', () => { console.log('WebSocket disconnected'); });
  // Message
  ws.on('message', handleMessage(ws));
});

function handleMessage(client) {
  return function (data, isBinary) {
    if (isBinary) return handleBinaryData(data);

    const { type, payload } = JSON.parse(data);

    switch (type) {
      // 心跳檢測
      case EVENT_TYPE.PING: {
        client.ping();
        break;
      };
      // 發送訊息
      case EVENT_TYPE.SEND_MESSAGE: {
        handleSendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 200, message: 'ok' });
        handleBroadcastMessage(client.id, { type: EVENT_TYPE.MESSAGE, code: 200, message: payload.message });
        break;
      };
      // 推播訊息
      case EVENT_TYPE.PUSH_MESSAGE: {
        // TODO: payload.to array should use「id」or「name」?
        if (payload.to) {
          const failList = handleMulticastMessage(payload.to);

          if (failList.length > 0) {
            const message = `Those user not founded.\n [${failList}]`
            handleSendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 404, message });
          }
        } else {
          handleBroadcastMessage(client.id, { type: EVENT_TYPE.MESSAGE, message: `${payload.message}, \n this message from: ${client.id}` });
        }
        break;
      };
      // 加入聊天室
      case EVENT_TYPE.JOIN_ROOM: {
        let response;
        let prevRoomInfo;

        if (!payload.roomId) {
          response = { code: 400, message: 'Sorry the room id is required' };
        } else {
          // 更換聊天室，紀錄前個聊天室資訊
          if (client.roomId) {
            prevRoomInfo = { roomId: client.roomId, order: client.order };
          };
          // 更新聊天室資訊
          if (!wss.rooms[payload.roomId]) wss.rooms[payload.roomId] = [];
          wss.rooms[payload.roomId].push(client);
          client.order = wss.rooms[payload.roomId].length - 1;
          // 更新使用者資訊
          client.role = payload.role;
          client.roomId = payload.roomId;
          response = { code: 200, data: { roomId: client.roomId, role: client.role }, message: 'success' };
          // 更新使用者暱稱
          if (payload.name) {
            client.name = payload.name;
            response.data.name = payload.name;
          };
          // 刪除前聊天室資訊
          if (prevRoomInfo) {
            handleDeleteClientFromRoom(prevRoomInfo);
          };
        }
        response.type = EVENT_TYPE.RESPONSE;

        handleSendMessage(client, response);
        break;
      };
      // 接收與傳送 webRtc offer
      case EVENT_TYPE.SEND_OFFER: {
        console.log('Received offer');
        handleBroadcastMessage(client.id, { type: EVENT_TYPE.RECEIVE_OFFER, code: 200, data: { offer: payload.offer }, message: "success" });
        break;
      };
      // 接收與傳送 webRtc answer
      case EVENT_TYPE.SEND_ANSWER: {
        console.log('Received answer');
        handleBroadcastMessage(client.id, { type: EVENT_TYPE.RECEIVE_ANSWER, code: 200, data: { answer: payload.answer }, message: "success" });
        break;
      };
      // 接收與傳送 webRtc answer
      case EVENT_TYPE.SEND_CANDIDATE: {
        console.log('Received candidate');
        handleBroadcastMessage(client.id, { type: EVENT_TYPE.RECEIVE_CANDIDATE, code: 200, data: { candidate: payload.candidate }, message: "success" });
        break;
      };
      // 離開聊天室
      case EVENT_TYPE.LEAVE_ROOM: {
        handleDeleteClientFromRoom(client);
        handleSendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 200, message: 'success' });
        break;
      };
      // 回傳使用者資訊
      case EVENT_TYPE.INFO: {
        handleSendMessage(client, {
          type: EVENT_TYPE.INFO,
          code: 200,
          data: {
            id: client.id,
            name: client.name,
            role: client.role,
            roomId: client.roomId,
          }
        });
        break;
      };

      default: {
        console.log("IsBinary : %s \n", isBinary);
        console.log('Received Data: %s \n', data);
      }
    }
  }
};

function handleConnected(ws, req) {
  const now = Date.now();
  ws.id = handleUserId();
  ws.isAlive = 1;
  handleSendMessage(ws, { timestamp: now });
  handleCleanUp();

  function handleUserId() {
    const namespace = process.env.UID_NAME_SPACE;
    const string = `${req.headers.origin}-${now}-${wss.clients.size}`;

    return uuidv5(string, namespace);
  };
  // Health check
  ws.on('pong', () => {
    // console.log('---------- keepalive ----------');
    ws.isAlive = 1;
    wss.clients.forEach(client => {
      if (!client.isAlive) {
        handleDeleteClientFromRoom(client);
        client.terminate();
      }
    });
  });
};

// TODO: Received binary data logic
function handleBinaryData(data) {
  console.log("Binary data: \n", data);
  // Do something for binary data
  // fs.writeFile('./my-img.jpeg', data, 'binary', (err) => {
  //   if (!err) console.log('Binary save success');
  // })
};

// function findClient({ id, name }) {
//   let temp;
//   wss.clients.forEach(client => {
//     if (client.readyState !== WebSocket.OPEN) return;

//     if (client.id === id || client.name === name) {
//       temp = client;
//     }
//   });
//   return temp;
// };

// WARN: 是否可能找不到UID?
function handleDeleteClientFromRoom(client) {
  const room = wss.rooms[client.roomId];
  if (room) {
    room.splice(client.order, 1);
    room.forEach((client, order) => { client.order = order; });
  }
}

// 每十五分鐘檢查聊天室、使用者狀態, 可根據情況判斷是否要 clearInterval
function handleCleanUp() {
  setInterval(() => {
    Object.keys(wss.rooms).forEach(key => {
      if (wss.rooms[key].length === 0) {
        // delete wss.rooms[key];
        Reflect.deleteProperty(wss.rooms, key)
      }
    });
    wss.clients.forEach(client => {
      if (!client.isAlive) client.terminate();
    })
  }, 900000);
}

function handleBroadcastMessage(currentId, message) {
  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;

    if (client.id !== currentId) handleSendMessage(client, { type: EVENT_TYPE.MESSAGE, ...message });
  });
};

function handleMulticastMessage(userIds, message) {
  const set = new Set(userIds);
  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;

    if (set.has(client.id)) {
      set.delete(client.id);
      handleSendMessage(client, { type: EVENT_TYPE.MESSAGE, ...message });
    }
  });
  return [...set];
};

// TODO: Send binary data logic
function handleSendMessage(ws, data, isJson = true) {
  if (isJson) {
    ws.send(JSON.stringify(data));
  } else {
    ws.send(data);
  }
};

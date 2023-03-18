import WebSocket from 'ws';
import { v5 as uuidv5 } from 'uuid';
import EVENT_TYPE from './eventType.js';

const handler = {
  __wss: null,
  setWssConnect(wss) { handler.__wss = wss; },
  getWss() { return handler.__wss },
  handleSendMessage(client, payload) {
    handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 200, message: 'ok' });
    handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.MESSAGE, code: 200, message: payload.message });
  },
  handlePushMessage(client, payload) {
    // TODO: payload.to array should use「id」or「name」?
    if (payload.to) {
      const failList = handler.sendMulticastMessage(payload.to);

      if (failList.length > 0) {
        const message = `Those user not founded.\n [${failList}]`
        handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 404, message });
      }
    } else {
      handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.MESSAGE, message: `${payload.message}, \n this message from: ${client.id}` });
    }
  },

  handleJoinRoom(client, payload) {
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
      if (!handler.getWss().rooms[payload.roomId]) {
        handler.getWss().rooms[payload.roomId] = [];
      }
      handler.getWss().rooms[payload.roomId].push(client);
      client.order = handler.getWss().rooms[payload.roomId].length - 1;
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
        handler.deleteClientFromRoom(prevRoomInfo);
      };
    }
    response.type = EVENT_TYPE.RESPONSE;

    handler.sendMessage(client, response);
    handler.sendBroadcastMessage(client.id, {
      type: response.type,
      message: `${response.data.name} join to ${response.data.roomId}`,
    });
  },
  handleSendOffer(client, payload) {
    console.log('Received offer');
    handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.RECEIVE_OFFER, code: 200, data: { offer: payload.offer }, message: "success" });
  },
  handleSendAnswer(client, payload) {
    console.log('Received answer');
    handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.RECEIVE_ANSWER, code: 200, data: { answer: payload.answer }, message: "success" });
  },
  handleSendCandidate(client, payload) {
    console.log('Received candidate');
    handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.RECEIVE_CANDIDATE, code: 200, data: { candidate: payload.candidate }, message: "success" });
  },
  handleLeaveRoom(client) {
    handler.deleteClientFromRoom(client);
    handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 200, message: 'success' });
  },
  handleGetUserInfo(client) {
    handler.sendMessage(client, {
      type: EVENT_TYPE.INFO,
      code: 200,
      data: {
        id: client.id,
        name: client.name,
        role: client.role,
        roomId: client.roomId,
      }
    });
  },

  //  findClient({ id, name }) {
  //   let temp;
  //   handler.getWss().clients.forEach(client => {
  //     if (client.readyState !== WebSocket.OPEN) return;

  //     if (client.id === id || client.name === name) {
  //       temp = client;
  //     }
  //   });
  //   return temp;
  // };
  // WARN: 是否可能找不到UID?
  deleteClientFromRoom(client) {
    const room = handler.getWss().rooms[client.roomId];
    if (room) {
      room.splice(client.order, 1);
      room.forEach((client, order) => { client.order = order; });
    }
  },
  sendBroadcastMessage(currentId, message) {
    handler.getWss().clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;

      if (client.id !== currentId) {
        handler.sendMessage(client, { type: EVENT_TYPE.MESSAGE, ...message });
      }
    });
  },
  sendMulticastMessage(userIds, message) {
    const set = new Set(userIds);
    handler.getWss().clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;

      if (set.has(client.id)) {
        set.delete(client.id);
        handler.sendMessage(client, { type: EVENT_TYPE.MESSAGE, ...message });
      }
    });
    return [...set];
  },
  // TODO: Send binary data logic
  sendMessage(ws, data, isJson = true) {
    if (isJson) {
      ws.send(JSON.stringify(data));
    } else {
      ws.send(data);
    }
  },
  // 每十五分鐘檢查聊天室、使用者狀態, 可根據情況判斷是否要 clearInterval
  checkCleanUp() {
    setInterval(() => {
      Object.keys(handler.getWss().rooms).forEach(key => {
        if (handler.getWss().rooms[key].length === 0) {
          // delete handler.getWss().rooms[key];
          Reflect.deleteProperty(handler.getWss().rooms, key)
        }
      });
      handler.getWss().clients.forEach(client => {
        if (!client.isAlive) client.terminate();
      })
    }, 900000);
  },
  // TODO: Received binary data logic
  handleBinaryData(data) {
    console.log("Binary data: \n", data);
    // Do something for binary data
    // fs.writeFile('./my-img.jpeg', data, 'binary', (err) => {
    //   if (!err) console.log('Binary save success');
    // })
  },
  generateUserId(req, now) {
    const namespace = process.env.UID_NAME_SPACE;
    const string =
      `${req.headers.origin}-${now}-${handler.getWss().clients.size}`;

    return uuidv5(string, namespace);
  },
}

export default handler;
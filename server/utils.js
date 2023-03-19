import WebSocket from 'ws';
import { v5 as uuidv5 } from 'uuid';
import EVENT_TYPE from './eventType.js';

const handler = {
  __wss: null,
  __getWss() { return handler.__wss },
  // __getClients() { return handler.__wss.clients },
  // __getRooms() { return handler.__wss.rooms },
  setWssConnect(wss) { handler.__wss = wss; },
  handlePushMessage(client, payload) {
    if (!payload.to) {
      handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE_ERROR, code: 400, message: 'please given id or array of id' });
      return;
    }

    if (typeof payload.to === 'string') {
      return;
    }

    if (Array.isArray(payload.to)) {
      const failList = handler.sendMulticastMessage(payload.to);
      if (failList.length > 0) {
        const message = `Those user not founded.\n [${failList}]`
        handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE_ERROR, code: 404, message });
      }
      return;
    }

    handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE_ERROR, code: 400, message: 'badRequest' });
  },
  handleJoinRoom(client, payload) {
    if (!payload.roomId) {
      handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE_ERROR, code: 400, message: 'sorry the room id is required' });
      return;
    }
    // 使用者重新上線，仍在同一個聊天室，未變更
    if (client.roomId === payload.roomId) {
      handler.sendBroadcastMessage(client.id, {
        type: EVENT_TYPE.ROOM_JOIN,
        code: 200,
        message: `${client.name} 加入聊天室`,
      });
      return;
    }

    // 判斷聊天室是否存在，不存在則初始化
    if (!handler.__getWss().rooms[payload.roomId]) {
      handler.__getWss().rooms[payload.roomId] = [];
    }
    // 更換聊天室，刪除前個聊天室資訊
    if (client.roomId) {
      handler.deleteClientFromRoom(client);
    };
    // 使用者加入聊天室
    const len = handler.__getWss().rooms[payload.roomId].push(client);
    // 更新使用者資訊
    client.order = len - 1;
    client.role = payload.role;
    client.roomId = payload.roomId;
    client.name = payload.name || client.name; // 不一定會更新使用者暱稱

    handler.sendMessage(client, {
      type: EVENT_TYPE.RESPONSE,
      code: "S200",
      message: 'success',
      data: {
        id: client.id,
        role: client.role,
        name: client.name,
        roomId: client.roomId,
      },
    });
    handler.sendBroadcastMessage(client.id, {
      type: EVENT_TYPE.ROOM_JOIN,
      data: { id: client.id, name: client.name },
      message: `${client.name} 加入聊天室`,
    });
  },
  handleLeaveRoom(client) {
    handler.deleteClientFromRoom(client);
    handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.SYSTEM_DISCONNECT, code: 200, message: `${client.name} 已離開聊天室`, data: { id: client.id, name: client.name } });
  },
  handleSendOffer(client, payload) {
    console.log('Received offer');
    handler.sendBroadcastMessage(client.id, null, (c) => {
      if (!c.isWebRtcOpened) return;

      handler.sendMessage(c, {
        type: EVENT_TYPE.WEB_RTC_RECEIVE_OFFER,
        code: 200,
        message: "success",
        data: {
          id: client.id,
          name: client.name,
          offer: payload.offer,
        },
      })
      return 1;
    });
  },
  handleSendAnswer(client, payload) {
    console.log('Received answer');
    handler.sendBroadcastMessage(client.id, null, (c) => {
      if (!c.isWebRtcOpened) return;

      handler.sendMessage(c, {
        type: EVENT_TYPE.WEB_RTC_RECEIVE_ANSWER,
        code: 200,
        message: "success",
        data: {
          id: client.id,
          name: client.name,
          answer: payload.answer,
        },
      })
      return 1;
    });
  },
  handleSendCandidate(client, payload) {
    console.log('Received candidate');
    handler.sendBroadcastMessage(client.id, null, (c) => {
      if (!c.isWebRtcOpened) return;

      handler.sendMessage(c, {
        type: EVENT_TYPE.WEB_RTC_RECEIVE_CANDIDATE,
        code: 200,
        message: "success",
        data: { candidate: payload.candidate },
      })
      return 1;
    });
  },
  // 每十五分鐘檢查聊天室、使用者狀態, 可根據情況判斷是否要 clearInterval
  handleCheckCleanUp() {
    setInterval(() => {
      // delete empty room
      const rooms = handler.__getWss().rooms;
      Object.keys(rooms).forEach(key => {
        if (!rooms[key].length) {
          // delete rooms[key];
          Reflect.deleteProperty(rooms, key)
        }
      });
      // delete is not alive client
      handler.__getWss().clients.forEach(client => {
        if (
          client.readyState !== WebSocket.OPEN ||
          !client.isAlive
        ) client.terminate();
      })
    }, 900000);
  },
  // TODO: Received binary data logic, do something for binary data
  handleBinaryData(data) {
    console.log("Binary data: \n", data);
    // fs.writeFile('./my-img.jpeg', data, 'binary', (err) => {
    //   if (!err) console.log('Binary save success');
    // })
  },

  /********* helper *********/
  findClient({ id, name }) {
    let temp;
    handler.__getWss().clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;

      if (client.id === id || client.name === name) {
        temp = client;
      }
    });
    return temp;
  },
  findClientsInRoom(client, roomId = null) {
    const temp = [];
    const room = handler.__getWss().rooms[roomId || client.roomId];
    if (!room) return temp;
    room.forEach(clientInRoom => {
      if (clientInRoom.id === client.id) return;
      temp.push(clientInRoom.id);
    });
    return temp;
  },
  deleteClientFromRoom(client) {
    const room = handler.__getWss().rooms[client.roomId];
    if (room) {
      room.splice(client.order, 1);
      room.forEach((c, order) => { c.order = order; });
    }
  },
  sendBroadcastMessage(currentId, message, callback = null) {
    handler.__getWss().clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;

      if (client.id !== currentId) {
        const isBeProcessed = callback && callback(client);

        if (!isBeProcessed) {
          handler.sendMessage(client, {
            type: EVENT_TYPE.MESSAGE, ...message
          });
        }
      }
    });
  },
  sendMulticastMessage(userIds, message) {
    const set = new Set(userIds);
    handler.__getWss().clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;

      if (set.has(client.id)) {
        set.delete(client.id);
        handler.sendMessage(client, { type: EVENT_TYPE.MESSAGE, ...message });
      }
    });
    return [...set];
  },
  // TODO: Send binary data logic
  sendMessage(ws, data, isJson = 1) {
    if (isJson) {
      ws.send(JSON.stringify(data));
    } else {
      ws.send(data);
    }
  },
  createUniqueId(req, now) {
    const namespace = process.env.UID_NAME_SPACE;
    const string =
      `${req.headers.origin}-${now}-${handler.__getWss().clients.size}`;

    return uuidv5(string, namespace);
  },
}

export default handler;
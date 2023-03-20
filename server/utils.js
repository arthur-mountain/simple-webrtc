import WebSocket from 'ws';
import { v5 as uuidv5 } from 'uuid';
import EVENT_TYPE from './eventType.js';

const handler = {
  __wss: null,
  __getWss() { return handler.__wss },
  // __getClients() { return handler.__wss.clients },
  // __getRooms() { return handler.__wss.rooms },
  setWssConnect(wss) { handler.__wss = wss; },
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
    const id = client.id, name = client.name;
    const isDeleted = handler.deleteClientFromRoom(client);
    if (isDeleted) {
      handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.SYSTEM_DISCONNECT, code: 200, message: `${name} 已離開聊天室`, data: { id, name } });
    }
  },
  // @TODO: 也可以再多新增一個 webRtcOpened 的 client array
  handleWebRtcOpened(client) {
    const clientIds =
      handler.findClientsInRoom(client).reduce((ids, client) => {
        if (!client.isWebRtcOpened) return ids;
        ids.push(client.id);
        return ids;
      }, []);

    handler.sendMessage(client, { type: EVENT_TYPE.WEB_RTC_OPENED, code: 200, message: "success", data: { clientIds } });
  },
  handleSendOffer(client, payload) {
    console.log('Received offer');
    const target = this.findClientInRoom({ id: payload.to }, client.roomId);
    if (target) {
      handler.sendMessage(target, {
        type: EVENT_TYPE.WEB_RTC_RECEIVE_OFFER,
        code: 200,
        message: "success",
        data: {
          id: client.id,
          name: client.name,
          offer: payload.offer,
        },
      });
    }

    // payload.to 是從 webRtcOpened回傳的，故暫時先不做任何處理
    // handler.sendMessage(client, {
    //   type: EVENT_TYPE.WEB_RTC_RECEIVE_OFFER_ERROR,
    //   code: 404,
    //   message: "data not found",
    // });
  },
  handleSendAnswer(client, payload) {
    console.log('Received answer');
    const target = this.findClientInRoom({ id: payload.to }, client.roomId);
    if (target) {
      handler.sendMessage(target, {
        type: EVENT_TYPE.WEB_RTC_RECEIVE_ANSWER,
        code: 200,
        message: "success",
        data: {
          id: client.id,
          name: client.name,
          answer: payload.answer,
        },
      });
    }
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
  findClientInRoom({ id, name }, roomId = null) {
    const room = handler.__getWss().rooms[roomId];
    if (!room) return null;

    return room.find(c => c.id === id || c.name === name);
  },
  findClientsInRoom(client, roomId = null) {
    const temp = [];
    const room = handler.__getWss().rooms[roomId || client.roomId];
    if (!room) return temp;
    room.forEach(c => {
      if (c.id === client.id) return;
      temp.push(c);
    });
    return temp;
  },
  deleteClientFromRoom(client) {
    const room = handler.__getWss().rooms[client.roomId];
    if (room) {
      room.splice(client.order, 1);
      room.forEach((c, order) => { c.order = order; });
      return 1;
    }
    return 0;
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
  sendMulticastMessage(
    client,
    payload = { type: null, to: null, message: null },
  ) {
    if (!payload || !payload.type || !payload.to || !payload.message) {
      handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE_ERROR, code: 400, message: 'multicast error, payload is required' });
      return;
    }

    const ids =
      typeof payload.to === 'string' ? payload.to.split(",") : payload.to;
    if (Array.isArray(ids)) {
      const set = new Set(ids);
      handler.__getWss().clients.forEach(c => {
        if (c.readyState !== WebSocket.OPEN) return;

        if (set.has(c.id)) {
          handler.sendMessage(c, { type: payload.type, ...message });
          set.delete(c.id);
        }
      });
      return [...set]; // fails.length > 0, has failed
    }

    handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE_ERROR, code: 400, message: 'badRequest' });

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
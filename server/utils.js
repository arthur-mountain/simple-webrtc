import WebSocket from 'ws';
import { v5 as uuidv5 } from 'uuid';
import EVENT_TYPE from './eventType.js';

const handler = {
  __wss: null,
  __getWss() { return handler.__wss },
  __getClients() { return handler.__wss.clients },
  __getRooms() { return handler.__wss.rooms },
  setWssConnect(wss) { handler.__wss = wss; },
  handlePushMessage(client, payload) {
    if (!payload.to) {
      handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 422, message: 'please given array of id in the room' });
      return;
    }

    const failList = handler.sendMulticastMessage(payload.to);
    if (failList.length > 0) {
      const message = `Those user not founded.\n [${failList}]`
      handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 404, message });
    }
  },
  handleJoinRoom(client, payload) {
    let response;
    let prevRoomInfo;

    if (!payload.roomId) {
      response = { code: 404, message: 'Sorry the room id is required', subtype: EVENT_TYPE.ERROR };
    } else {
      // 更換聊天室，紀錄前個聊天室資訊
      if (client.roomId) {
        prevRoomInfo = { roomId: client.roomId, order: client.order };
      };
      // 判斷聊天室是否存在，不存在則初始化
      if (!handler.__getWss().rooms[payload.roomId]) {
        handler.__getWss().rooms[payload.roomId] = [];
      }
      // 儲存該 room 所有的使用者資訊
      const len = handler.__getWss().rooms[payload.roomId].push(client);
      client.order = len - 1;
      // 更新使用者資訊
      client.role = payload.role;
      client.roomId = payload.roomId;
      response = { code: "S200", data: { id: client.id, roomId: client.roomId, role: client.role }, message: 'success' };
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

    handler.sendMessage(client, handler.createReturnDataWithSubClass({
      type: response.type,
      code: response.code,
      message: response.message,
      subtype: response.subtype,
      data: response.data,
    }));
    handler.sendBroadcastMessage(client.id, {
      type: EVENT_TYPE.JOIN_ROOM,
      data: { id: client.id, },
      message: `${response.data.name} join to ${response.data.roomId}`,
    });
  },
  handleLeaveRoom(client) {
    handler.deleteClientFromRoom(client);
    handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 200, message: 'success' });
  },
  handleSendOffer(client, payload) {
    console.log('Received offer');
    handler.sendBroadcastMessage(client.id, handler.createReturnDataWithSubClass({
      type: EVENT_TYPE.WEB_RTC,
      subtype: EVENT_TYPE.RECEIVE_OFFER,
      data: { offer: payload.offer },
    }));
  },
  handleSendAnswer(client, payload) {
    console.log('Received answer');
    handler.sendBroadcastMessage(client.id, handler.createReturnDataWithSubClass({
      type: EVENT_TYPE.WEB_RTC,
      subtype: EVENT_TYPE.RECEIVE_ANSWER,
      data: { answer: payload.answer },
    }));
  },
  handleSendCandidate(client, payload) {
    console.log('Received candidate');
    handler.sendBroadcastMessage(client.id, handler.createReturnDataWithSubClass({
      type: EVENT_TYPE.WEB_RTC,
      subtype: EVENT_TYPE.RECEIVE_CANDIDATE,
      data: { candidate: payload.candidate },
    }));
  },
  handleGetPersonal(client) {
    handler.sendMessage(client, handler.createReturnDataWithSubClass({
      type: EVENT_TYPE.RESPONSE,
      subtype: EVENT_TYPE.PERSONAL,
      data: {
        id: client.id,
        name: client.name,
        role: client.role,
        roomId: client.roomId,
      },
    }));
  },
  // 每十五分鐘檢查聊天室、使用者狀態, 可根據情況判斷是否要 clearInterval
  handleCheckCleanUp() {
    setInterval(() => {
      Object.keys(handler.__getWss().rooms).forEach(key => {
        if (handler.__getWss().rooms[key].length === 0) {
          // delete handler.__getWss().rooms[key];
          Reflect.deleteProperty(handler.__getWss().rooms, key)
        }
      });
      handler.__getWss().clients.forEach(client => {
        if (!client.isAlive) client.terminate();
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
  findClientsOfRoom(client) {
    const temp = [];
    const room = handler.__getWss().rooms[client.roomId];
    if (!room) return temp;
    room.forEach(clientOfRoom => {
      if (clientOfRoom.id === client.id) return;
      temp.push(clientOfRoom.id);
    });
    return temp;
  },
  deleteClientFromRoom(client) {
    const room = handler.__getWss().rooms[client.roomId];
    if (room) {
      room.splice(client.order, 1);
      room.forEach((client, order) => { client.order = order; });
    }
  },
  sendBroadcastMessage(currentId, message) {
    handler.__getWss().clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;

      if (client.id !== currentId) {
        handler.sendMessage(client, { type: EVENT_TYPE.MESSAGE, ...message });
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
  sendMessage(ws, data, isJson = true) {
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
  createReturnDataWithSubClass({
    type = EVENT_TYPE.RESPONSE,
    code = 200,
    message = "success",
    subtype,
    data,
  }) {
    const response = {
      type,
      code,
      message,
      data: { subtype, data },
    };

    if (!data) delete response.data.data;

    return response;
  },

}

export default handler;
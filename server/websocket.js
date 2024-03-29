// import fs from 'fs';
import express from 'express';
import { WebSocketServer, } from 'ws';
import EVENT_TYPE from './eventType.js';
import handler from "./utils.js";

const wss = new WebSocketServer({
  server: express().listen(8001, () => {
    console.log(`Server starting with port:8001...`);
  }),
  perMessageDeflate: {
    concurrencyLimit: 12, // Limits zlib concurrency for perf.
  }
});
// Room info
wss.rooms = {};
handler.setWssConnect(wss);

// Connect
wss.on('connection', (ws, req) => {
  handleConnected(ws, req);
  // Open
  ws.on('open', () => { console.log('WebSocket opened'); });
  // Close
  ws.on('close', handleDisconnected);
  // Message
  ws.on('message', handleMessage(ws));
});

function handleDisconnected(client) {
  console.log('WebSocket disconnected');
  handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.DISCONNECT, code: 200, message: `${client.id} 已離開聊天室`, data: { id: client.id } });
}

function handleMessage(client) {
  return function (data, isBinary) {
    if (isBinary) return handler.handleBinaryData(data);

    const { type, payload } = JSON.parse(data);
    switch (type) {
      // 心跳檢測
      case EVENT_TYPE.PING: {
        client.ping();
        break;
      };
      // 發送訊息(廣播到全部 user)
      case EVENT_TYPE.SEND_MESSAGE: {
        handler.sendBroadcastMessage(client.id, { type: EVENT_TYPE.MESSAGE, code: 200, message: payload.message });
        handler.sendMessage(client, { type: EVENT_TYPE.RESPONSE, code: 200, message: 'ok' });
        break;
      };
      // 推播訊息(針對特定 user 進行訊息推播)
      case EVENT_TYPE.PUSH_MESSAGE: {
        handler.sendMulticastMessage(client, payload);
        break;
      };
      // 接收與傳送 webRtc offer
      case EVENT_TYPE.WEB_RTC_SEND_OFFER: {
        handler.handleSendOffer(client, payload);
        break;
      };
      // 接收與傳送 webRtc answer
      case EVENT_TYPE.WEB_RTC_SEND_ANSWER: {
        handler.handleSendAnswer(client, payload);
        break;
      };
      // 接收與傳送 webRtc candidate
      case EVENT_TYPE.WEB_RTC_SEND_CANDIDATE: {
        handler.handleSendCandidate(client, payload);
        break;
      };
      // 請求開啟 webRtc
      case EVENT_TYPE.WEB_RTC_OPENED: {
        client.isWebRtcOpened = 1;
        handler.handleWebRtcOpened(client);
        break;
      };
      // 加入聊天室
      case EVENT_TYPE.ROOM_JOIN: {
        handler.handleJoinRoom(client, payload);
        break;
      };
      // 離開聊天室
      case EVENT_TYPE.ROOM_LEAVE: {
        handler.handleLeaveRoom(client);
        break;
      };
      // 回傳使用者資訊
      case EVENT_TYPE.RESPONSE_PERSONAL: {
        handler.sendMessage(client, {
          type: EVENT_TYPE.RESPONSE_PERSONAL,
          data: {
            id: client.id,
            name: client.name,
            role: client.role,
            roomId: client.roomId,
          },
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
  ws.id = handler.createUniqueId(req, now);
  ws.isAlive = 1;
  handler.sendMessage(ws, { timestamp: now });
  handler.handleCheckCleanUp();

  // Health check
  ws.on('pong', () => {
    // console.log('---------- keepalive ----------');
    ws.isAlive = 1;
    wss.clients.forEach(client => {
      if (!client.isAlive) {
        handler.deleteClientFromRoom(client);
        client.terminate();
      }
    });
  });
};
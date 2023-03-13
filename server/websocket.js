// import fs from 'fs';
import express from 'express';
import { v5 as uuidv5 } from 'uuid';
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
  ws.on('close', () => { console.log('WebSocket disconnected'); });
  // Message
  ws.on('message', handleMessage(ws));
});

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
      // 發送訊息
      case EVENT_TYPE.SEND_MESSAGE: {
        handler.handleSendMessage(client, payload);
        break;
      };
      // 推播訊息
      case EVENT_TYPE.PUSH_MESSAGE: {
        handler.handlePushMessage(client, payload);
        break;
      };
      // 加入聊天室
      case EVENT_TYPE.JOIN_ROOM: {
        handler.handleJoinRoom(client, payload);
        break;
      };
      // 接收與傳送 webRtc offer
      case EVENT_TYPE.SEND_OFFER: {
        handler.handleSendOffer(client, payload);
        break;
      };
      // 接收與傳送 webRtc answer
      case EVENT_TYPE.SEND_ANSWER: {
        handler.handleSendAnswer(client, payload);
        break;
      };
      // 接收與傳送 webRtc answer
      case EVENT_TYPE.SEND_CANDIDATE: {
        handler.handleSendCandidate(client, payload);
        break;
      };
      // 離開聊天室
      case EVENT_TYPE.LEAVE_ROOM: {
        handler.handleLeaveRoom(client);
        break;
      };
      // 回傳使用者資訊
      case EVENT_TYPE.INFO: {
        handler.handleGetUserInfo(client);
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
  ws.id = handler.generateUserId(req, now);
  ws.isAlive = 1;
  handler.sendMessage(ws, { timestamp: now });
  handler.checkCleanUp();

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
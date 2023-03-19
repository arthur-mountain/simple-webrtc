'use strict';

export default (() => {
  if (!'WebSocket' in window) return console.warn('Not Support websocket...');

  let ws;
  let healthCheckId;
  let events = [
    { type: 'open', listener: defaultOpenListener },
    { type: 'message', listener: defaultMessageListener },
    { type: 'close', listener: defaultCloseListener },
    { type: 'error', listener: defaultErrorListener },
  ];
  let SEND_TYPE;

  // @NOTICE: websocket 連線 init 時間點，進入房間才連線 or 頁面一載入就連線
  function init(listenerMap, TYPES) {
    SEND_TYPE = TYPES;
    ws = new WebSocket('ws://localhost:8001');
    events = events.map(event => {
      const cb = listenerMap[event.type];
      return cb ? { ...event, listener: (evt) => event.listener(evt, cb) } : event;
    });

    window.addEventListener('beforeunload', leaveRoom);
  }

  // Default Listeners
  function defaultOpenListener(evt, cb) {
    console.log("Websocket opened");
    // Health Check
    let lastTime = Date.now();
    const options = { timeout: 60000 };
    function healthCheck(idle) {
      // didTimeout 只有在超過 options.timeout 的時間時才會為 true
      // 因此另外判斷 當前時間和上一次 PING 的時間是否超過 options.timeout
      if (idle.didTimeout || Date.now() - lastTime > options.timeout) {
        lastTime = Date.now();
        sendMessage({ type: SEND_TYPE.PING });
      }
      healthCheckId = requestIdleCallback(healthCheck, options);
    }
    requestIdleCallback(healthCheck, options);
    cb && cb(evt);
  }
  function defaultMessageListener(evt, cb) {
    cb && cb(evt);
  }
  // TODO: should reconnect?
  function defaultCloseListener(evt, cb) {
    handleReset();
    cb && cb(evt);
    if (evt.wasClean) {
      console.log('Websocket disconnected');
    } else {
      console.log("Websocket connect dead");
    }
  }
  function defaultErrorListener(evt, cb) {
    handleReset();
    cb && cb(evt);
    console.log("Websocket connect error");
  }

  // Methods
  function handleReset() {
    if (healthCheckId) cancelIdleCallback(healthCheckId);
  }

  function sendMessage(message, isJson = 1) {
    return new Promise((resolve, reject) => {
      try {
        if (isJson) {
          ws.send(JSON.stringify(message));
        } else {
          ws.send(message);
        };
        resolve();
      } catch (error) {
        console.error('websocket send message error:', error.message);
        reject(error.message);
      }
    })
  };

  function joinRoom(userInfo) {
    events.forEach(({ type, listener }) => {
      ws.addEventListener(type, listener);
    });
    sendMessage({ type: SEND_TYPE.ROOM_JOIN, payload: userInfo });
  };

  function leaveRoom() {
    events.forEach(({ type, listener }) => {
      ws.removeEventListener(type, listener);
    });
    sendMessage({ type: SEND_TYPE.ROOM_LEAVE });
  };

  return {
    init,
    joinRoom,
    leaveRoom,
    sendMessage,
  };
})()
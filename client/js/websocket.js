'use strict';

export default (() => {
  if (!'WebSocket' in window) return console.warn('Not Support websocket...');

  let ws;
  let healthCheckId;
  let SEND_TYPE = { JSON: 'JSON', BINARY: 'BINARY' };

  function init(listenerMap, TYPES) {
    SEND_TYPE = { ...SEND_TYPE, ...TYPES };
    ws = new WebSocket('ws://localhost:8001');
    const events = [
      { type: 'open', listener: openListener },
      { type: 'message', listener: messageListener },
      { type: 'close', listener: closeListener },
      { type: 'error', listener: errorListener },
    ].map(event => {
      const listener = listenerMap[event.type];
      return listener ? { ...event, listener } : event
    });

    events.forEach(({ type, listener }) => {
      ws.addEventListener(type, listener);
    });

    window.addEventListener('beforeunload', leaveRoom)
  }

  // Default Listeners
  function openListener(_evt) {
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
    // Websocket init
    const payload = JSON.parse(sessionStorage.getItem('info'));
    if (payload) {
      sendMessage({ type: SEND_TYPE.JOIN_ROOM, payload });
    }
  }
  function messageListener(evt) {
    console.log("Message listener received: \n", JSON.parse(evt.data));
  }
  // TODO: should reconnect?
  function closeListener(evt) {
    handleReset();
    if (evt.wasClean) {
      console.log('Websocket disconnected');
    } else {
      console.log("Websocket connect dead");
    }
  }
  function errorListener(_evt) {
    handleReset();
    console.log("Websocket connect error");
  }

  // Methods
  function handleReset() {
    if (healthCheckId) cancelIdleCallback(healthCheckId);
  }

  function sendMessage(message, type = SEND_TYPE.JSON) {
    return new Promise((resolve, reject) => {
      try {
        if (type === SEND_TYPE.JSON) {
          ws.send(JSON.stringify(message));
        } else {
          ws.send(message);
        };
        resolve();
      } catch (error) {
        reject(error.message);
        console.warn('send error:', error.message);
      }
    })
  };
  function leaveRoom() {
    sendMessage({ type: SEND_TYPE.LEAVE_ROOM });
  };

  return {
    init,
    leaveRoom,
    sendMessage,
    SEND_TYPE,
  };
})()
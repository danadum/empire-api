const WebSocket = require('ws');
const { BaseSocket } = require('./baseSocket');

class BaseWsSocket extends BaseSocket {
    constructor(url, serverHeader, onSend = null, onOpen = null, onMessage = null, onError = null, onClose = null) {
        super(serverHeader, onSend, onOpen, onMessage, onError, onClose);
        this.url = url;

        this.ws = new WebSocket(url);

        this.ws.on('open', () => this._onOpen());
        this.ws.on('message', (message) => this._handleMessage(message));
        this.ws.on('error', (error) => this._onError(error));
        this.ws.on('close', (code, reason) => this._onClose(code, reason));
    }

    _handleMessage(message) {
        message = message.toString();
        this._onMessage(message);
    }

    _send(data) {
        this.ws.send(data);
    }

    close() {
        this.ws.close();
    }
}

module.exports = { BaseWsSocket };


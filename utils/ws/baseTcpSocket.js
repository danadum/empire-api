const net = require('net');
const { BaseSocket } = require('./baseSocket');

class BaseTcpSocket extends BaseSocket {
    constructor(url, serverHeader, onSend = null, onOpen = null, onMessage = null, onError = null, onClose = null) {
        super(serverHeader, onSend, onOpen, onMessage, onError, onClose);
        this.url = url;
        [this.host, this.port] = url.split('://')[1].split(':');
        this.buffer = '';

        this.socket = new net.Socket();
        this.socket.connect(this.port, this.host, () => this._onOpen());
        this.socket.on('data', (data) => this._onData(data));
        this.socket.on('error', (error) => this._onError(error));
        this.socket.on('close', (hadError) => this._onClose(hadError ? 1006 : 1000, hadError ? 'Connection error' : 'Connection closed'));
    }

    _onData(data) {
        this.buffer += data.toString();
        
        let nullIndex;
        while ((nullIndex = this.buffer.indexOf('\x00')) !== -1) {
            const message = this.buffer.substring(0, nullIndex);
            this.buffer = this.buffer.substring(nullIndex + 1);
            this._onMessage(message);
        }
    }

    _send(data) {
        this.socket.write(data + '\x00');
    }

    close() {
        this.socket.destroy();
    }
}

module.exports = { BaseTcpSocket };


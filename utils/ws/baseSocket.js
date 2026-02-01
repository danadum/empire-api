const { Event } = require('../event');
const { compareNestedHeaders } = require('../nestedHeaders');

class BaseSocket {
    constructor(serverHeader, onSend = null, onOpen = null, onMessage = null, onError = null, onClose = null) {
        this.serverHeader = serverHeader;
        this.onSend = onSend;
        this.onOpen = onOpen;
        this.onMessage = onMessage;
        this.onError = onError;
        this.onClose = onClose;
        this.opened = new Event();
        this.closed = new Event();
        this.messages = [];
    }

    _onOpen() {
        this.opened.set();
        if (this.onOpen) this.onOpen();
    }

    async _onMessage(message) {
        const response = await this.parseResponse(message);
        this._processResponse(response);
        if (this.onMessage) this.onMessage(message);
    }

    _onError(error) {
        if (this.onError) this.onError(error);
    }

    _onClose(code, reason) {
        this.opened.clear();
        this.closed.set();
        if (this.onClose) this.onClose(code, reason);
    }

    _send(data) {
        throw new Error('_send() must be implemented by subclass');
    }

    close() {
        throw new Error('close() must be implemented by subclass');
    }

    send(data) {
        if (this.onSend) this.onSend(data);
        console.log(`Sending data: ${data}`);
        this._send(data);
    }

    _sendCommandMessage(data) {
        this.send(`%${data.join('%')}%`);
    }

    sendRawCommand(command, data) {
        this._sendCommandMessage(['xt', this.serverHeader, command, '1', ...data]);
    }

    sendJsonCommand(command, data) {
        this._sendCommandMessage(['xt', this.serverHeader, command, '1', JSON.stringify(data)]);
    }

    sendXmlMessage(t, action, r, data) {
        this.send(`<msg t='${t}'><body action='${action}' r='${r}'>${data}</body></msg>`);
    }

    async _waitForResponse(type, conditions, timeout = 5000) {
        const event = new Event();
        const message = { type, conditions, response: null, event };
        this.messages.push(message);
        const result = await event.wait(timeout);
        this.messages = this.messages.filter(msg => msg !== message);
        if (!result) throw new Error('Timeout waiting for response');
        return message.response;
    }

    waitForJsonResponse(command, data = false, timeout = 5000) {
        return this._waitForResponse('json', { command, data }, timeout);
    }

    waitForXmlResponse(t, action, r, timeout = 5000) {
        return this._waitForResponse('xml', { t, action, r }, timeout);
    }

    raiseForStatus(response, expectedStatus = 0) {
        if (response.type === 'json' && response.payload.status !== expectedStatus) {
            throw new Error(`Unexpected status: ${response.payload.status}`);
        }
    }

    async parseResponse(response) {
        if (response.startsWith('<')) {
            const parsed = /<msg t='(.*?)'><body action='(.*?)' r='(.*?)'>(.*?)<\/body><\/msg>/.exec(response);
            return {
                type: 'xml',
                payload: {
                    t: parsed[1],
                    action: parsed[2],
                    r: parsed[3],
                    data: parsed[4]
                }
            };
        } else {
            const parsed = response.split('%').filter(Boolean);
            const payload = {
                command: parsed[1],
                status: +parsed[3],
                data: parsed.length > 4 ? parsed.slice(4).join('%') : null
            };
            if (payload.data && payload.data.startsWith('{')) {
                payload.data = JSON.parse(payload.data);
            }
            return { type: 'json', payload };
        }
    }

    _processResponse(response) {
        console.log(`Processing response: ${JSON.stringify(response)}`);
        for (const message of this.messages) {
            if (
                (response.type === 'json' && message.type === 'json' &&
                    message.conditions.command === response.payload.command &&
                    (message.conditions.data === false ||
                        (message.conditions.data === true && response.payload.data !== null) ||
                        message.conditions.data === response.payload.data ||
                        (typeof response.payload.data === 'object' &&
                            typeof message.conditions.data === 'object' &&
                            compareNestedHeaders(message.conditions.data, response.payload.data)))) ||
                (response.type === 'xml' && message.type === 'xml' &&
                    message.conditions.t === response.payload.t &&
                    message.conditions.action === response.payload.action &&
                    message.conditions.r === response.payload.r)
            ) {
                message.response = response;
                message.event.set();
                break;
            }
        }
    }
}

module.exports = { BaseSocket };
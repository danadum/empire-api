const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { E4kSocket } = require('../utils/ws/e4kSocket');
const { isDown } = require('../utils/ws/sockets');

// Fake E4K server: the handshake empire-api performs, then `loginReply` to core_lga.
function fakeE4kServer(loginReply) {
    const server = net.createServer((client) => {
        let buffer = '';
        client.on('data', (data) => {
            buffer += data.toString();
            let index;
            while ((index = buffer.indexOf('\x00')) !== -1) {
                const message = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                const reply = message.includes("action='verChk'") ? "<msg t='sys'><body action='apiOK' r='0'></body></msg>"
                    : message.includes("action='login'") ? '%xt%nfo%1%0%{"XML_E4K":"789.RC.07"}%'
                    : message.includes("action='autoJoin'") ? "<msg t='sys'><body action='joinOK' r='1'><pid id='0'/></body></msg>"
                    : message.includes("action='roundTrip'") ? "<msg t='sys'><body action='roundTripRes' r='1'></body></msg>"
                    : message.includes('%core_lga%') ? loginReply
                    : null;
                if (reply) client.write(reply + '\x00');
            }
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function connectTo(loginReply) {
    const server = await fakeE4kServer(loginReply);
    const socket = new E4kSocket(`tcp://127.0.0.1:${server.address().port}`, 'EmpirefourkingdomsExGG', 'user', 'secret');
    await socket.connect();
    server.close();
    return socket;
}

test('a banned account marks the zone banned, not down', async () => {
    const socket = await connectTo('%xt%core_lga%1%10012%{"D":{"RS":349934521,"GDPR":0}}%');
    assert.equal(socket.socket, null);
    assert.equal(socket.banned, true);
    assert.equal(isDown(socket), false);
});

test('any other login failure leaves the zone down, to be retried', async () => {
    const socket = await connectTo('%xt%core_lga%1%10011%');
    assert.equal(socket.socket, null);
    assert.equal(socket.banned, false);
    assert.equal(isDown(socket), true);
});

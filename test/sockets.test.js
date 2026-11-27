const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { WebSocketServer } = require('ws');
const { E4kSocket } = require('../utils/ws/e4kSocket');
const { GgeSocket } = require('../utils/ws/ggeSocket');
const { isDown } = require('../utils/ws/sockets');
const { accountFor, MAX_GENERATION } = require('../utils/accounts');

// The sys handshake both games share, then `onCommand(command, data)` answers %xt% commands.
function handshake(message, onCommand) {
    if (message.includes("action='verChk'")) return "<msg t='sys'><body action='apiOK' r='0'></body></msg>";
    if (message.includes("action='login'")) return '%xt%nfo%1%0%{"XML_E4K":"789.RC.07"}%';
    if (message.includes("action='autoJoin'")) return "<msg t='sys'><body action='joinOK' r='1'><pid id='0'/></body></msg>";
    if (message.includes("action='roundTrip'")) return "<msg t='sys'><body action='roundTripRes' r='1'></body></msg>";
    const [, , , command, , json] = message.split('%');
    return onCommand(command, json ? JSON.parse(json) : {});
}

// Fake E4K server keeping a registry of accounts: name -> { password, banned }.
function fakeE4kServer(accounts, banEveryone = false) {
    const server = net.createServer((client) => {
        let buffer = '';
        client.on('data', (data) => {
            buffer += data.toString();
            let index;
            while ((index = buffer.indexOf('\x00')) !== -1) {
                const reply = handshake(buffer.slice(0, index), (command, data) => {
                    if (command === 'core_lga') {
                        const account = accounts.get(data.NM);
                        if (banEveryone || account?.banned) return '%xt%core_lga%1%10012%{"D":{"RS":349934521,"GDPR":0}}%';
                        if (!account) return '%xt%core_lga%1%10010%';
                        return account.password === data.PW ? '%xt%core_lga%1%10005%{}%' : '%xt%core_lga%1%10011%';
                    }
                    if (command === 'core_reg') {
                        accounts.set(data.PN, { password: data.PW, mail: data.MAIL, banned: false });
                        return '%xt%core_reg%1%10005%{}%';
                    }
                    return null;
                });
                buffer = buffer.slice(index + 1);
                if (reply) client.write(reply + '\x00');
            }
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Login and session upkeep are what is tested here, not the ping and gpi loops that follow.
function quiet(socket) {
    socket.ping = () => {};
    socket.checkConnection = async () => {};
    return socket;
}

async function e4k(server, zone = 'EmpirefourkingdomsExGG') {
    const socket = quiet(new E4kSocket(`tcp://127.0.0.1:${server.address().port}`, zone, 'user', 'secret'));
    await socket.connect();
    return socket;
}

test('a banned account moves the zone to a new account, registered once and reused after a restart', async () => {
    const accounts = new Map([['user', { password: 'secret', banned: true }]]);
    const server = await fakeE4kServer(accounts);

    const first = await e4k(server);
    assert.equal(first.connected.isSet, true);
    assert.equal(first.generation, 1);
    const [name, created] = [...accounts].find(([n]) => n !== 'user');
    assert.match(name, /^[a-z][a-z0-9]{11}$/);
    assert.notEqual(created.password, 'secret');
    assert.equal(created.mail, `${name}@mail.com`);
    first.disconnect(false);

    const afterRestart = await e4k(server);
    assert.equal(afterRestart.connected.isSet, true);
    assert.equal(afterRestart.generation, 1);
    assert.equal(accounts.size, 2, 'no second registration');
    afterRestart.disconnect(false);
    server.close();
});

test('accounts are random-looking, stable, and different for each zone and generation', () => {
    assert.deepEqual(accountFor('Z', 0, 'user', 'secret'), { username: 'user', password: 'secret' });
    assert.deepEqual(accountFor('Z', 1, 'user', 'secret'), accountFor('Z', 1, 'user', 'secret'));
    assert.notEqual(accountFor('Z', 1, 'user', 'secret').username, accountFor('Y', 1, 'user', 'secret').username);
    assert.notEqual(accountFor('Z', 1, 'user', 'secret').username, accountFor('Z', 2, 'user', 'secret').username);
    assert.notEqual(accountFor('Z', 1, 'user', 'secret').password, accountFor('Z', 1, 'user', 'other').password);
    assert.match(accountFor('Z', 1, 'user', 'secret').password, /^[a-zA-Z0-9]{16}$/);
});

test('when every account generation is banned the zone is marked banned, not down', async () => {
    const server = await fakeE4kServer(new Map(), true);
    const socket = await e4k(server);
    assert.equal(socket.generation, MAX_GENERATION);
    assert.equal(socket.socket, null);
    assert.equal(socket.banned, true);
    assert.equal(isDown(socket), false);
    server.close();
});

test('a wrong password leaves the zone down, to be retried, with no new account', async () => {
    const accounts = new Map([['user', { password: 'changed', banned: false }]]);
    const server = await fakeE4kServer(accounts);
    const socket = await e4k(server);
    assert.equal(socket.socket, null);
    assert.equal(socket.banned, false);
    assert.equal(socket.generation, 0);
    assert.equal(isDown(socket), true);
    assert.equal(accounts.size, 1);
    server.close();
});

test('GGE: a banned account moves to a new account registered through the register endpoint', async (t) => {
    const accounts = new Map([['user', { password: 'secret', banned: true }]]);
    const game = new WebSocketServer({ port: 0 });
    game.on('connection', (ws) => ws.on('message', (raw) => {
        const reply = handshake(raw.toString(), (command, data) => {
            if (command !== 'lli') return null;
            const account = accounts.get(data.NOM);
            if (account?.banned) return '%xt%lli%1%27%{"RS":349934521,"GDPR":0}%';
            if (!account) return '%xt%lli%1%21%';
            return account.password === data.PW ? '%xt%lli%1%0%{}%' : '%xt%lli%1%10011%';
        });
        if (reply) ws.send(reply);
    }));
    t.mock.method(global, 'fetch', async (url) => {
        const query = new URL(url).searchParams;
        accounts.set(query.get('PN'), { password: query.get('PW'), instance: query.get('instance'), banned: false });
        return { json: async () => ({ res: true, err: [] }) };
    });

    const socket = quiet(new GgeSocket(`ws://127.0.0.1:${game.address().port}`, 'EmpireEx_3', 'user', 'secret', 1));
    await socket.connect();
    assert.equal(socket.connected.isSet, true);
    assert.equal(socket.generation, 1);
    const [name, created] = [...accounts].find(([n]) => n !== 'user');
    assert.equal(name, accountFor('EmpireEx_3', 1, 'user', 'secret').username);
    assert.equal(created.instance, '3');
    socket.disconnect(false);
    game.close();
});

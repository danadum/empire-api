const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { GgeSocket } = require('../utils/ws/ggeSocket');
const { accountFor } = require('../utils/accounts');
const { handshake, quiet, LONG } = require('./fakeGame');

test('GGE: a long ban moves to a new account, registered over HTTP on the zone\'s real instance', async (t) => {
    const accounts = new Map([['user', { password: 'secret', banSeconds: LONG }]]);
    const game = new WebSocketServer({ port: 0 });
    t.after(() => game.close());
    let logins = 0;
    game.on('connection', (ws) => ws.on('message', (raw) => {
        const reply = handshake(raw.toString(), (command, data) => {
            if (command !== 'lli') return null;
            logins++;
            const account = accounts.get(data.NOM);
            if (account?.banSeconds) return `%xt%lli%1%27%{"RS":${account.banSeconds},"GDPR":0}%`;
            if (!account) return '%xt%lli%1%21%';
            return account.password === data.PW ? '%xt%lli%1%0%{}%' : '%xt%lli%1%10011%';
        });
        if (reply) ws.send(reply);
    }));
    const registered = [];
    t.mock.method(global, 'fetch', async (url) => {
        const query = new URL(url).searchParams;
        registered.push(query.get('instance'));
        accounts.set(query.get('PN'), { password: query.get('PW') });
        return { json: async () => ({ res: true, err: [] }) };
    });

    const socket = quiet(new GgeSocket(`ws://127.0.0.1:${game.address().port}`, 'EmpireExSP_2', 'user', 'secret', 34, '2'));
    t.after(() => socket.disconnect(false));
    await socket.connect();
    assert.equal(socket.connected.isSet, true);
    assert.equal(socket.generation, 1);
    assert.deepEqual(registered, ['2']);
    assert.ok(accounts.has(accountFor('EmpireExSP_2', 1, 'user', 'secret').username));
    assert.equal(logins, 3, 'banned login, "not found", login after registration');
});

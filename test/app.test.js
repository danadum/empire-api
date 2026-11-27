const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { BaseWsSocket } = require('../utils/ws/baseWsSocket');

// Fake game server: answers hgh like GGE does. Errors carry only the command and the status.
// SV "<status>:<delay ms>" answers that status with no data, SV "<delay ms>" answers rows; dropNext requests get no reply.
let game, api, base;
let dropNext = 0;

before(async () => {
    game = new WebSocketServer({ port: 0 });
    game.on('connection', (ws) => {
        ws.on('message', (raw) => {
            const [, , , command, , json] = raw.toString().split('%');
            const data = JSON.parse(json);
            if (dropNext > 0) {
                dropNext--;
                return;
            }
            const [status, delay] = String(data.SV).includes(':') ? data.SV.split(':').map(Number) : [0, Number(data.SV)];
            const reply = status === 0
                ? `%xt%${command}%1%0%${JSON.stringify({ LT: data.LT, LID: data.LID, SV: data.SV, L: [[1, 100, { N: 'A' }]], LR: 1 })}%`
                : `%xt%${command}%1%${status}%`;
            setTimeout(() => ws.send(reply), delay);
        });
    });
    const socket = new BaseWsSocket(`ws://127.0.0.1:${game.address().port}`, 'EmpireEx_3');
    await socket.opened.wait(5000);
    const sockets = { EmpireEx_3: { connected: { isSet: true }, socket } };
    api = require('../app')(sockets).listen(0);
    await new Promise((resolve) => api.once('listening', resolve));
    base = `http://127.0.0.1:${api.address().port}/EmpireEx_3/hgh/`;
});

after(() => {
    api.close();
    game.close();
    for (const client of game.clients) client.terminate();
});

const hgh = async (lt, sv) => {
    const response = await fetch(base + encodeURIComponent(`"LT":${lt},"LID":1,"SV":"${sv}"`));
    return { http: response.status, body: await response.json() };
};

test('a game error is returned at once with its status', async () => {
    const started = Date.now();
    const { http, body } = await hgh(44, '2:10');
    assert.equal(http, 200);
    assert.equal(body.return_code, 2);
    assert.equal(body.content, null);
    assert.ok(Date.now() - started < 500, 'answered before the 1 s timeout');
});

test('player not found keeps its own status', async () => {
    const { body } = await hgh(6, '21:10');
    assert.equal(body.return_code, 21);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('an error answered after a later success still goes to its own request', async () => {
    const [error, success] = await Promise.all([hgh(44, '2:150'), hgh(6, '20')]);
    assert.equal(error.body.return_code, 2);
    assert.equal(success.body.return_code, 0);
    assert.equal(success.body.content.L.length, 1);
});

test('a fast error never takes the reply of an earlier, slower success', async () => {
    const success = hgh(6, '300');
    await sleep(20);
    const error = hgh(44, '2:10');
    assert.equal((await success).body.return_code, 0);
    assert.equal((await success).body.content.L.length, 1);
    assert.equal((await error).body.return_code, 2);
});

test('a request the game never answers does not make identical requests fail', async () => {
    dropNext = 1;
    assert.equal((await hgh(6, '20')).http, 400);
    const results = [];
    for (let i = 0; i < 3; i++) {
        await sleep(300);
        results.push((await hgh(6, '20')).body.return_code);
    }
    assert.deepEqual(results, [0, 0, 0]);
});

test('an error queued behind a request that is never answered still comes back', async () => {
    dropNext = 1;
    const lost = hgh(44, '2:10');
    await sleep(50);
    const error = await hgh(44, '2:10');
    assert.equal(error.body.return_code, 2);
    assert.equal((await lost).http, 400);
});

test('a reply arriving after its timeout is dropped and does not reach the next request', async () => {
    assert.equal((await hgh(44, '2:1300')).http, 400);
    await sleep(500);
    assert.equal((await hgh(6, '21:10')).body.return_code, 21);
});

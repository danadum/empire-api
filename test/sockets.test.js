const { test } = require('node:test');
const assert = require('node:assert/strict');
const { E4kSocket } = require('../utils/ws/e4kSocket');
const { isDown } = require('../utils/ws/sockets');
const { accountFor, limits, DEVICE_ID } = require('../utils/accounts');
const { fakeE4kServer, quiet, sleep, LONG } = require('./fakeGame');

// This file makes 2 registration attempts, the per-process daily limit, in two zones.
limits.startupDelayMs = 0;
limits.registrationGapMs = 0;
limits.probePauseMs = 20;

const e4k = async (t, fake, zone = 'EmpirefourkingdomsExGG') => {
    const socket = quiet(new E4kSocket(fake.url, zone, 'user', 'secret'));
    t.after(() => socket.disconnect(false));
    await socket.connect();
    return socket;
};

test('a long ban moves the zone to a new account, registered once and reused after a restart', async (t) => {
    const accounts = new Map([['user', { password: 'secret', banSeconds: LONG }]]);
    const fake = await fakeE4kServer(accounts);
    t.after(() => fake.server.close());

    const first = await e4k(t, fake);
    assert.equal(first.connected.isSet, true);
    assert.equal(first.generation, 1);
    const [name, created] = [...accounts].find(([n]) => n !== 'user');
    assert.match(name, /^[a-z][a-z0-9]{11}$/);
    assert.notEqual(created.password, 'secret');
    assert.equal(created.mail, `${name}@mail.com`);

    const afterRestart = await e4k(t, fake);
    assert.equal(afterRestart.connected.isSet, true);
    assert.equal(afterRestart.generation, 1);
    assert.equal(fake.stats.registrations, 1, 'no second registration');
});

test('accounts are random-looking, stable, and different for each zone and generation', () => {
    assert.deepEqual(accountFor('Z', 0, 'user', 'secret'), { username: 'user', password: 'secret', aid: DEVICE_ID });
    assert.deepEqual(accountFor('Z', 1, 'user', 'secret'), accountFor('Z', 1, 'user', 'secret'));
    assert.notEqual(accountFor('Z', 1, 'user', 'secret').username, accountFor('Y', 1, 'user', 'secret').username);
    assert.notEqual(accountFor('Z', 1, 'user', 'secret').username, accountFor('Z', 2, 'user', 'secret').username);
    assert.notEqual(accountFor('Z', 1, 'user', 'secret').password, accountFor('Z', 1, 'user', 'other').password);
    assert.match(accountFor('Z', 1, 'user', 'secret').password, /^[a-zA-Z0-9]{16}$/);
});

test('each derived account has its own 19-digit device id, never the configured one', () => {
    const aids = [1, 2, 3].map((generation) => accountFor('Z', generation, 'user', 'secret').aid);
    for (const aid of aids) assert.match(aid, /^[1-9][0-9]{18}$/);
    assert.equal(new Set([DEVICE_ID, ...aids, accountFor('Y', 1, 'user', 'secret').aid]).size, 5);
    assert.equal(accountFor('Z', 1, 'user', 'secret').aid, accountFor('Z', 1, 'user', 'secret').aid);
});

test('a short ban is waited out: the zone is parked, no new account', async (t) => {
    const accounts = new Map([['user', { password: 'secret', banSeconds: 12 * 3600 }]]);
    const fake = await fakeE4kServer(accounts);
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake);
    assert.equal(socket.parked, true);
    assert.equal(socket.generation, 0);
    assert.equal(isDown(socket), false);
    assert.equal(fake.stats.registrations, 0);
});

test('when every account generation is banned the search stops and the zone is parked, not down', { timeout: 10000 }, async (t) => {
    const span = limits.searchSpan;
    limits.searchSpan = 8;
    t.after(() => { limits.searchSpan = span; });
    const fake = await fakeE4kServer(new Map(), { banEveryone: LONG });
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake);
    assert.equal(socket.generation, 0);
    assert.equal(socket.socket, null);
    assert.equal(socket.parked, true);
    assert.equal(isDown(socket), false);
    assert.equal(fake.stats.registrations, 0);
    assert.equal(fake.stats.logins, 5, 'generations 0, 1, 2, 4, 8');
});

test('a wrong password leaves the zone down, to be retried, with no new account', async (t) => {
    const fake = await fakeE4kServer(new Map([['user', { password: 'changed' }]]));
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake);
    assert.equal(socket.socket, null);
    assert.equal(socket.parked, false);
    assert.equal(isDown(socket), true);
    assert.equal(fake.stats.registrations, 0);
});

test('a refused registration parks the zone instead of retrying it every 10 minutes', async (t) => {
    const fake = await fakeE4kServer(new Map(), { refuseRegistration: true });
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, 'EmpirefourkingdomsExGG_2');
    assert.equal(socket.parked, true);
    assert.equal(isDown(socket), false);
    assert.equal(fake.stats.registrations, 1);
});

test('restart() keeps the new session: the old socket closing later does not touch it', { timeout: 30000 }, async (t) => {
    const fake = await fakeE4kServer(new Map([['user', { password: 'secret' }]]));
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake);
    const old = socket.socket;
    await socket.restart();
    const session = socket.socket;
    // A WebSocket's close event comes after the closing handshake, so it can land once the new session is up.
    old._onError(new Error('late error of the old socket'));
    old._onClose(1006, 'late close of the old socket');
    await sleep(11 * 1000);
    assert.equal(socket.connected.isSet, true);
    assert.equal(socket.socket, session, 'still the session opened by restart()');
    assert.equal(fake.stats.logins, 2, 'one login for connect, one for restart, none from the old socket');
});

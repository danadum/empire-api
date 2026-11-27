const { test } = require('node:test');
const assert = require('node:assert/strict');
const { E4kSocket } = require('../utils/ws/e4kSocket');
const { isDown } = require('../utils/ws/sockets');
const { accountFor, limits, DEVICE_ID } = require('../utils/accounts');
const { fakeE4kServer, quiet, sleep, until, LONG } = require('./fakeGame');

// Its own process. Each test uses its own zone, so the per-zone spacing of one test does not reach the next.
limits.startupDelayMs = 0;
limits.probePauseMs = 20;
limits.perDay = 100;

const e4k = async (t, fake, zone) => {
    const socket = quiet(new E4kSocket(fake.url, zone, 'user', 'secret'));
    t.after(() => socket.disconnect(false));
    await socket.connect();
    return socket;
};

const lowered = (t, values) => {
    const saved = Object.fromEntries(Object.keys(values).map((key) => [key, limits[key]]));
    Object.assign(limits, values);
    t.after(() => Object.assign(limits, saved));
};

// Accounts 0..banned-1 of the zone banned for a long time, then `working` accounts that log in.
const registry = (zone, banned, working = 0) => new Map(Array.from({ length: banned + working }, (_, generation) => {
    const { username, password } = accountFor(zone, generation, 'user', 'secret');
    return [username, generation < banned ? { password, banSeconds: LONG } : { password }];
}));

const generationOf = (zone, name) => {
    if (name === 'user') return 0;
    for (let generation = 1; generation < 1000; generation++) {
        if (accountFor(zone, generation, 'user', 'secret').username === name) return generation;
    }
};

const loginsOf = (fake, zone) => fake.stats.requests.filter((r) => r.command === 'core_lga').map((r) => generationOf(zone, r.name));

const banCurrent = (accounts, socket) => {
    accounts.get(accountFor(socket.serverHeader, socket.generation, 'user', 'secret').username).banSeconds = LONG;
};

test('a zone banned again and again gets a new account each time, without limit', async (t) => {
    lowered(t, { zoneSpacingMs: 0 });
    const zone = 'Unbounded';
    const accounts = registry(zone, 1);
    const fake = await fakeE4kServer(accounts);
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, zone);
    assert.equal(socket.generation, 1);
    for (const generation of [2, 3]) {
        banCurrent(accounts, socket);
        await socket.restart();
        assert.equal(socket.connected.isSet, true);
        assert.equal(socket.generation, generation);
    }
    assert.equal(fake.stats.registrations, 3);
    assert.deepEqual(fake.stats.requests.filter((r) => r.command === 'core_reg').map((r) => generationOf(zone, r.name)), [1, 2, 3]);
});

test('a zone registers once per spacing window: a second account waits, parked, until the window opens', async (t) => {
    lowered(t, { zoneSpacingMs: 1500 });
    const zone = 'Spacing';
    const accounts = registry(zone, 1);
    const fake = await fakeE4kServer(accounts);
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, zone);
    assert.equal(socket.generation, 1);
    const registered = Date.now();

    banCurrent(accounts, socket);
    await socket.restart();
    assert.equal(socket.parked, true);
    assert.equal(isDown(socket), false);
    assert.equal(socket.generation, 2, 'waits to register the next generation');
    assert.equal(fake.stats.registrations, 1);

    assert.ok(await until(() => socket.connected.isSet, 4000), 'registered once the window opened');
    assert.ok(Date.now() - registered >= 1500);
    assert.equal(socket.generation, 2);
    assert.equal(fake.stats.registrations, 2);
});

test('no registration before the startup delay, then the scheduled retry registers', async (t) => {
    lowered(t, { startupDelayMs: process.uptime() * 1000 + 1500 });
    const zone = 'Startup';
    const fake = await fakeE4kServer(registry(zone, 1));
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, zone);
    assert.equal(socket.parked, true);
    assert.equal(fake.stats.registrations, 0);
    assert.ok(await until(() => socket.connected.isSet, 4000));
    assert.equal(process.uptime() * 1000 >= limits.startupDelayMs, true);
    assert.equal(socket.generation, 1);
    assert.equal(fake.stats.registrations, 1);
});

test('a short ban is waited out: parked, logged in again once it is over, no new account', async (t) => {
    lowered(t, { banMarginMs: 300 });
    const zone = 'ShortBan';
    const accounts = new Map([['user', { password: 'secret', banSeconds: 1 }]]);
    const fake = await fakeE4kServer(accounts);
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, zone);
    assert.equal(socket.parked, true);
    assert.equal(socket.generation, 0);
    accounts.get('user').banSeconds = 0;
    await sleep(1000);
    assert.equal(fake.stats.logins, 1, 'not before the end of the ban plus the margin');
    assert.ok(await until(() => socket.connected.isSet, 2000));
    assert.equal(socket.generation, 0);
    assert.equal(fake.stats.logins, 2);
    assert.equal(fake.stats.registrations, 0);
});

test('a ban of exactly 24 h is waited out, one second more gets a new account', async (t) => {
    const day = 24 * 60 * 60;
    const waited = await fakeE4kServer(new Map([['user', { password: 'secret', banSeconds: day }]]));
    t.after(() => waited.server.close());
    const first = await e4k(t, waited, 'Day');
    assert.equal(first.parked, true);
    assert.equal(waited.stats.registrations, 0);

    const moved = await fakeE4kServer(new Map([['user', { password: 'secret', banSeconds: day + 1 }]]));
    t.after(() => moved.server.close());
    const second = await e4k(t, moved, 'DayAndASecond');
    assert.equal(second.connected.isSet, true);
    assert.equal(second.generation, 1);
    assert.equal(moved.stats.registrations, 1);
});

for (const k of [9, 40]) {
    test(`at a fresh start, accounts 0..${k} banned: the search finds and registers ${k + 1} in O(log k) logins`, async (t) => {
        const zone = `Gallop${k}`;
        const fake = await fakeE4kServer(registry(zone, k + 1));
        t.after(() => fake.server.close());
        const started = Date.now();
        const socket = await e4k(t, fake, zone);
        const elapsed = Date.now() - started;
        assert.equal(socket.connected.isSet, true);
        assert.equal(socket.generation, k + 1);
        assert.equal(fake.stats.registrations, 1);
        assert.equal(generationOf(zone, fake.stats.requests.find((r) => r.command === 'core_reg').name), k + 1);
        const logins = loginsOf(fake, zone);
        assert.deepEqual(logins.slice(0, 4), [0, 1, 2, 4]);
        assert.ok(logins.length <= 2 * Math.ceil(Math.log2(k + 1)) + 3, `${logins.length} logins: ${logins}`);
        // Every login but the first and the one after the registration (same connection) follows a pause.
        assert.ok(elapsed >= (logins.length - 2) * limits.probePauseMs, `${elapsed} ms`);
    });
}

test('at a fresh start, accounts 0..9 banned and 10 working: the search uses 10, no registration', async (t) => {
    const zone = 'GallopWorking';
    const fake = await fakeE4kServer(registry(zone, 10, 1));
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, zone);
    assert.equal(socket.connected.isSet, true);
    assert.equal(socket.generation, 10);
    assert.equal(fake.stats.registrations, 0);
    assert.deepEqual(loginsOf(fake, zone), [0, 1, 2, 4, 8, 16, 12, 10]);
});

test('a rate limit during the search waits its cooldown and probes the same generation again', async (t) => {
    const zone = 'GallopCooldown';
    const fake = await fakeE4kServer(registry(zone, 10, 1), { rateLimitOnce: new Set([accountFor(zone, 4, 'user', 'secret').username]) });
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, zone);
    assert.ok(await until(() => socket.connected.isSet, 3000));
    assert.equal(socket.generation, 10);
    assert.deepEqual(loginsOf(fake, zone), [0, 1, 2, 4, 4, 8, 16, 12, 10]);
});

test('a zone stopped during a pause of the search logs in no more', async (t) => {
    lowered(t, { probePauseMs: 300 });
    const zone = 'GallopStopped';
    const fake = await fakeE4kServer(registry(zone, 10, 1));
    t.after(() => fake.server.close());
    const socket = quiet(new E4kSocket(fake.url, zone, 'user', 'secret'));
    t.after(() => socket.disconnect(false));
    const connecting = socket.connect();
    assert.ok(await until(() => fake.stats.logins === 1));
    socket.disconnect(false);
    await connecting;
    await sleep(400);
    assert.equal(fake.stats.logins, 1);
    assert.equal(socket.socket, null);
});

test('a derived account logs in and registers with its own device id', async (t) => {
    const zone = 'DeviceId';
    const fake = await fakeE4kServer(registry(zone, 1));
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, zone);
    assert.equal(socket.generation, 1);
    const derived = accountFor(zone, 1, 'user', 'secret').aid;
    assert.notEqual(derived, DEVICE_ID);
    assert.deepEqual(fake.stats.requests.map((r) => [r.command, r.aid]), [
        ['core_lga', DEVICE_ID],
        ['core_lga', derived],
        ['core_reg', derived],
        ['core_lga', derived],
    ]);
});

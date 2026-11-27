const { test } = require('node:test');
const assert = require('node:assert/strict');
const { E4kSocket } = require('../utils/ws/e4kSocket');
const { isDown } = require('../utils/ws/sockets');
const { limits } = require('../utils/accounts');
const { fakeE4kServer, quiet, sleep, LONG } = require('./fakeGame');

// Its own file, so its own process: the daily registration limit starts from zero. Tests run in order.
limits.startupDelayMs = 0;
limits.registrationGapMs = 0;
limits.probePauseMs = 20;

const e4k = async (t, fake, zone) => {
    const socket = quiet(new E4kSocket(fake.url, zone, 'user', 'secret'));
    t.after(() => socket.disconnect(false));
    await socket.connect();
    return socket;
};

test('a server closing the connection after "not found" parks the zone, without a reconnect loop', async (t) => {
    const fake = await fakeE4kServer(new Map(), { closeAfterNotFound: true });
    t.after(() => fake.server.close());
    const socket = await e4k(t, fake, 'ZoneA');
    await sleep(11 * 1000);
    assert.equal(socket.parked, true);
    assert.equal(isDown(socket), false);
    assert.equal(fake.stats.logins, 1, 'no login every 10 s');
});

test(`at most ${limits.perDay} registration attempts a day for the whole process`, async (t) => {
    const accounts = new Map([['user', { password: 'secret', banSeconds: LONG }]]);
    const fake = await fakeE4kServer(accounts);
    t.after(() => fake.server.close());
    const second = await e4k(t, fake, 'ZoneB');
    assert.equal(second.connected.isSet, true, 'second attempt of the day goes through');
    const third = await e4k(t, fake, 'ZoneC');
    assert.equal(third.connected.isSet, false);
    assert.equal(third.parked, true);
    assert.notEqual(third.retryTimer, null, 'retried when the oldest attempt of the day is 24 h old');
    assert.equal(fake.stats.registrations, 1, 'ZoneC never sent core_reg');
});

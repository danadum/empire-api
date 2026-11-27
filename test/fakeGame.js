const net = require('net');

// The sys handshake both games share, then `onCommand(command, data)` answers %xt% commands.
function handshake(message, onCommand) {
    if (message.includes("action='verChk'")) return "<msg t='sys'><body action='apiOK' r='0'></body></msg>";
    if (message.includes("action='login'")) return '%xt%nfo%1%0%{"XML_E4K":"789.RC.07"}%';
    if (message.includes("action='autoJoin'")) return "<msg t='sys'><body action='joinOK' r='1'><pid id='0'/></body></msg>";
    if (message.includes("action='roundTrip'")) return "<msg t='sys'><body action='roundTripRes' r='1'></body></msg>";
    const [, , , command, , json] = message.split('%');
    return onCommand(command, json ? JSON.parse(json) : {});
}

// Fake E4K server with a registry of accounts (name -> { password, banSeconds }), counters and the requests received.
// options: banEveryone (seconds), closeAfterNotFound, refuseRegistration, rateLimitOnce (names answered CD 1 once),
// dropOnce (names whose first login gets no reply).
async function fakeE4kServer(accounts, options = {}) {
    const stats = { connections: 0, logins: 0, registrations: 0, requests: [] };
    const server = net.createServer((client) => {
        stats.connections++;
        let buffer = '';
        client.on('error', () => {});
        client.on('data', (data) => {
            buffer += data.toString();
            let index;
            while ((index = buffer.indexOf('\x00')) !== -1) {
                const message = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                const reply = handshake(message, (command, data) => {
                    if (command === 'core_lga') {
                        stats.logins++;
                        stats.requests.push({ command, name: data.NM, aid: data.AID });
                        if (options.rateLimitOnce?.delete(data.NM)) return '%xt%core_lga%1%10458%{"CD":1}%';
                        if (options.dropOnce?.delete(data.NM)) return null;
                        const account = accounts.get(data.NM);
                        const ban = options.banEveryone ?? account?.banSeconds;
                        if (ban) return `%xt%core_lga%1%10012%{"D":{"RS":${ban},"GDPR":0}}%`;
                        if (!account) {
                            if (options.closeAfterNotFound) setImmediate(() => client.destroy());
                            return '%xt%core_lga%1%10010%';
                        }
                        return account.password === data.PW ? '%xt%core_lga%1%10005%{}%' : '%xt%core_lga%1%10011%';
                    }
                    if (command === 'core_reg') {
                        stats.registrations++;
                        stats.requests.push({ command, name: data.PN, aid: data.AID });
                        if (options.refuseRegistration) return '%xt%core_reg%1%10019%';
                        accounts.set(data.PN, { password: data.PW, mail: data.MAIL });
                        return '%xt%core_reg%1%10005%{}%';
                    }
                    return null;
                });
                if (reply && !client.destroyed) client.write(reply + '\x00');
            }
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, stats, url: `tcp://127.0.0.1:${server.address().port}` };
}

// Login and session upkeep are what is tested, not the ping and gpi loops that follow a login.
function quiet(socket) {
    socket.ping = () => {};
    socket.checkConnection = async () => {};
    return socket;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LONG = 349934521;

async function until(condition, timeout = 5000) {
    const end = Date.now() + timeout;
    while (!condition() && Date.now() < end) await sleep(20);
    return condition();
}

module.exports = { handshake, fakeE4kServer, quiet, sleep, until, LONG };

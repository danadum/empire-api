const { BaseWsSocket } = require('./baseWsSocket');
const { BaseTcpSocket } = require('./baseTcpSocket');
const { Event } = require('../event');
const { accountFor, registrationWait, takeRegistration, limits } = require('../accounts');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What GGE and E4K share: handshake, account generations, registration pace, reconnection. A subclass sends its login,
// login(account) -> { status: 'ok' | 'banned' | 'missing' | 'cooldown' | 'other', seconds, gdpr }, and its registration,
// register(account) -> { status: 'refused', reason } | { status: 'registered' } (log in on a new connection) | a login outcome.
class ZoneSocket {
    constructor(url, serverHeader, username, password) {
        this.url = url;
        this.serverHeader = serverHeader;
        this.username = username;
        this.password = password;
        this.connected = new Event();
        this.reconnect = true;
        this.socket = null;
        this.retryTimer = null;
        this.parked = false;
        this.generation = 0;
        this.search = null;
        this.attempt = 0;
        this.registering = false;
    }

    // Every connect() is a new attempt: callbacks of an older socket or timer check it and leave the newer one alone.
    async connect() {
        const attempt = ++this.attempt;
        const current = () => attempt === this.attempt;
        this.reconnect = true;
        this.parked = false;
        this.registering = false;
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
        const generation = this.search ? this.search.probe : this.generation;
        const account = accountFor(this.serverHeader, generation, this.username, this.password);
        try {
            if (this.url.startsWith("ws")) {
                this.socket = new BaseWsSocket(this.url, this.serverHeader);
            } else {
                this.socket = new BaseTcpSocket(this.url, this.serverHeader);
            }

            this.socket.onError = (error) => {
                if (!current()) return;
                console.log(`### error in socket ${this.serverHeader} ###`);
                console.log(error.message);
                if (["ENOTFOUND", "ETIMEDOUT"].includes(error.code)) {
                    this.fail(attempt);
                } else {
                    this.disconnect(true);
                }
            };

            this.socket.onClose = (code, reason) => {
                if (!current()) return;
                console.log(`### socket ${this.serverHeader} closed${this.reconnect ? "" : " permanently"} ###`);
                if (this.reconnect) {
                    this.disconnect(true);
                    setTimeout(() => { if (current() && this.reconnect) this.connect(); }, 10 * 1000);
                } else {
                    this.disconnect(false);
                }
            };

            if (!(await this.socket.opened.wait(60000))) throw new Error("Socket not connected");
            console.log(`### socket ${this.serverHeader} connected ###`)

            this.socket.sendXmlMessage("sys", "verChk", "0", "<ver v='166' />")
            await this.socket.waitForXmlResponse("sys", "apiOK", "0")
            const responseAsync = this.socket.waitForJsonResponse("nfo")
            this.socket.sendXmlMessage("sys", "login", "0", `<login z='${this.serverHeader}'><nick><![CDATA[]]></nick><pword><![CDATA[1065004%fr%0]]></pword></login>`)
            const nfoResponse = await responseAsync;
            this.socket.raiseForStatus(nfoResponse)
            this.socket.sendXmlMessage("sys", "autoJoin", "-1", "")
            await this.socket.waitForXmlResponse("sys", "joinOK", "1")
            this.socket.sendXmlMessage("sys", "roundTrip", "1", "")
            await this.socket.waitForXmlResponse("sys", "roundTripRes", "1")

            let outcome = await this.login(account);
            if (outcome.status === 'missing') {
                if (this.search) {
                    this.search.missing = generation;
                    if (generation - this.search.banned > 1) return this.probe(attempt, Math.floor((this.search.banned + generation) / 2));
                    this.search = null;
                    this.generation = generation;
                }
                const wait = registrationWait(this.serverHeader);
                if (wait > 0) {
                    console.log(`### socket ${this.serverHeader}: account generation ${generation} missing, registration possible in ${Math.round(wait / 1000)}s ###`);
                    this.park();
                    return this.schedule(attempt, wait);
                }
                takeRegistration(this.serverHeader);
                this.registering = true;
                outcome = await this.register(account);
                if (!current()) return;
                if (outcome.status === 'refused') {
                    console.log(`### socket ${this.serverHeader}: registration of account generation ${generation} refused (${outcome.reason}) ###`);
                    return this.park();
                }
                if (outcome.status === 'registered') return this.connect();
            }
            if (outcome.status === 'ok') {
                if (this.search) {
                    this.search = null;
                    this.generation = generation;
                }
                this.connected.set();
                this.ping(attempt);
                await this.checkConnection(attempt);
            } else if (outcome.status === 'banned') {
                console.log(`### socket ${this.serverHeader}: account generation ${generation} banned (RS ${outcome.seconds}, GDPR ${outcome.gdpr}) ###`);
                // A deleted account (GDPR) or a ban without a usable end never comes back.
                if (outcome.gdpr === 1 || !(outcome.seconds > 0) || outcome.seconds > limits.newAccountBan) return this.longBan(attempt, generation);
                this.search = null;
                this.generation = generation;
                this.park();
                this.schedule(attempt, outcome.seconds * 1000 + limits.banMarginMs);
            } else if (outcome.status === 'cooldown') {
                console.log(`### socket ${this.serverHeader} rate limited, retrying in ${outcome.seconds}s ###`);
                this.closeQuietly();
                this.schedule(attempt, outcome.seconds * 1000);
            } else if (this.registering) {
                this.park();
            } else {
                this.disconnect(false);
            }
        } catch (error) {
            if (!current()) return;
            console.log(`### error connecting to socket ${this.serverHeader} ###`);
            console.log(error.message);
            if (this.registering) {
                this.park();
            } else {
                this.fail(attempt);
            }
        } finally {
            if (current()) this.registering = false;
        }
    }

    // Accounts exist without gaps: generation n + 1 is only registered once n is banned. A long ban on generation g looks
    // for the newest one, galloping (g + 1, g + 2, g + 4…) while banned, then bisecting between the last banned and the
    // first missing generation; the first working one is used, the first missing one after a banned one is registered.
    longBan(attempt, generation) {
        if (!this.search) this.search = { start: generation, banned: generation, missing: null };
        const search = this.search;
        search.banned = generation;
        if (search.missing === null) {
            const next = search.start + Math.max(1, 2 * (generation - search.start));
            if (next - search.start > limits.searchSpan) {
                console.log(`### socket ${this.serverHeader}: account generations ${search.start} to ${generation} all banned ###`);
                this.search = null;
                return this.park();
            }
            return this.probe(attempt, next);
        }
        if (search.missing - generation > 1) return this.probe(attempt, Math.floor((generation + search.missing) / 2));
        this.search = null;
        this.generation = search.missing;
        return this.probe(attempt, null);
    }

    // The next login of the search (or, with null, of this.generation), after a pause; the current one is closed quietly.
    async probe(attempt, generation) {
        this.closeQuietly();
        if (generation !== null) this.search.probe = generation;
        await sleep(limits.probePauseMs);
        if (attempt !== this.attempt || !this.reconnect) return;
        return this.connect();
    }

    // Down, for the 10-minute loop to replace; but a zone in a search is parked and resumes it, bounds kept.
    fail(attempt) {
        if (!this.search) return this.disconnect(false);
        this.park();
        this.schedule(attempt, limits.searchRetryMs);
    }

    schedule(attempt, ms) {
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (attempt === this.attempt) this.connect();
        }, ms);
    }

    closeQuietly() {
        if (!this.socket) return;
        this.socket.onClose = () => {};
        this.socket.onError = () => {};
        this.socket.close();
    }

    // Not retried by the 10-minute loop (isDown) nor a reason to restart the API; the daily restart tries it again.
    park() {
        this.closeQuietly();
        this.parked = true;
        this.disconnect(false);
    }

    disconnect(reconnect=true) {
        this.connected.clear();
        this.reconnect = reconnect;
        if (this.socket) this.socket.close();
        if (!reconnect) {
            this.socket = null;
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    async restart() {
        // A registration in flight would be sent twice by a second attempt.
        if (this.registering) return;
        this.disconnect(false);
        this.reconnect = true;
        await this.connect();
    }

    async ping(attempt) {
        if (!this.connected.isSet || attempt !== this.attempt) return;
        this.socket.sendRawCommand("pin", ["<RoundHouseKick>"]);
        setTimeout(() => this.ping(attempt), 30 * 1000);
    }

    async checkConnection(attempt) {
        if (!this.connected.isSet || attempt !== this.attempt) return;
        try {
            this.socket.sendJsonCommand("gpi", {});
            await this.socket.waitForJsonResponse("gpi");
            setTimeout(() => this.checkConnection(attempt), 15 * 60 * 1000);
        } catch (error) {
            if (attempt === this.attempt) this.disconnect(true);
        }
    }
}

module.exports = { ZoneSocket };

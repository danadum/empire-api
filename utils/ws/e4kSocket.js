const { BaseWsSocket } = require('./baseWsSocket');
const { BaseTcpSocket } = require('./baseTcpSocket');
const { Event } = require('../event');
const { accountFor, takeRegistration, MAX_GENERATION, LONG_BAN } = require('../accounts');

class E4kSocket {
    constructor(url, serverHeader, username, password) {
        this.url = url;
        this.serverHeader = serverHeader;
        this.username = username;
        this.password = password;
        this.connected = new Event();
        this.reconnect = true;
        this.socket = null;
        this.cooldownTimer = null;
        this.parked = false;
        this.generation = 0;
        this.attempt = 0;
    }

    // Every connect() is a new attempt: callbacks of an older socket or timer check it and leave the newer one alone.
    async connect() {
        const attempt = ++this.attempt;
        const current = () => attempt === this.attempt;
        this.reconnect = true;
        this.parked = false;
        const account = accountFor(this.serverHeader, this.generation, this.username, this.password);
        let registering = false;
        if (this.cooldownTimer) {
            clearTimeout(this.cooldownTimer);
            this.cooldownTimer = null;
        }
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
                    this.disconnect(false);
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
            this.socket.sendJsonCommand("core_lga", {NM: account.username, PW: account.password, L: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null"});
            let lgaResponse = await this.socket.waitForJsonResponse("core_lga");
            if (lgaResponse.payload.status === 10010) {
                if (!takeRegistration()) {
                    console.log(`### socket ${this.serverHeader}: account generation ${this.generation} missing, no registration left today ###`);
                    return this.park();
                }
                registering = true;
                this.socket.sendJsonCommand("core_reg", {PN: account.username, PW: account.password, MAIL: `${account.username}@mail.com`, LANG: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null", REF: ""});
                const regResponse = await this.socket.waitForJsonResponse("core_reg");
                if (regResponse.payload.status !== 10005) {
                    console.log(`### socket ${this.serverHeader}: registration of account generation ${this.generation} refused (${regResponse.payload.status}) ###`);
                    return this.park();
                }
                this.socket.sendJsonCommand("core_lga", {NM: account.username, PW: account.password, L: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null"});
                lgaResponse = await this.socket.waitForJsonResponse("core_lga");
            }
            if (lgaResponse.payload.status === 10005) {
                this.connected.set();
                this.ping(attempt);
                await this.checkConnection(attempt);
            } else if (lgaResponse.payload.status === 10012) {
                const remaining = lgaResponse.payload.data?.D?.RS ?? 0;
                console.log(`### socket ${this.serverHeader}: account generation ${this.generation} banned for ${remaining}s ###`);
                if (remaining >= LONG_BAN && this.generation < MAX_GENERATION) {
                    this.closeQuietly();
                    this.generation++;
                    return this.connect();
                }
                this.park();
            } else if (lgaResponse.payload.data?.CD !== undefined) {
                const cooldown = (lgaResponse.payload.data.CD || 60) * 1000;
                console.log(`### socket ${this.serverHeader} rate limited, retrying in ${cooldown / 1000}s ###`);
                this.closeQuietly();
                this.cooldownTimer = setTimeout(() => {
                    this.cooldownTimer = null;
                    this.connect();
                }, cooldown);
                return;
            } else if (registering) {
                this.park();
            } else {
                this.disconnect(false);
            }
        } catch (error) {
            if (!current()) return;
            console.log(`### error connecting to socket ${this.serverHeader} ###`);
            console.log(error.message);
            if (registering) {
                this.park();
            } else {
                this.disconnect(false);
            }
        }
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
        if (!reconnect) this.socket = null;
    }

    async restart() {
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

module.exports = { E4kSocket };

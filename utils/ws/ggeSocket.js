const { BaseWsSocket } = require('./baseWsSocket');
const { BaseTcpSocket } = require('./baseTcpSocket');
const { Event } = require('../event');
const { accountFor, takeRegistration, MAX_GENERATION, LONG_BAN } = require('../accounts');

class GgeSocket {
    constructor(url, serverHeader, username, password, networkId, instance) {
        this.url = url;
        this.serverHeader = serverHeader;
        this.username = username;
        this.password = password;
        this.networkId = networkId;
        this.instance = instance;
        this.connected = new Event();
        this.reconnect = true;
        this.socket = null;
        this.cooldownTimer = null;
        this.parked = false;
        this.generation = 0;
        this.attempt = 0;
        this.registering = false;
    }

    // Every connect() is a new attempt: callbacks of an older socket or timer check it and leave the newer one alone.
    async connect() {
        const attempt = ++this.attempt;
        const current = () => attempt === this.attempt;
        this.reconnect = true;
        this.parked = false;
        const account = accountFor(this.serverHeader, this.generation, this.username, this.password);
        this.registering = false;
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
            // const response = await fetch(`${process.env.RECAPTCHA_API_URL}/recaptcha`);
            // if (!response.ok) throw new Error("Failed to fetch recaptcha");
            // const recaptcha = await response.json();

            this.socket.sendJsonCommand("lli", {CONM: 175, RTM: 24, ID: 0, PL: 1, NOM: account.username, PW: account.password, LT: null, LANG: "fr", DID: "0", AID: "1674256959939529708", KID: "", REF: "https://empire.goodgamestudios.com", GCI: "", SID: 9, PLFID: 1 /*, RCT: recaptcha.token */});
            const lliResponse = await this.socket.waitForJsonResponse("lli");
            if (lliResponse.payload.status === 0) {
                this.connected.set();
                this.ping(attempt);
                await this.checkConnection(attempt);
            } else if (lliResponse.payload.status === 27) {
                const remaining = lliResponse.payload.data?.RS ?? 0;
                console.log(`### socket ${this.serverHeader}: account generation ${this.generation} banned for ${remaining}s ###`);
                if (remaining >= LONG_BAN && this.generation < MAX_GENERATION) {
                    this.closeQuietly();
                    this.generation++;
                    return this.connect();
                }
                this.park();
            } else if (lliResponse.payload.status === 453) {
                const cooldown = (lliResponse.payload.data?.CD || 60) * 1000;
                console.log(`### socket ${this.serverHeader} rate limited, retrying in ${cooldown / 1000}s ###`);
                this.closeQuietly();
                this.cooldownTimer = setTimeout(() => {
                    this.cooldownTimer = null;
                    this.connect();
                }, cooldown);
                return;
            } else if (lliResponse.payload.status === 21) {
                if (!takeRegistration()) {
                    console.log(`### socket ${this.serverHeader}: account generation ${this.generation} missing, no registration left today ###`);
                    return this.park();
                }
                this.registering = true;
                // Registration goes over HTTP; the login then happens on a new connection.
                this.closeQuietly();
                const response = await fetch(`https://lp2.goodgamestudios.com/register/index.json?gameId=12&networkId=${this.networkId}&COUNTRY=FR&forceGeoip=false&forceInstance=true&PN=${account.username}&LANG=fr-FR&MAIL=&PW=${account.password}&AID=0&adgr=0&adID=0&camp=0&cid=&journeyHash=1720629282364650193&keyword=&matchtype=&network=&nid=0&placement=&REF=&tid=&timeZone=14&V=&campainPId=0&campainCr=0&campainLP=0&DID=0&websiteId=380635&gci=0&adClickId=&instance=${this.instance}`, { signal: AbortSignal.timeout(60 * 1000) });
                const data = await response.json();
                if (!current()) return;
                if (!(data.res && data.err.length === 0)) {
                    console.log(`### socket ${this.serverHeader}: registration of account generation ${this.generation} refused (${JSON.stringify(data.err)}) ###`);
                    return this.park();
                }
                return this.connect();
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
                this.disconnect(false);
            }
        } finally {
            if (current()) this.registering = false;
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

module.exports = { GgeSocket };

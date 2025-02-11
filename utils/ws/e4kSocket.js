
const { BaseSocket } = require('./baseSocket');
const { Event } = require('../event');

class E4kSocket {
    constructor(url, serverHeader, username, password) {
        this.url = url;
        this.serverHeader = serverHeader;
        this.username = username;
        this.password = password;
        this.connected = new Event();
        this.reconnect = true;
        this.socket = null;
    }

    async connect() {
        try {
            this.socket = new BaseSocket(this.url, this.serverHeader);
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
            await this.ping();
            
            this.socket.sendJsonCommand("core_lga", {NM: this.username, PW: this.password, L: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null"});
            const lgaResponse = await this.socket.waitForJsonResponse("core_lga");
            if (lgaResponse.payload.status === 10005) {
                this.connected.set();
                await this.checkConnection();
            } else if (lgaResponse.payload.status === 10010) {
                this.socket.sendJsonCommand("core_reg", {PN: this.username, PW: this.password, MAIL: `${this.username}@mail.com`, LANG: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null", REF: ""});
                const regResponse = await this.socket.waitForJsonResponse("core_reg");
                if (regResponse.payload.status === 10005) {
                    this.socket.sendJsonCommand("core_lga", {NM: this.username, PW: this.password, L: "fr", AID: "1674256959939529708", DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null"});
                    const lgaResponse = await this.socket.waitForJsonResponse("core_lga");
                    if (lgaResponse.payload.status === 10005) {
                        this.connected.set();
                        await this.checkConnection();
                    } else {
                        this.reconnect = false;
                        this.socket.close();
                    }
                } else {
                    this.reconnect = false;
                    this.socket.close();
                }
            } else {
                this.socket.close();
            }

            this.socket.onError = (error) => {
                console.log(`### error in socket ${this.serverHeader} ###`);
                console.log(error.message);
                if (["ENOTFOUND", "ETIMEDOUT"].includes(error.code)) {
                    this.reconnect = false;
                }
                this.socket.close();
            };

            this.socket.onClose = (code, reason) => {
                console.log(`### socket ${this.serverHeader} closed${this.reconnect ? "" : " permanently"} ###`);
                this.connected.clear();
                if (this.reconnect) {
                    setTimeout(() => this.connect(), 10 * 1000);
                }
                else {
                    this.socket = null;
                }
            };
        } catch (error) {
            console.log(`### error connecting to socket ${this.serverHeader} ###`);
            console.log(error.message);
            this.reconnect = false;
            this.connected.clear();
            if (this.socket) this.socket.close();
            this.socket = null;
        }
    }

    async ping() {
        if (!this.connected.isSet) return;
        this.socket.sendRawCommand("pin", ["<RoundHouseKick>"]);
        setTimeout(() => this.ping(), 60 * 1000);
    }

    async checkConnection() {
        if (!this.connected.isSet) return;
        try {
            this.socket.sendJsonCommand("gpi", {});
            await this.socket.waitForJsonResponse("gpi");
            setTimeout(() => this.checkConnection(), 15 * 60 * 1000);
        } catch (error) {
            this.connected.clear();
            this.socket.close();
        }
    }
}

module.exports = { E4kSocket };

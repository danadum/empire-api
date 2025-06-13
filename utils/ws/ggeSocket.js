
const { BaseSocket } = require('./baseSocket');
const { Event } = require('../event');

class GgeSocket {
    constructor(url, serverHeader, username, password, networkId) {
        this.url = url;
        this.serverHeader = serverHeader;
        this.username = username;
        this.password = password;
        this.networkId = networkId;
        this.connected = new Event();
        this.reconnect = true;
        this.socket = null;
    }

    async connect() {
        try {
            this.socket = new BaseSocket(this.url, this.serverHeader);
        
            this.socket.onError = (error) => {
                console.log(`### error in socket ${this.serverHeader} ###`);
                console.log(error.message);
                if (["ENOTFOUND", "ETIMEDOUT"].includes(error.code)) {
                    this.disconnect(false);
                } else {
                    this.disconnect(true);
                }
            };

            this.socket.onClose = (code, reason) => {
                console.log(`### socket ${this.serverHeader} closed${this.reconnect ? "" : " permanently"} ###`);
                if (this.reconnect) {
                    this.disconnect(true);
                    setTimeout(() => this.connect(), 10 * 1000);
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
            await this.ping();
            
            // const response = await fetch(`${process.env.RECAPTCHA_API_URL}/recaptcha`);
            // if (!response.ok) throw new Error("Failed to fetch recaptcha");
            // const recaptcha = await response.json();

            this.socket.sendJsonCommand("lli", {CONM: 175, RTM: 24, ID: 0, PL: 1, NOM: this.username, PW: this.password, LT: null, LANG: "fr", DID: "0", AID: "1674256959939529708", KID: "", REF: "https://empire.goodgamestudios.com", GCI: "", SID: 9, PLFID: 1 /*, RCT: recaptcha.token */});
            const lliResponse = await this.socket.waitForJsonResponse("lli");
            if (lliResponse.payload.status === 0) {
                this.connected.set();
                await this.checkConnection();
            } else if (lliResponse.payload.status === 21) {
                const serverIndex = this.serverHeader.includes("EmpireEx_") ? this.serverHeader.split("EmpireEx_")[1] : "1";
                const response = await fetch(`https://lp2.goodgamestudios.com/register/index.json?gameId=12&networkId=${this.networkId}&COUNTRY=FR&forceGeoip=false&forceInstance=true&PN=${this.username}&LANG=fr-FR&MAIL=&PW=${this.password}&AID=0&adgr=0&adID=0&camp=0&cid=&journeyHash=1720629282364650193&keyword=&matchtype=&network=&nid=0&placement=&REF=&tid=&timeZone=14&V=&campainPId=0&campainCr=0&campainLP=0&DID=0&websiteId=380635&gci=0&adClickId=&instance=${serverIndex}`, { signal: AbortSignal.timeout(60 * 1000) });
                const data = await response.json();
                if (data.res && data.err.length === 0) {
                    this.socket.sendJsonCommand("lli", {CONM: 175, RTM: 24, ID: 0, PL: 1, NOM: this.username, PW: this.password, LT: null, LANG: "fr", DID: "0", AID: "1674256959939529708", KID: "", REF: "https://empire.goodgamestudios.com", GCI: "", SID: 9, PLFID: 1});
                    const lliResponse = await this.socket.waitForJsonResponse("lli");
                    if (lliResponse.payload.status === 0) {
                        this.connected.set();
                        await this.checkConnection();
                    } else {
                        this.disconnect(false);
                    }
                } else {
                    this.disconnect(false);
                }
            } else {
                this.disconnect(false);
            }
        } catch (error) {
            console.log(`### error connecting to socket ${this.serverHeader} ###`);
            console.log(error.message);
            this.disconnect(false);
        }
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
            this.disconnect(true);
        }
    }
}

module.exports = { GgeSocket };

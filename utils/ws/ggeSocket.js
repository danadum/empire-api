const { ZoneSocket } = require('./zoneSocket');

class GgeSocket extends ZoneSocket {
    constructor(url, serverHeader, username, password, networkId, instance) {
        super(url, serverHeader, username, password);
        this.networkId = networkId;
        this.instance = instance;
    }

    async login(account) {
        // const response = await fetch(`${process.env.RECAPTCHA_API_URL}/recaptcha`);
        // if (!response.ok) throw new Error("Failed to fetch recaptcha");
        // const recaptcha = await response.json();

        this.socket.sendJsonCommand("lli", {CONM: 175, RTM: 24, ID: 0, PL: 1, NOM: account.username, PW: account.password, LT: null, LANG: "fr", DID: "0", AID: account.aid, KID: "", REF: "https://empire.goodgamestudios.com", GCI: "", SID: 9, PLFID: 1 /*, RCT: recaptcha.token */});
        const { status, data } = (await this.socket.waitForJsonResponse("lli")).payload;
        if (status === 0) return { status: 'ok' };
        if (status === 27) return { status: 'banned', seconds: data?.RS ?? 0 };
        if (status === 453) return { status: 'cooldown', seconds: data?.CD || 60 };
        if (status === 21) return { status: 'missing' };
        return { status: 'other' };
    }

    // Registration goes over HTTP; the login then happens on a new connection.
    async register(account) {
        this.closeQuietly();
        const response = await fetch(`https://lp2.goodgamestudios.com/register/index.json?gameId=12&networkId=${this.networkId}&COUNTRY=FR&forceGeoip=false&forceInstance=true&PN=${account.username}&LANG=fr-FR&MAIL=&PW=${account.password}&AID=0&adgr=0&adID=0&camp=0&cid=&journeyHash=1720629282364650193&keyword=&matchtype=&network=&nid=0&placement=&REF=&tid=&timeZone=14&V=&campainPId=0&campainCr=0&campainLP=0&DID=0&websiteId=380635&gci=0&adClickId=&instance=${this.instance}`, { signal: AbortSignal.timeout(60 * 1000) });
        const data = await response.json();
        if (!(data.res && data.err.length === 0)) return { status: 'refused', reason: JSON.stringify(data.err) };
        return { status: 'registered' };
    }
}

module.exports = { GgeSocket };

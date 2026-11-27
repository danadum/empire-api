const { ZoneSocket } = require('./zoneSocket');

class E4kSocket extends ZoneSocket {
    async login(account) {
        this.socket.sendJsonCommand("core_lga", {NM: account.username, PW: account.password, L: "fr", AID: account.aid, DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null"});
        const { status, data } = (await this.socket.waitForJsonResponse("core_lga")).payload;
        if (status === 10005) return { status: 'ok' };
        if (status === 10012) return { status: 'banned', seconds: data?.D?.RS, gdpr: data?.D?.GDPR };
        if (status === 10010) return { status: 'missing' };
        if (data?.CD !== undefined) return { status: 'cooldown', seconds: data.CD || 60 };
        return { status: 'other' };
    }

    // Registered on the same connection, then logged in on it.
    async register(account) {
        this.socket.sendJsonCommand("core_reg", {PN: account.username, PW: account.password, MAIL: `${account.username}@mail.com`, LANG: "fr", AID: account.aid, DID: "5", PLFID: "3", ADID: "null", AFUID: "appsFlyerUID", IDFV: "null", REF: ""});
        const regResponse = await this.socket.waitForJsonResponse("core_reg");
        if (regResponse.payload.status !== 10005) return { status: 'refused', reason: regResponse.payload.status };
        return this.login(account);
    }
}

module.exports = { E4kSocket };

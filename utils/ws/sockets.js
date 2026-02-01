const { XMLParser } = require('fast-xml-parser');
const { GgeSocket } = require('./ggeSocket');
const { E4kSocket } = require('./e4kSocket');

async function getGgeSockets() {
    const sockets = {};
    const networksIds = [1, 5, 11, 26, 34, 39, 64, 65, 68];

    for (const networkId of networksIds) {
        const response = await fetch(`https://media.goodgamestudios.com/games-config/network/12/live/${networkId}.xml`, { signal: AbortSignal.timeout(60 * 1000) });
        const data = new XMLParser().parse(await response.text());
        if (!Array.isArray(data.network.instances.instance)) {
            data.network.instances.instance = [data.network.instances.instance];
        }
        for (const server of data.network.instances.instance) {
            if (server.zone != "EmpireEx_23") {
                const socket = new GgeSocket(`wss://${server.server}:443`, server.zone, process.env.USERNAME, process.env.PASSWORD, networkId);
                sockets[server.zone] = socket;
            }
        }
    }
    return sockets;
}

async function getE4kSockets() {
    const sockets = {};
    const networksIds = [72, 77];

    for (const networkId of networksIds) {
        const response = await fetch(`https://media.goodgamestudios.com/games-config/network/16/live/${networkId}.xml`, { signal: AbortSignal.timeout(60 * 1000) });
        const data = new XMLParser().parse(await response.text());
        if (!Array.isArray(data.network.instances.instance)) {
            data.network.instances.instance = [data.network.instances.instance];
        }
        for (const server of data.network.instances.instance) {
            const socket = new E4kSocket(`tcp://${server.server}:443`, server.zone, process.env.USERNAME, process.env.PASSWORD);
            sockets[server.zone] = socket;
        }
    }
    return sockets;
}

async function getSockets() {
    return { ...await getGgeSockets(), ...await getE4kSockets() };
}

function connectSockets(sockets) {
    for (const socket of Object.values(sockets)) {
        socket.connect();
    }
}

function restartSockets(sockets) {
    for (const socket of Object.values(sockets)) {
        socket.restart();
    }
}

module.exports = {
    getSockets,
    connectSockets,
    restartSockets
};
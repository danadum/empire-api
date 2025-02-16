const { XMLParser } = require('fast-xml-parser');
const { GgeSocket } = require('./ggeSocket');
const { E4kSocket } = require('./e4kSocket');

async function getGgeSockets() {
    const sockets = {};
    const response = await fetch("https://empire-html5.goodgamestudios.com/config/network/1.xml", { signal: AbortSignal.timeout(60 * 1000) });
    const data = new XMLParser().parse(await response.text());
    for (const server of data.network.instances.instance) {
        if (server.zone != "EmpireEx_23") {
            const socket = new GgeSocket(`wss://${server.server}`, server.zone, process.env.USERNAME, process.env.PASSWORD);
            sockets[server.zone] = socket;
        }
    }
    return sockets;
}

async function getE4kSockets() {
    const sockets = {};
    const response = await fetch("https://raw.githubusercontent.com/danadum/ggs-assets/main/e4k/network.xml", { signal: AbortSignal.timeout(60 * 1000) });
    const data = new XMLParser().parse(await response.text());
    for (const server of data.network.instances.instance) {
        const socket = new E4kSocket(`ws://${server.server}`, server.zone, process.env.USERNAME, process.env.PASSWORD);
        sockets[server.zone] = socket;
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
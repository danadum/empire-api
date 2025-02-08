const { XMLParser } = require('fast-xml-parser');
const { GgeSocket } = require('./ggeSocket');

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

async function connectSockets(sockets) {
    const connections = [];
    for (const socket of Object.values(sockets)) {
        connections.push(socket.connect());
    }
    // await Promise.all(connections);
}
module.exports = {
    getGgeSockets,
    connectSockets
};
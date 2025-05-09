const { getSockets, connectSockets, restartSockets } = require('./utils/ws/sockets');

getSockets().then(async sockets => {
    connectSockets(sockets);
    setInterval(async () => {
        const newSockets = await getSockets();
        for (const [serverHeader, socket] of Object.entries(newSockets)) {
            if (!(serverHeader in sockets) || sockets[serverHeader].socket === null) {
                sockets[serverHeader] = socket;
                socket.connect();
            }
        }
    }, 60 * 1000);
    setInterval(() => {
        if (Object.values(sockets).some(socket => socket.socket === null)) { 
            process.exit(1);
        } else {
            restartSockets(sockets);
        }
    }, 24 * 60 * 60 * 1000);
    const app = require('./app')(sockets);
    const PORT = process.env.PORT ?? 3000;
    app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});

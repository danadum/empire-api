const { getSockets, connectSockets, restartSockets } = require('./utils/ws/sockets');

getSockets().then(async sockets => {
    await fetch(process.env.RECAPTCHA_API_WAKE_UP_URL);
    connectSockets(sockets);
    setInterval(async () => {
        const newSockets = await getSockets();
        if (Object.keys(newSockets).some((serverHeader => !(serverHeader in sockets) || sockets[serverHeader].socket === null))) {
            await fetch(process.env.RECAPTCHA_API_WAKE_UP_URL);
        }
        for (const [serverHeader, socket] of Object.entries(newSockets)) {
            if (!(serverHeader in sockets) || sockets[serverHeader].socket === null) {
                sockets[serverHeader] = socket;
                socket.connect();
            }
        }
    }, 10 * 60 * 1000);
    setInterval(async () => {
        if (Object.values(sockets).some(socket => socket.socket === null)) { 
            process.exit(1);
        } else {
            await fetch(process.env.RECAPTCHA_API_WAKE_UP_URL);
            restartSockets(sockets);
        }
    }, 24 * 60 * 60 * 1000);
    const app = require('./app')(sockets);
    const PORT = process.env.PORT ?? 3000;
    app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});

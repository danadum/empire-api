const { getSockets, connectSockets, restartSockets } = require('./utils/ws/sockets');
// const { wakeUpRecaptchaApi } = require('./utils/recaptcha');

getSockets().then(async sockets => {
    // await wakeUpRecaptchaApi();
    connectSockets(sockets);
    setInterval(async () => {
        const newSockets = await getSockets();
        // if (Object.keys(newSockets).some((serverHeader => !(serverHeader in sockets) || sockets[serverHeader].socket === null))) {
        //     await wakeUpRecaptchaApi();
        // }
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
            // await wakeUpRecaptchaApi();
            restartSockets(sockets);
        }
    }, 24 * 60 * 60 * 1000);
    const app = require('./app')(sockets);
    const PORT = process.env.PORT ?? 3000;
    app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});

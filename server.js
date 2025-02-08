const { getGgeSockets, connectSockets } = require('./utils/ws/sockets');

getGgeSockets().then(async sockets => {
    await connectSockets(sockets);
    setInterval(async () => {
        const newSockets = await getGgeSockets();
        for (const [serverHeader, socket] of Object.entries(newSockets)) {
            if (!(serverHeader in sockets) || sockets[serverHeader].socket === null) {
                sockets[serverHeader] = socket;
                socket.connect();
            }
        }
    }, 60 * 60 * 1000);
    setInterval(() => {
        if (Object.values(sockets).some(socket => socket.socket === null)) { 
            process.exit(1);    
        }
    }, 24 * 60 * 60 * 1000);
    const app = require('./app')(sockets);
    const PORT = process.env.PORT ?? 3000;
    app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});

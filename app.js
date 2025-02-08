const express = require('express');
const commands = require('./data/commands.json');
const { setNestedValue } = require('./utils/nestedHeaders');

module.exports = function (sockets) {
    const app = express();

    app.use((req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "GET");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        next();
    });

    app.get("/:server/:command/:headers", async (req, res) => {
        if (req.params.server in sockets) {
            if (sockets[req.params.server] !== null && sockets[req.params.server].connected.isSet) {
                try {
                    const messageHeaders = JSON.parse(`{${req.params.headers}}`);
                    sockets[req.params.server].socket.sendJsonCommand(req.params.command, messageHeaders);

                    let responseHeaders = {};
                    if (req.params.command in commands) {
                        for (const [messageKey, responsePath] of Object.entries(commands[req.params.command])) {
                            if (messageKey in messageHeaders) {
                                setNestedValue(responseHeaders, responsePath, messageHeaders[messageKey]);
                            }
                        }    
                    } else {
                        responseHeaders = messageHeaders;
                    }

                    const response = await sockets[req.params.server].socket.waitForJsonResponse(req.params.command, responseHeaders, timeout = 1000);
                    res.status(200).json({server: req.params.server, command: req.params.command, return_code: response.payload.status, content: response.payload.data});
                } catch (error) {
                    console.log(error.message);
                    res.status(400).json({ error: "Invalid command or headers" });
                }
            } else {
                res.status(500).json({ error: "Server not connected" });
            }
        } else {
            res.status(404).json({ error: "Server not found" });
        }
    });

    app.get("/", (req, res) => res.status(200).send("API running"));

    return app;
}
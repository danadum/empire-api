require('dotenv').config();

const express = require('express');
const { XMLParser } = require('fast-xml-parser');
const { fetch, setGlobalDispatcher, Agent } = require('undici');
// const { launchBrowser, generateRecaptchaToken } = require('./recaptcha')
const { connect, getSocketResponse } = require('./socket');

setGlobalDispatcher(new Agent({connect: {timeout: 60_000}}));

const PORT = process.env.PORT ?? 3000;
const servers = {};

async function get_sockets() {
    let servers_file = await fetch("https://empire-html5.goodgamestudios.com/config/network/1.xml");
    servers_file = new XMLParser().parse(await servers_file.text());
    // let puppeteer = await launchBrowser();
    for (instance of servers_file.network.instances.instance) {
        if (instance.zone != "EmpireEx_23" && !(instance.zone in servers)) {
            servers[instance.zone] = {url: `wss://${instance.server}`, reconnect: true, messages: [], responses: []};
            connect(servers, instance.zone);
        }
    }
    // puppeteer.browser.close();
    setTimeout(get_sockets, 3600000);
}

get_sockets();

const app = express();

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next();
});

app.get("/:server/:command/:headers", async (req, res) => {
    if (req.params.server in servers) {
        try {
            let JSONheaders = JSON.parse(`{${req.params.headers}}`);
            servers[req.params.server].socket.send(`%xt%${req.params.server}%${req.params.command}%1%{${req.params.headers}}%`);
            servers[req.params.server].messages.push({server: req.params.server, command: req.params.command, headers: JSONheaders});
            res.json(await getSocketResponse(servers, {server: req.params.server, command: req.params.command, headers: JSONheaders}, 0));    
        }
        catch {
            res.json({server: req.params.server, command: req.params.command, return_code: "-1", content: {"error": "Bad request"}});    
        }
    }
    else {
        res.json({server: req.params.server, command: req.params.command, return_code: "-1", content: {"error": "This server is currently not supported"}});    
    }
});

/* app.post("/recaptcha", async (req, res) => {
    if (req.body.site_key == SITE_KEY) {
        let puppeteer = await launchBrowser();
        res.status(200).json({token: await generateRecaptchaToken(puppeteer.frame)});
        puppeteer.browser.close();
    }
    else {
        res.status(401).json({token: null});    
    }
}); */

app.listen(PORT, () => console.log(`Express Server listening on port ${PORT}`));
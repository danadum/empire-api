const express = require('express');
const WebSocket = require('ws');
const jsdom = require('jsdom');
require('dotenv').config();

const NOM_UTILISATEUR = process.env.NOM_UTILISATEUR;
const MOT_DE_PASSE = process.env.MOT_DE_PASSE;
const PORT = process.env.PORT || 3000;
let message_lists = {};
let response_lists = {};
let sockets = {}


async function get_sockets() {
    let sockets_file = await fetch("https://empire-html5.goodgamestudios.com/config/network/1.xml");
    sockets_file = await sockets_file.text();
    sockets_file = new jsdom.JSDOM(sockets_file, {contentType: "text/xml"});
    for (instance of sockets_file.window.document.children[0].children[0].children) {
        let header = instance.children[2].textContent;
        if (header != "EmpireEx_23" && !(header in sockets)) {
            sockets[header] = {url: `wss://${instance.children[0].textContent}`, 'reconnect': true};
            message_lists[header] = [];
            response_lists[header] = [];
            connect(header);
        }
    }
    setTimeout(get_sockets, 3600000);
}

get_sockets();

function connect(header) {
    let socket = sockets[header].socket = new WebSocket(sockets[header].url);
    socket.addEventListener('open', (event) => {
        console.log(`### socket ${header} connected ###`)
        socket.send(`<msg t='sys'><body action='login' r='0'><login z='${header}'><nick><![CDATA[]]></nick><pword><![CDATA[1065004%fr%0]]></pword></login></body></msg>`);
        socket.send(`%xt%${header}%lli%1%{"CONM":175,"RTM":24,"ID":0,"PL":1,"NOM":"${NOM_UTILISATEUR}","PW":"${MOT_DE_PASSE}","LT":null,"LANG":"fr","DID":"0","AID":"1674256959939529708","KID":"","REF":"https://empire.goodgamestudios.com","GCI":"","SID":9,"PLFID":1}%`);
    });

    socket.addEventListener('message', (event) => {
        let response = event.data.toString().split("%");
        response = {server: header, command: response[2], return_code: response[4], content: response[5]};
        try {
            response.content = JSON.parse(response.content || "{}");
        }
        catch {}
        if (response.command == "lli") {
            if (response.return_code == "0") {
                ping_socket(socket);
            }
            else {
                socket.close()
            }
        }
        else {
            let messages = message_lists[header].filter(message => message.command == response.command && Object.keys(message.headers).every(key => Object.keys(response.content).includes(key) && message.headers[key] == response.content[key]));
            if (messages.length > 0) {
                response_lists[header].push(response);
            }    
        }
    });

    socket.addEventListener('error', (event) => {
        console.log(`### error in socket ${header} ###`);
        console.log(event.message);
        if (event.error.code == "ENOTFOUND") {
            sockets[header].reconnect = false
        }
        socket.close();
    });

    socket.addEventListener('close', (event) => {
        console.log(`### socket ${header} closed ###`);
        if (sockets[header].reconnect) {
            setTimeout(() => connect(header), 10000);
        }
        else {
            delete sockets[header];
            delete message_lists[header];
            delete response_lists[header];
        }
    });
}

function ping_socket(socket) {
    if (socket.readyState != WebSocket.CLOSED && socket.readyState != WebSocket.CLOSING) {
        socket.send("%xt%EmpireEx_3%pin%1%<RoundHouseKick>%");
        setTimeout(() => ping_socket(socket), 60000);
    }
}

const app = express();
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', 'https://danadum.github.io');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next();
});

app.get("/:server/:command/:headers", async (req, res) => {
    if (req.params.server in sockets) {
        sockets[req.params.server].socket.send(`%xt%${req.params.server}%${req.params.command}%1%{${req.params.headers}}%`);
        try {
            message_lists[req.params.server].push({server: req.params.server, command: req.params.command, headers: JSON.parse(`{${req.params.headers}}`)});
            res.send(await get_socket_response({server: req.params.server, command: req.params.command, headers: JSON.parse(`{${req.params.headers}}`)}, 0));    
        }
        catch {
            res.send({server: req.params.server, command: req.params.command, return_code: "-1", content: {"error": "Bad request"}});    
        }
    }
    else {
        res.send({server: req.params.server, command: req.params.command, return_code: "-1", content: {"error": "This server is currently not supported"}});    
    }
});

app.listen(PORT, () => console.log(`Express Server listening on port ${PORT}`));

async function get_socket_response(message, nb_try) {
    if (nb_try < 20) {
        let responses = response_lists[message.server].filter(response => message.command == response.command && Object.keys(message.headers).every(key => Object.keys(response.content).includes(key) && message.headers[key] == response.content[key]));
        let response;
        if (responses.length > 0) {
            response = response_lists[message.server].splice(response_lists[message.server].indexOf(responses[0]), 1)[0];
            message_lists[message.server].splice(message_lists[message.server].indexOf(message), 1);
        }
        else {
            await new Promise(resolve => setTimeout(resolve, 50));
            response = await get_socket_response(message, nb_try + 1);
        }
        return response;    
    }
    else {
        message_lists[message.server].splice(message_lists[message.server].indexOf(message), 1);
        return {server: message.server, command: message.command, return_code: "-1", content: {}};;
    }
}
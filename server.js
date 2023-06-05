const express = require('express');
const WebSocket = require('ws');
const jsdom = require('jsdom');
require('dotenv').config();

const NOM_UTILISATEUR = process.env.NOM_UTILISATEUR;
const MOT_DE_PASSE = process.env.MOT_DE_PASSE;
const PORT = process.env.PORT || 3000;
let messages = {};
let responses = {};
let sockets = {}


async function get_sockets() {
    let sockets_file = await fetch("https://empire-html5.goodgamestudios.com/config/network/1.xml");
    sockets_file = await sockets_file.text();
    sockets_file = new jsdom.JSDOM(sockets_file, {contentType: "text/xml"});
    for (instance of sockets_file.window.document.children[0].children[0].children) {
        let header = instance.children[2].textContent;
        if (header != "EmpireEx_23" && !(header in sockets)) {
            sockets[header] = {url: `wss://${instance.children[0].textContent}`, 'reconnect': true};
            messages[header] = [];
            responses[header] = [];
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
            else if (response.return_code == "21") {
                socket.send(`%xt%${header}%lre%1%{"DID":0,"CONM":515,"RTM":60,"campainPId":-1,"campainCr":-1,"campainLP":-1,"adID":-1,"timeZone":14,"username":"${NOM_UTILISATEUR}","email":null,"password":"${MOT_DE_PASSE}","accountId":"1681390746855129824","ggsLanguageCode":"fr","referrer":"https://empire.goodgamestudios.com","distributorId":0,"connectionTime":515,"roundTripTime":60,"campaignVars":";https://empire.goodgamestudios.com;;;;;;-1;-1;;1681390746855129824;0;;;;;","campaignVars_adid":"-1","campaignVars_lp":"-1","campaignVars_creative":"-1","campaignVars_partnerId":"-1","campaignVars_websiteId":"0","timezone":14,"PN":"${NOM_UTILISATEUR}","PW":"${MOT_DE_PASSE}","REF":"https://empire.goodgamestudios.com","LANG":"fr","AID":"1681390746855129824","GCI":"","SID":9,"PLFID":1,"NID":1,"IC":""}%`);
            }
            else {
                socket.close();
            }
        }
        else if (response.command == "lre") {
            if (response.return_code == "0") {
                ping_socket(socket);
            }
            else {
                sockets[header].reconnect = false;
                socket.close();
            }
        }
        else {
            if (messages[header].some(message => message.command == response.command && Object.keys(message.headers).every(key => message.headers[key] == response.content[key]))) {
                responses[header].push(response);
            }    
        }
    });

    socket.addEventListener('error', (event) => {
        console.log(`### error in socket ${header} ###`);
        console.log(event.message);
        if (event.error.code in ["ENOTFOUND", "ETIMEDOUT"]) {
            sockets[header].reconnect = false;
        }
        socket.close();
    });

    socket.addEventListener('close', (event) => {
        console.log(`### socket ${header} closed ${sockets[header].reconnect ? "" : "permanently "}###`);
        if (sockets[header].reconnect) {
            setTimeout(() => connect(header), 10000);
        }
        else {
            delete sockets[header];
            delete messages[header];
            delete responses[header];
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
            messages[req.params.server].push({server: req.params.server, command: req.params.command, headers: JSON.parse(`{${req.params.headers}}`)});
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
        let response = responses[message.server].find(response => message.command == response.command && Object.keys(message.headers).every(key => message.headers[key] == response.content[key]));
        if (response != undefined) {
            responses[response.server].splice(responses[response.server].indexOf(response), 1);
            messages[message.server].splice(messages[message.server].indexOf(message), 1);
        }
        else {
            await new Promise(resolve => setTimeout(resolve, 50));
            response = await get_socket_response(message, nb_try + 1);
        }
        return response;    
    }
    else {
        messages[message.server].splice(messages[message.server].indexOf(message), 1);
        return {server: message.server, command: message.command, return_code: "-1", content: {}};;
    }
}
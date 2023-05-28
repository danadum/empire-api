const express = require('express');
const WebSocket = require('ws');
require('dotenv').config();

const NOM_UTILISATEUR = process.env.NOM_UTILISATEUR;
const MOT_DE_PASSE = process.env.MOT_DE_PASSE;
const PORT = process.env.PORT || 3000;
let message_queue = [];
let response_queue = [];
let socket;

function connect() {
    socket = new WebSocket('wss://ep-live-fr1-game.goodgamestudios.com/');
    socket.addEventListener('open', (event) => {
        console.log("### socket connected ###")
        socket.send(`<msg t='sys'><body action='login' r='0'><login z='EmpireEx_3'><nick><![CDATA[]]></nick><pword><![CDATA[1065004%fr%0]]></pword></login></body></msg>`);
        socket.send(`%xt%EmpireEx_3%lli%1%{"CONM":175,"RTM":24,"ID":0,"PL":1,"NOM":"${NOM_UTILISATEUR}","PW":"${MOT_DE_PASSE}","LT":null,"LANG":"fr","DID":"0","AID":"1674256959939529708","KID":"","REF":"https://empire.goodgamestudios.com","GCI":"","SID":9,"PLFID":1}%`);
    });

    socket.addEventListener('message', (event) => {
        let response = event.data.toString().trim("%").split("%");
        response = {command: response[2], return_code: response[4], content: response[5]};
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
            let messages = message_queue.filter(message => message.command == response.command && Object.keys(message.headers).every(key => Object.keys(response.content).includes(key) && message.headers[key] == response.content[key]));
            if (messages.length > 0) {
                response_queue.push(response);
            }    
        }
    });

    socket.addEventListener('error', (event) => {
        console.log("### error in socket ###");
        console.log(event.message);
        socket.close();
    });

    socket.addEventListener('close', (event) => {
        console.log("### socket closed ###");
        setTimeout(connect, 10000);
    });
}

connect();

function ping_socket(socket) {
    if (socket.readyState != WebSocket.CLOSED && socket.readyState != WebSocket.CLOSING) {
        socket.send("%xt%EmpireEx_3%pin%1%<RoundHouseKick>%");
        setTimeout(() => ping_socket(socket), 60000);
    }
}

const app = express();
app.get("/:server/:command/:headers", async (req, res) => {
    socket.send(`%xt%${req.params.server}%${req.params.command}%1%{${req.params.headers}}%`);
    message_queue.push({server: req.params.server, command: req.params.command, headers: JSON.parse(`{${req.params.headers}}`)});
    res.send(await get_socket_response({server: req.params.server, command: req.params.command, headers: JSON.parse(`{${req.params.headers}}`)}, 0));
});

app.listen(PORT, () => console.log(`Express Server listening on port ${PORT}`));

async function get_socket_response(message, nb_try) {
    if (nb_try < 20) {
        let responses = response_queue.filter(response => message.command == response.command && Object.keys(message.headers).every(key => Object.keys(response.content).includes(key) && message.headers[key] == response.content[key]));
        let response;
        if (responses.length > 0) {
            response = response_queue.splice(response_queue.indexOf(responses[0]), 1);
            message_queue.splice(message_queue.indexOf(responses), 1);
        }
        else {
            await new Promise(resolve => setTimeout(resolve, 50));
            response = await get_socket_response(message, nb_try + 1);
        }
        return response;    
    }
    else {
        return "error";
    }
}
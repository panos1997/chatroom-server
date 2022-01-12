const express = require('express');
const app = express();
const http =  require('http');
const cors = require('cors');
const { Server } = require('socket.io');

app.use(cors()); 

const server = http.createServer(app);

const io =  new Server(server, {
    cors: {
        origin: 'https://my-chatroom-app-client.herokuapp.com',  
        methods: ['GET', 'POST']
    }
});

let messagesPerConnection = {};

io.on('connection', (socket) => {
    console.log(`user with id: ${socket.id} connected`);

    socket.on('join_room', (data) => {
        socket.join(data);
        if(!messagesPerConnection[data]) messagesPerConnection[data] = [];
        socket.emit('receive_all_messages', messagesPerConnection[data]);
    });

    socket.on('send_message', (data) => {
        if(messagesPerConnection[data.room].length < 300) messagesPerConnection[data.room].push(data);
        socket.to(data.room).emit('receive_message', data);
    });

    socket.on('clear_all_messages', room => {
        messagesPerConnection[room] = [];
        socket.emit('receive_all_messages', []);
        socket.to(room).emit('receive_all_messages', []);
    });

    socket.on('disconnect', () => {
        console.log('user disconnected: ', socket.id); 
    });
});
 
server.listen(process.env.PORT || 3001, () => {
    console.log('server started...');
});
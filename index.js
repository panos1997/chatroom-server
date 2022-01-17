const express = require('express');
const app = express();
const http =  require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mysql = require('mysql');

app.use(cors()); 

const server = http.createServer(app);

const io =  new Server(server, {
    cors: {
        origin: 'https://my-chatroom-app-client.herokuapp.com',  
        // origin: 'http://localhost:3000',  
        methods: ['GET', 'POST']
    }
});
 
// mysql://b16417fa1e8fed:12f0f41f@eu-cdbr-west-02.cleardb.net/heroku_2e96bb5ce85b3ae?reconnect=true

// db on heroku
const db = mysql.createPool({
    host: 'eu-cdbr-west-02.cleardb.net',
    user: 'b16417fa1e8fed',
    password: '12f0f41f',
    database: 'heroku_2e96bb5ce85b3ae'
});

// local db
// const db = mysql.createPool({
//     host: 'localhost',
//     user: 'root',
//     password: 'password',
//     database: 'chatroom'
// });

let messagesPerConnection = {};

const userLeftRoom = (user, room) => {
    console.log('user left room');

    const roomName = room.name;

    const getChatRoomQuery = `SELECT * FROM chatroom WHERE name='${roomName}'`;

    db.query(getChatRoomQuery, (err, res) => {
        const foundChatRoom = res[0];

        if(!foundChatRoom) return;
        
        // update db by removing the user that left the chatroom (only in case user is indeed in the chatroom)
        let newUsers = JSON.parse(foundChatRoom.users).users; 
        const userIndex = newUsers.findIndex(userTemp => userTemp.name === user.name);
        
        if(userIndex !== -1) {
            newUsers.splice(userIndex, 1);
            // if there is no user left in the chat, delete the chat from db
            if(newUsers.length === 0) {
                const deleteQuery = `DELETE FROM chatroom WHERE name='${roomName}'`; 
                db.query(deleteQuery, (error, result) => {
                    console.log(error);
                });
            } 
            // or else, just remove the current user from the chatroom
            else {
                const updateQuery = `UPDATE chatroom SET users=(?) WHERE name='${roomName}'`; 
                db.query(updateQuery, [JSON.stringify({users: newUsers})], (error, result) => {
                    console.log(error);
                });
            }
        }
    });
}

io.on('connection', (socket) => {
    console.log(`user with id: ${socket.id} connected`);

    // TODO: get all users and send them to frontend
    // socket.on('get_all_users_in_room', (room) => {
    //     const getChatRoomQuery = `SELECT * FROM chatroom WHERE name='${room.name}'`;

    //     db.query(getChatRoomQuery, (err, res) => {
    //         const chatRoom = res[0];
    //     });
    // });

    socket.on('join_room', (data) => {
        console.log('data: ', data);
        socket.join(data.room.name);

        const roomName = data.room.name;
        
        socket.user = data.user;
        socket.room = data.room;
        
        if(!messagesPerConnection[data.roomName]) messagesPerConnection[roomName] = [];
        
        socket.emit('receive_all_messages', messagesPerConnection[roomName]);

        const getChatRoomQuery = `SELECT * FROM chatroom WHERE name='${roomName}'`;

        db.query(getChatRoomQuery, (err, res) => {
            const foundChatRoom = res[0]; 

            // if chatroom does not exist in db, create it
            if(!foundChatRoom) {
                const users = JSON.stringify({users: [data.user]});
                const insertQuery = `INSERT INTO chatroom (name, users) VALUES (?, ?)`;
                return db.query(insertQuery, [roomName, users], (err, res) => {
                    console.log(err);
                    socket.emit('joined_room', !err); 
                });
            } 
            
            // update db with the user that joined the chatroom
            let newUsers = JSON.parse(foundChatRoom.users).users; 
            newUsers.push(data.user);

            if(newUsers.length > 2) return socket.emit('joined_room', false);

            const updateQuery = `UPDATE chatroom SET users=(?) WHERE name='${roomName}'`; 
            db.query(updateQuery, [JSON.stringify({users: newUsers})], (error, result) => {
                console.log(error);
                socket.emit('joined_room', !error);
            });
        });
    });

    socket.on('send_message', (data) => {
        const roomName = data.room.name;
        if(messagesPerConnection[roomName].length < 300) messagesPerConnection[roomName].push(data);
        socket.to(roomName).emit('receive_message', data);
    });

    socket.on('clear_all_messages', room => {
        messagesPerConnection[room.name] = [];
        socket.emit('receive_all_messages', []);
    });

    socket.on('left_room', ({user, room}) => userLeftRoom(user, room));

    socket.on('disconnect', async () => {
        // when user disconnects for any reason (even page refresh), we want the user to be removed from this chatroom in db
        socket.room && userLeftRoom(socket.user, socket.room);
    });
});

server.listen(process.env.PORT || 3001, () => { 
    console.log('server started...');
});
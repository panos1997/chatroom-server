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

const avatarColors = [
    'red',
    'green',
    'orange',
    'yellow',
    'blue',
    'grey',
    'pink',
    'purple',
    'black',
    'white'
]

app.get('/getUsersInChat/:roomChatName', (request, response) => {
    const roomChatName = request.params.roomChatName;

    const getChatRoomQuery = `SELECT * FROM chatroom WHERE name='${roomChatName}'`;

    db.query(getChatRoomQuery, (err, res) => {
        if(err) console.log(err);
        
        const foundChatRoom = res[0];

        if(!foundChatRoom) return;

        let allUsersInChat = JSON.parse(foundChatRoom.users).users; 
        
        console.log('the users in the chat are: ', allUsersInChat);

        return response.status(200).json(allUsersInChat)
    });
});

const userLeftRoom = (user, room, socket) => {
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

                socket.to(roomName).emit('someone_joined_or_left', newUsers);
            }
        }
    });
}

io.on('connection', (socket) => {
    console.log(`user with id: ${socket.id} connected`);

    socket.on('join_room', (data) => {
        console.log('data: ', data);
        socket.join(data.room.name);

        const roomName = data.room.name;
        let currentUser = data.user;        
        
        socket.user = data.user;
        socket.room = data.room;
        
        if(!messagesPerConnection[data.roomName]) messagesPerConnection[roomName] = [];
        
        socket.emit('receive_all_messages', messagesPerConnection[roomName]);

        const getChatRoomQuery = `SELECT * FROM chatroom WHERE name='${roomName}'`;

        db.query(getChatRoomQuery, (err, res) => {
            const foundChatRoom = res[0]; 

            // if chatroom does not exist in db, create it
            if(!foundChatRoom) {
                currentUser = {
                    ...currentUser, 
                    avatarColor: avatarColors[0]
                };

                const users = JSON.stringify({users: [currentUser]});
                const insertQuery = `INSERT INTO chatroom (name, users) VALUES (?, ?)`;

                return db.query(insertQuery, [roomName, users], (err, res) => {
                    console.log(err);
                    socket.emit('joined_room', {joined: !err, user: currentUser, room: {name: roomName}}); 
                });
            } 
            
            // update db with the user that joined the chatroom
            let newUsers = JSON.parse(foundChatRoom.users).users; 
            const avatarColorsUsed = newUsers.map(user => user.avatarColor);
                        
            avatarColors.every(color => {
               if(!avatarColorsUsed.includes(color)) {
                   currentUser = {...currentUser, avatarColor: color};
                   return false;
               } else return true;
            });

            newUsers.push(currentUser);

            if(newUsers.length > 10) return socket.emit('joined_room', {joined: false, user: currentUser, room: foundChatRoom});
            
            const updateQuery = `UPDATE chatroom SET users=(?) WHERE name='${roomName}'`; 

            db.query(updateQuery, [JSON.stringify({users: newUsers})], (error, result) => {
                console.log(error);
                socket.emit('joined_room', {joined: !error, user: currentUser, room: foundChatRoom});
                socket.to(roomName).emit('someone_joined_or_left', newUsers);
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

    socket.on('left_room', ({user, room}) => socket && userLeftRoom(user, room, socket));

    socket.on('disconnect', async () => {
        // when user disconnects for any reason (even page refresh), we want the user to be removed from this chatroom in db
        socket.room && userLeftRoom(socket.user, socket.room, socket);
    });
});

server.listen(process.env.PORT || 3001, () => { 
    console.log('server started...');
});
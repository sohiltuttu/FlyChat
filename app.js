const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('join-room', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const numClients = room ? room.size : 0;

        if (numClients >= 2) {
            socket.emit('room-full', 'Room is full! Maximum 2 users allowed.');
            return;
        }

        socket.join(roomId);
        socket.emit('joined', roomId);
        socket.to(roomId).emit('receive-message', { sender: 'System', text: 'Another user joined the room.' });
    });

    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
        socket.emit('left-room');
        socket.to(roomId).emit('receive-message', { sender: 'System', text: 'The other user left the room.' });
    });

    socket.on('send-message', (data) => {
        io.to(data.room).emit('receive-message', { sender: socket.id, text: data.message });
    });
});

http.listen(3000, () => {
    console.log('Server running on port 3000');
});
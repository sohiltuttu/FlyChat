const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    maxHttpBufferSize: 200 * 1024 * 1024 // 200 MB Buffer Size Limit
});

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
        io.to(data.room).emit('receive-message', { 
            sender: socket.id, 
            text: data.message,
            type: data.type,
            replyTo: data.replyTo || null
        });
    });

    // WebRTC Signaling and Call Request Events
    socket.on('request-call', (data) => {
        socket.to(data.room).emit('incoming-call', { callerId: socket.id });
    });

    socket.on('accept-call', (data) => {
        socket.to(data.room).emit('call-accepted');
    });

    socket.on('reject-call', (data) => {
        socket.to(data.room).emit('call-rejected');
    });

    socket.on('call-user', (data) => {
        socket.to(data.room).emit('call-made', {
            offer: data.offer,
            socket: socket.id
        });
    });

    socket.on('make-answer', (data) => {
        socket.to(data.room).emit('answer-made', {
            socket: socket.id,
            answer: data.answer
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.room).emit('ice-candidate', data.candidate);
    });

    socket.on('end-call', (data) => {
        socket.to(data.room).emit('call-ended');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

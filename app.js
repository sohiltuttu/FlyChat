const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    maxHttpBufferSize: 200 * 1024 * 1024 // 200 MB Limit
});

app.use(express.static('public'));

// Global Memory for Storing Rooms and Messages
const rooms = {};

io.on('connection', (socket) => {
    socket.on('join-room', (roomId) => {
        socket.roomId = roomId;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: new Map(),
                messages: []
            };
        }

        const room = rooms[roomId];

        if (room.users.size >= 2 && !room.users.has(socket.id)) {
            socket.emit('room-full', 'Room is full! Maximum 2 users allowed.');
            return;
        }

        room.users.set(socket.id, true);
        socket.join(roomId);
        socket.emit('joined', roomId);

        // റൂമിൽ ജോയിൻ ചെയ്യുമ്പോൾ പഴയ മെസ്സേജുകൾ കാണിക്കുന്നു
        socket.emit('initial-messages', room.messages);

        socket.to(roomId).emit('receive-message', { sender: 'System', text: 'Another user joined the room.' });
    });

    socket.on('leave-room', (roomId) => {
        handleDisconnect(socket);
        socket.emit('left-room');
    });

    socket.on('send-message', (data) => {
        const room = rooms[data.room];
        if (!room) return;

        const messageData = {
            id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
            sender: socket.id,
            text: data.message,
            type: data.type,
            replyTo: data.replyTo || null,
            readBy: [socket.id]
        };

        room.messages.push(messageData);
        io.to(data.room).emit('receive-message', messageData);
    });

    socket.on('mark-read', (messageId) => {
        const room = rooms[socket.roomId];
        if (!room) return;

        const msg = room.messages.find(m => m.id === messageId);
        if (msg && !msg.readBy.includes(socket.id)) {
            msg.readBy.push(socket.id);

            io.to(socket.roomId).emit('message-read-update', {
                messageId: msg.id,
                readByCount: msg.readBy.length
            });
        }
    });

    // WebRTC Calling Events
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

    // Refresh, Back Button, Exit അല്ലെങ്കിൽ Disconnect ആയാൽ ഇത് പ്രവർത്തിക്കും
    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });

    function handleDisconnect(socketInstance) {
        const roomId = socketInstance.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];

        // യൂസറെ റൂമിൽ നിന്ന് നീക്കം ചെയ്യുന്നു
        if (room.users.has(socketInstance.id)) {
            room.users.delete(socketInstance.id);
            socketInstance.leave(roomId);

            // റൂമിലുള്ള മറ്റേയാൾക്ക് വിവരമറിയിക്കുന്നു
            socketInstance.to(roomId).emit('receive-message', { 
                sender: 'System', 
                text: 'The other user left the room.' 
            });
        }

        // രണ്ടുപേരും റൂമിൽ നിന്ന് പൂർണ്ണമായി ഇറങ്ങിയാൽ (0 users) മാത്രം മെസ്സേജുകൾ ഡിലീറ്റ് ആകും
        if (room.users.size === 0) {
            delete rooms[roomId];
        }
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

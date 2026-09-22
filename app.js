const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Socket.io Setup with Ping / Heartbeat Configuration
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,    // Keeps connection alive up to 60 seconds of inactivity
  pingInterval: 25000,   // Sends ping every 25 seconds automatically
});

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Storage for Room Messages
// Structure: { roomId: [ { id, senderId, text, type, replyTo, status: 'single_tick' | 'double_tick', createdAt } ] }
let roomMessages = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // 1. Join Room Event
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    socket.roomId = roomId;

    if (!roomMessages[roomId]) {
      roomMessages[roomId] = [];
    }

    const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
    const numClients = clientsInRoom ? clientsInRoom.size : 0;

    // Notify client that join was successful
    socket.emit('joined', roomId);

    // When 2 or more users are present in the room:
    // Update all previous single_tick messages to double_tick
    if (numClients >= 2) {
      roomMessages[roomId].forEach((msg) => {
        msg.status = 'double_tick';
      });
      io.to(roomId).emit('update_message_status', roomMessages[roomId]);
    }

    // Send existing room messages to the joined user
    socket.emit('initial-messages', roomMessages[roomId]);
  });

  // 2. Send Message Event
  socket.on('send-message', (data) => {
    const { room, message, type, replyTo } = data;
    const clientsInRoom = io.sockets.adapter.rooms.get(room);
    const numClients = clientsInRoom ? clientsInRoom.size : 0;

    // Set double_tick if 2 or more users are in room, otherwise single_tick
    const messageStatus = numClients >= 2 ? 'double_tick' : 'single_tick';

    const newMessage = {
      id: Date.now().toString(),
      sender: socket.id,
      text: message,
      type: type || 'text',
      replyTo: replyTo || null,
      status: messageStatus,
      createdAt: new Date()
    };

    if (!roomMessages[room]) roomMessages[room] = [];
    roomMessages[room].push(newMessage);

    io.to(room).emit('receive-message', newMessage);
  });

  // 3. Signaling for WebRTC Calls
  socket.on('request-call', (data) => {
    socket.to(data.room).emit('incoming-call');
  });

  socket.on('accept-call', (data) => {
    socket.to(data.room).emit('call-accepted');
  });

  socket.on('reject-call', (data) => {
    socket.to(data.room).emit('call-rejected');
  });

  socket.on('call-user', (data) => {
    socket.to(data.room).emit('call-made', { offer: data.offer });
  });

  socket.on('make-answer', (data) => {
    socket.to(data.room).emit('answer-made', { answer: data.answer });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.room).emit('ice-candidate', data.candidate);
  });

  socket.on('end-call', (data) => {
    socket.to(data.room).emit('call-ended');
  });

  // 4. Leave Room Event: Deletes ONLY double_tick messages; single_tick messages stay
  socket.on('leave-room', (roomId) => {
    cleanUpDoubleTicks(roomId || socket.roomId);
    socket.leave(roomId || socket.roomId);
    socket.emit('left-room');
  });

  // 5. Disconnect Event
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    cleanUpDoubleTicks(socket.roomId);
  });

  function cleanUpDoubleTicks(roomId) {
    if (roomId && roomMessages[roomId]) {
      // Keeps single_tick messages intact while removing double_tick ones
      roomMessages[roomId] = roomMessages[roomId].filter(msg => msg.status === 'single_tick');
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

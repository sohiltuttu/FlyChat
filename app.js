const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 200 * 1024 * 1024,
  pingInterval: 25000,
  pingTimeout: 20000
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

function roomCount(roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  return room ? room.size : 0;
}

function updateRoomCount(roomId) {
  io.to(roomId).emit("room-user-count", {
    count: roomCount(roomId)
  });
}

function systemMessage(roomId, text) {
  io.to(roomId).emit("receive-message", {
    sender: "System",
    text,
    type: "system",
    timestamp: Date.now()
  });
}

io.on("connection", (socket) => {

  socket.on("join-room", (roomId) => {
    roomId = String(roomId || "").trim();

    if (!roomId) {
      socket.emit("join-error", "Please enter a room code.");
      return;
    }

    const existingCount = roomCount(roomId);

    if (existingCount >= 2) {
      socket.emit("room-full");
      return;
    }

    socket.join(roomId);
    socket.currentRoom = roomId;
    socket.emit("joined", roomId);
    updateRoomCount(roomId);

    if (existingCount >= 1) {
      systemMessage(roomId, "Someone joined the room.");
    }
  });

  socket.on("rejoin-room", (roomId) => {
    roomId = String(roomId || "").trim();

    if (!roomId) return;

    const existingCount = roomCount(roomId);

    if (existingCount >= 2) {
      socket.emit("room-full");
      return;
    }

    socket.join(roomId);
    socket.currentRoom = roomId;
    updateRoomCount(roomId);
  });

  socket.on("request-room-count", () => {
    if (socket.currentRoom) {
      updateRoomCount(socket.currentRoom);
    }
  });

  socket.on("send-message", (data) => {
    if (!socket.currentRoom) return;

    io.to(socket.currentRoom).emit("receive-message", {
      ...data,
      senderId: socket.id,
      timestamp: data.timestamp || Date.now()
    });
  });

  socket.on("leave-room", (roomId) => {
    roomId = roomId || socket.currentRoom;

    if (!roomId) return;

    socket.leave(roomId);
    socket.currentRoom = null;
    socket.emit("left-room");

    socket.to(roomId).emit("receive-message", {
      sender: "System",
      text: "The other user left the room.",
      type: "system",
      timestamp: Date.now()
    });

    socket.to(roomId).emit("call-ended");
    updateRoomCount(roomId);
  });

  socket.on("call-request", () => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit("incoming-call");
  });

  socket.on("call-accepted", () => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit("call-accepted");
  });

  socket.on("call-rejected", () => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit("call-rejected");
  });

  socket.on("webrtc-offer", (offer) => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit("webrtc-offer", offer);
  });

  socket.on("webrtc-answer", (answer) => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit("webrtc-answer", answer);
  });

  socket.on("webrtc-ice-candidate", (candidate) => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit("webrtc-ice-candidate", candidate);
  });

  socket.on("call-ping", (time) => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit("call-pong", time);
  });

  socket.on("end-call", () => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit("call-ended");
  });

  socket.on("keepalive", () => {
    socket.emit("keepalive-ack");
  });

  socket.on("disconnect", () => {
    const roomId = socket.currentRoom;

    if (!roomId) return;

    socket.currentRoom = null;

    setTimeout(() => {
      const count = roomCount(roomId);

      if (count > 0) {
        systemMessage(roomId, "The other user disconnected.");
        io.to(roomId).emit("call-ended");
        updateRoomCount(roomId);
      }
    }, 300);
  });
});

server.listen(PORT, () => {
  console.log(`FlyChat running on port ${PORT}`);
});

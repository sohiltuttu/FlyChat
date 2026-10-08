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

// Room history storage
const roomsData = {};

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

// Deletion logic: a room is removed only after two users have been in it
// together and everyone has since left.
function checkAndDeleteRoom(roomId) {
  const room = roomsData[roomId];
  if (!room) return;

  const count = roomCount(roomId);

  if (count === 0 && room.hasReachedTwo) {
    // Both users were present and now nobody is left, so delete the room.
    delete roomsData[roomId];
    console.log(`[Action] Room '${roomId}' deleted. Both users have seen the messages and left.`);
  } else if (count === 0 && !room.hasReachedTwo) {
    // Only one user ever joined. Keep the messages until the 2nd user arrives.
    console.log(`[Action] Room '${roomId}' is empty but kept alive. Waiting for the 2nd user.`);
  }
}

io.on("connection", (socket) => {

  // JOIN ROOM
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

    // Set up room data
    if (!roomsData[roomId]) {
      roomsData[roomId] = { messages: [], hasReachedTwo: false };
    }

    socket.join(roomId);
    socket.currentRoom = roomId;

    const currentUsers = roomCount(roomId);

    // Flag the room once two users are present
    if (currentUsers === 2) {
      roomsData[roomId].hasReachedTwo = true;
      console.log(`[Status] Room '${roomId}' is now FULL (2 users). Messages will be deleted when both leave.`);
    }

    socket.emit("joined", roomId);

    // Send saved history, if any
    if (roomsData[roomId].messages && roomsData[roomId].messages.length > 0) {
      socket.emit("chat-history", roomsData[roomId].messages);
      console.log(`[Status] Sent saved history to user joining Room '${roomId}'.`);
    }

    updateRoomCount(roomId);

    if (existingCount >= 1) {
      systemMessage(roomId, "Someone joined the room.");
    }
  });

  // REJOIN AFTER RECONNECT
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

    const currentUsers = roomCount(roomId);
    if (roomsData[roomId] && currentUsers === 2) {
      roomsData[roomId].hasReachedTwo = true;
    }

    if (roomsData[roomId] && roomsData[roomId].messages && roomsData[roomId].messages.length > 0) {
      socket.emit("chat-history", roomsData[roomId].messages);
    }

    updateRoomCount(roomId);
  });

  socket.on("request-room-count", () => {
    if (socket.currentRoom) {
      updateRoomCount(socket.currentRoom);
    }
  });

  // SEND MESSAGE
  socket.on("send-message", (data) => {
    if (!socket.currentRoom) return;

    const msg = {
      ...data,
      senderId: data.userId || socket.id,
      timestamp: data.timestamp || Date.now()
    };

    // Save the message on the server
    if (roomsData[socket.currentRoom]) {
      roomsData[socket.currentRoom].messages.push(msg);
    }

    io.to(socket.currentRoom).emit("receive-message", msg);
  });

  // LEAVE ROOM
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

    // Check whether the room should be deleted now
    checkAndDeleteRoom(roomId);
  });

  // CALL CONTROLS
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

  // DISCONNECT
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
      checkAndDeleteRoom(roomId);
    }, 300);
  });
});

server.listen(PORT, () => {
  console.log(`Flyvo is running on port ${PORT}...`);
});

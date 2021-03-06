'use strict';

var config 	= require('../config');
var redis 	= require('redis').createClient;
var adapter = require('socket.io-redis');

var Room = require('../models/room');
var Message = require('../models/message');

/**
 * Encapsulates all code for emitting and listening to socket events
 *
 */
var ioEvents = function(io) {

	// Rooms namespace
	io.of('/rooms').on('connection', function(socket) {

		// Create a new room
		socket.on('createRoom', function(title) {
			var aid = socket.request.session.passport.user;
			Room.findOne({'title': new RegExp('^' + title + '$', 'i')}, function(err, room){
				if(err) throw err;
				if(room){
					socket.emit('updateRoomsList', { error: 'Room title already exists.' });
				} else {
					Room.create({
						n: title,
						m:{
							aid: aid,
							socketId: socket.id,
							atp: 1 //admin
						}
					}, function(err, newRoom){
						if(err) throw err;
						socket.emit('updateRoomsList', newRoom);
						socket.broadcast.emit('updateRoomsList', newRoom);
					});
				}
			});
		});
	});

	// Chatroom namespace
	io.of('chatroom').on('connection', function(socket) {

		// Join a chatroom
		socket.on('join', function(mid) {
			Room.findOne({'mid':mid}, function(err, room){
				if(err) throw err;
				if(!room){
					// Assuming that you already checked in router that chatroom exists
					// Then, if a room doesn't exist here, return an error to inform the client-side.
					socket.emit('updateUsersList', { error: 'Room does not exist.' });
				} else {
					//emit get list message for id
					Message.getTopMessage(mid,40, function(error,messages){
						socket.emit("listInitMessage",messages );
					});

					// Check if user exists in the session
					if(socket.request.session.passport == null){
						return;
					}
					//add user to connection field
					Room.addConnection(room, socket, function(err, newRoom){
						if(err) console.log(err.message);
						// Join the room channel
						socket.join(newRoom.mid);

						Room.getMembers(newRoom, socket, function(err, users, cuntUserInRoom){
							if(err) throw err;
							// Return list of all user connected to the room to the current user
							Room.getConnectionUsers(newRoom,socket,function(err, connections,count){
								if(err) throw err;
								console.log("connection size:" + connections);
								socket.emit('updateUsersList', users, connections, true);
							});

							// Return the current user to other connecting sockets in the room 
							// ONLY if the user wasn't connected already to the current room
							if(cuntUserInRoom === 1){
								//socket.broadcast.to(newRoom.mid).emit('updateUsersList', users[users.length - 1]);
							}
						});
						var aid = socket.request.session.passport.user;
						socket.broadcast.to(newRoom.mid).emit('online_user', aid);
					});

				}
			});
		});

		// When a socket exits
		socket.on('disconnect', function() {
			console.log("socket [" + socket.id + '] disconnect on');

			// Check if user exists in the session
			if(socket.request.session.passport == null){
				return;
			}

			// Find the room to which the socket is connected to, 
			// and remove the current user + socket from this room
			Room.removeUser(socket, function(err, room, aid, cuntUserInRoom){
				if(err) throw err;

				// Leave the room channel
				socket.leave(room.mid);

				// Return the user id ONLY if the user was connected to the current room using one socket
				// The user id will be then used to remove the user from users list on chatroom page
				//if(cuntUserInRoom === 1){
				socket.broadcast.to(room.mid).emit('removeUser', aid);
				//}
			});
		});

		// When a new message arrives
		socket.on('newMessage', function(roomId, message) {

			// No need to emit 'addMessage' to the current socket
			// As the new message will be added manually in 'main.js' file
			// socket.emit('addMessage', message);
			var aid = socket.request.session.passport.user;
			var mes = {
				'aid': aid,
				'mid': roomId,
				'c': message.content,
				'n': message.username,
				'lt': Date.now()
			}
			Message.create(mes);
			socket.broadcast.to(roomId).emit('addMessage', message);
		});

	});
}

/**
 * Initialize Socket.io
 * Uses Redis as Adapter for Socket.io
 *
 */
var init = function(app){

	var server 	= require('http').Server(app);
	var io 		= require('socket.io')(server);

	// Force Socket.io to ONLY use "websockets"; No Long Polling.
	io.set('transports', ['websocket']);

	// Using Redis
	let port = config.redis.port;
	let host = config.redis.host;
	let password = config.redis.password;
	let pubClient = redis(port, host, { auth_pass: password });
	let subClient = redis(port, host, { auth_pass: password, return_buffers: true, });
	io.adapter(adapter({ pubClient, subClient }));

	// Allow sockets to access session data
	io.use((socket, next) => {
		require('../session')(socket.request, {}, next);
	});

	// Define all Events
	ioEvents(io);

	// The server object will be then used to list to a port number
	return server;
}

module.exports = init;
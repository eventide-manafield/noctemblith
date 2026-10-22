/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'events';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import * as WebSocket from 'ws';
import { DI } from '@/di-symbols.js';
import type { MiAccessToken } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { MiLocalUser } from '@/models/User.js';
import { UserService } from '@/core/UserService.js';
import { AuthenticateService, AuthenticationError } from './AuthenticateService.js';
import { ManafieldSessionService, isManafieldBrowserSessionToken } from '@/server/manafield-oauth/ManafieldSessionService.js';
import MainStreamConnection, { ConnectionRequest } from './stream/Connection.js';
import type * as http from 'node:http';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';

@Injectable()
export class StreamingApiServerService {
	#wss: WebSocket.WebSocketServer;
	#connections = new Map<WebSocket.WebSocket, number>();
	#sessionConnections = new Map<WebSocket.WebSocket, string>();
	#sessionValidationIntervalId: NodeJS.Timeout | null = null;
	#checkingSessions = false;
	#cleanConnectionsIntervalId: NodeJS.Timeout | null = null;

	constructor(
		@Inject(DI.redisForSub)
		private redisForSub: Redis.Redis,

		private moduleRef: ModuleRef,
		private authenticateService: AuthenticateService,
		private usersService: UserService,
		private manafieldSessionService: ManafieldSessionService,
	) {
	}

	@bindThis
	public attach(server: http.Server): void {
		this.#wss = new WebSocket.WebSocketServer({
			noServer: true,
		});

		server.on('upgrade', async (request, socket, head) => {
			if (request.url == null) {
				socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
				socket.destroy();
				return;
			}

			const q = new URL(request.url, `http://${request.headers.host}`).searchParams;

			let user: MiLocalUser | null = null;
			let app: MiAccessToken | null = null;

			// https://datatracker.ietf.org/doc/html/rfc6750.html#section-2.1
			// Note that the standard WHATWG WebSocket API does not support setting any headers,
			// but non-browser apps may still be able to set it.
			const token = request.headers.authorization?.startsWith('Bearer ')
				? request.headers.authorization.slice(7)
				: q.get('i');

			try {
				[user, app] = await this.authenticateService.authenticate(token);

				if (app !== null && !app.permission.some(p => p === 'read:account')) {
					throw new AuthenticationError('Your app does not have necessary permissions to use websocket API.');
				}
			} catch (e) {
				if (e instanceof AuthenticationError) {
					socket.write([
						'HTTP/1.1 401 Unauthorized',
						'WWW-Authenticate: Bearer realm="Misskey", error="invalid_token", error_description="Failed to authenticate"',
					].join('\r\n') + '\r\n\r\n');
				} else {
					socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
				}
				socket.destroy();
				return;
			}

			if (user?.isSuspended) {
				socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
				socket.destroy();
				return;
			}

			const contextId = ContextIdFactory.create();
			this.moduleRef.registerRequestByContextId<ConnectionRequest>({
				user,
				token: app,
			}, contextId);
			const stream = await this.moduleRef.create(MainStreamConnection, contextId);
			if (typeof token === 'string' && isManafieldBrowserSessionToken(token)) {
				stream.setSessionValidator(async () => await this.manafieldSessionService.resolve(token) !== null);
			}

			await stream.init();

			this.#wss.handleUpgrade(request, socket, head, (ws) => {
				if (typeof token === 'string' && isManafieldBrowserSessionToken(token)) {
					this.#sessionConnections.set(ws, token);
				}
				this.#wss.emit('connection', ws, request, {
					stream, user, app,
				});
			});
		});

		const globalEv = new EventEmitter();

		this.redisForSub.on('message', (_: string, data: string) => {
			const parsed = JSON.parse(data);
			globalEv.emit('message', parsed);
		});

		this.#wss.on('connection', async (connection: WebSocket.WebSocket, request: http.IncomingMessage, ctx: {
			stream: MainStreamConnection,
			user: MiLocalUser | null;
			app: MiAccessToken | null
		}) => {
			const { stream, user } = ctx;

			const ev = new EventEmitter();

			function onRedisMessage(data: any): void {
				ev.emit(data.channel, data.message);
			}

			globalEv.on('message', onRedisMessage);

			await stream.listen(ev, connection);

			this.#connections.set(connection, Date.now());

			const userUpdateIntervalId = user ? setInterval(() => {
				this.usersService.updateLastActiveDate(user);
			}, 1000 * 60 * 5) : null;
			if (user) {
				this.usersService.updateLastActiveDate(user);
			}

			connection.once('close', () => {
				ev.removeAllListeners();
				stream.dispose();
				globalEv.off('message', onRedisMessage);
				this.#connections.delete(connection);
				this.#sessionConnections.delete(connection);
				if (userUpdateIntervalId) clearInterval(userUpdateIntervalId);
			});

			connection.on('pong', () => {
				this.#connections.set(connection, Date.now());
			});
		});

		// Existing WebSockets must not outlive a revoked browser session.
		// Redis is the authority; no positive cache and fail closed on store errors.
		this.#sessionValidationIntervalId = setInterval(async () => {
			if (this.#checkingSessions) return;
			this.#checkingSessions = true;
			try {
				for (const [connection, token] of this.#sessionConnections) {
					try {
						if (!await this.manafieldSessionService.isActive(token)) {
							connection.close(4001, 'Session ended');
							this.#sessionConnections.delete(connection);
						}
					} catch {
						connection.close(4001, 'Session validation unavailable');
						this.#sessionConnections.delete(connection);
					}
				}
			} finally {
				this.#checkingSessions = false;
			}
		}, 10000);

		// 一定期間通信が無いコネクションは実際には切断されている可能性があるため定期的にterminateする
		this.#cleanConnectionsIntervalId = setInterval(() => {
			const now = Date.now();
			for (const [connection, lastActive] of this.#connections.entries()) {
				if (now - lastActive > 1000 * 60 * 2) {
					connection.terminate();
					this.#connections.delete(connection);
				} else {
					connection.ping();
				}
			}
		}, 1000 * 60);
	}

	@bindThis
	public detach(): Promise<void> {
		if (this.#sessionValidationIntervalId) {
			clearInterval(this.#sessionValidationIntervalId);
			this.#sessionValidationIntervalId = null;
		}
		this.#sessionConnections.clear();
		if (this.#cleanConnectionsIntervalId) {
			clearInterval(this.#cleanConnectionsIntervalId);
			this.#cleanConnectionsIntervalId = null;
		}
		return new Promise((resolve) => {
			this.#wss.close(() => resolve());
		});
	}
}

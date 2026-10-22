/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, it, vi } from 'vitest';
import Connection from './Connection.js';

function fixture() {
 const stream = new Connection({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
 const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
 (stream as any).wsConnection = socket;
 return { stream, socket };
}

describe('Integrated WebSocket session enforcement', () => {
 it('validates each protected output and stops after parent revocation', async () => {
  const { stream, socket } = fixture();
  const validate = vi.fn(async () => true);
  stream.setSessionValidator(validate);
  stream.sendMessageToWs('test', {});
  await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
  validate.mockResolvedValue(false);
  stream.sendMessageToWs('test', {});
  await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(4001, 'Session ended'));
  expect(socket.send).toHaveBeenCalledTimes(1);
 });
 it('rejects incoming actions when parent validation fails or is unavailable', async () => {
  const { stream, socket } = fixture();
  const action = vi.fn();
  Object.defineProperty(stream, 'onReadNotification', { value: action, configurable: true });
  stream.setSessionValidator(async () => { throw new Error('Core unavailable'); });
  await (stream as any).onWsConnectionMessage(Buffer.from(JSON.stringify({ type: 'readNotification', body: {} })));
  expect(action).not.toHaveBeenCalled();
  expect(socket.close).toHaveBeenCalledWith(4001, 'Session ended');
 });
 it('preserves standalone stream delivery without central validation', () => {
  const { stream, socket } = fixture();
  stream.sendMessageToWs('test', {});
  expect(socket.send).toHaveBeenCalledTimes(1);
  expect(socket.close).not.toHaveBeenCalled();
 });
});
